const fs = require("fs/promises");
const path = require("path");

const DEFAULTS = {
  sourceService: "AMRAP",
  weeklyEndpoint: "https://amrap.org.au/api/charts/weekly",

  // Which charts.<key> to read. Indie / Alternative only, for now.
  chartKeys: ["indie"],

  // Debut-only freshness: keep entries with weeks_on_chart <= this.
  newMaxWeeksOnChart: 1,
  // Additionally require a genuine debut (no previous chart position).
  requireDebut: true,

  // AMRAP is Australian by construction.
  country: "Australia",

  // Optional: request a specific past week (YYYY-MM-DD, matching a
  // /api/charts/available-dates "value"). null = current published week.
  date: null,

  // No per-track public page exists on AMRAP (tracks aren't hyperlinked;
  // browsing is via /search). Link back to the chart; track/performer ids are
  // retained on each item for future enrichment.
  sourceUrl: "https://amrap.org.au/charts",

  // Every chart entry is already genre-classified by AMRAP, so we seed the
  // mapped genre from the chart it came from rather than guessing from text.
  chartGenreLabels: {
    indie: ["Indie"],
    rock: ["Alt Rock"],
    pop: ["Indie"],
  },

  // A brand-new debut on a curated AU community-radio chart is a strong signal.
  debutBonus: 1,

  // --- MusicBrainz release-date enrichment ---------------------------------
  enrichReleaseDate: true,
  musicbrainzBase: "https://musicbrainz.org/ws/2",
  freshWindowDays: 90,        // <= this many days old (vs chart week) = "fresh"
  mbMinScore: 80,             // min MusicBrainz match score (0-100) to trust
  maxEnrich: 60,              // max NEW MB lookups per run (debuts are few)
  mbDelayMs: 1100,            // MusicBrainz rate limit (~1 req/sec)
  mbTimeoutMs: 15000,
  mbCacheFile: path.join(__dirname, "../../saved_searches/cache/amrap-mb-release-date.json"), // null to disable caching
  // MusicBrainz asks for a descriptive UA with contact info - edit to yours.
  mbUserAgent: "music-release-agent/1.0 ( https://kimrampling.com )",
  // Optional: demote back-catalogue re-releases so fresh drops rank above them.
  // Default 0 = purely informational (flag only, no score change).
  cataloguePenalty: 0,

  timeoutMs: 25000,
  userAgent: "NewIndieFriday/0.1 (music-release-agent; amrap collector)",
};

async function runAmrapAgent(config = {}, exclusions = {}) {
  const options = { ...DEFAULTS, ...config };
  const http = fetch;

  const data = await fetchWeekly(http, options);
  const charts = (data && data.charts) || {};
  const period = (data && data.period) || {};
  console.log(
    `[AMRAP Agent] Weekly charts fetched: ${Object.keys(charts).length} charts` +
      (period.week_range ? ` (${period.week_range})` : "")
  );

  const releases = [];
  let scanned = 0;

  for (const key of options.chartKeys) {
    const chart = charts[key];
    if (!chart || !chart.entries) {
      console.warn(`[AMRAP Agent] Chart "${key}" not present in response - skipping.`);
      continue;
    }
    
    const entries = Array.isArray(chart.entries) ? chart.entries : Object.values(chart.entries);

    const weekEnd = normalizeDate(chart.week_end) || normalizeDate(period.week_end);
    const baseGenres = options.chartGenreLabels[key] || [];

    for (const entry of entries) {
      scanned++;
      const track = entry.track || {};
      const artist = cleanText(track.artist || (track.performer && track.performer.name));
      const title = cleanText(track.title);
      if (!artist || !title) continue;

      // Debut-only gate.
      const weeksOnChart = Number(entry.weeks_on_chart);
      const isDebut = entry.previous_position == null;
      const withinWeeks =
        Number.isFinite(weeksOnChart) && weeksOnChart <= options.newMaxWeeksOnChart;
      if (!withinWeeks) continue;
      if (options.requireDebut && !isDebut && weeksOnChart > 1) continue;

      const genresMapped = mergeGenres(baseGenres, `${artist} ${title}`, exclusions, options);
      const releaseType = guessReleaseType(track);
      const feat = detectFeat(title);
      const country = options.country;
      const score = scoreRelease({ releaseType, genresMapped, country, isDebut }, options);

      releases.push({
        artist,
        title,
        releaseType,
        releaseDate: weekEnd || "unknown",
        articleDate: weekEnd || "unknown",
        sourceService: options.sourceService,
        sourceUrl: options.sourceUrl,
        marketsAvailable: inferMarkets(country, exclusions),
        genresMapped,
        artistCountryMapped: country,
        score,
        bucket: bucketFromScore(score),
        originConfidence: 1,
        originSource: "amrap-chart",

        featured: feat.featured,
        featuredWith: feat.featuredWith,
        chart: chart.chart_slug || key,
        chartPosition: entry.position,
        weeksOnChart: Number.isFinite(weeksOnChart) ? weeksOnChart : null,
        trackId: track.id || null,
        trackSlug: track.slug || null,
        performerId: track.performer && track.performer.id,
      });
    }
  }

  console.log(
    `[AMRAP Agent] scanned ${scanned} chart entries | kept debuts: ${releases.length} ` +
      `(charts: ${options.chartKeys.join(", ")}; weeks_on_chart <= ${options.newMaxWeeksOnChart})`
  );
  if (releases.length === 0 && scanned > 0) {
    console.log("[AMRAP Agent] 0 debuts this week - all charted tracks are holdovers.");
  }

  const deduped = dedupeAndSort(releases, exclusions);

  if (options.enrichReleaseDate && deduped.length) {
    await enrichReleaseDates(deduped, http, options);
  }

  // MAPPING TO UNIFIED AGENT FORMAT
  const unifiedResults = deduped.map(r => {
      let description = `Score: ${r.score} | Chart: ${r.chart} (#${r.chartPosition})`;
      if (r.freshnessNote) description += ` | Note: ${r.freshnessNote}`;
      if (r.genresMapped && r.genresMapped.length) description += ` | Genres: ${r.genresMapped.join(', ')}`;

      const trackUrl = r.trackSlug 
          ? `https://amrap.org.au/charts#${r.trackSlug}` 
          : (r.trackId ? `https://amrap.org.au/charts#${r.trackId}` : r.sourceUrl);

      return {
          title: `${r.artist} - ${r.title}`,
          channel: "AMRAP Charts",
          url: trackUrl,
          views: r.bucket,
          uploadedAt: r.releaseDate,
          description: description
      };
  });

  return unifiedResults;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

async function fetchWeekly(http, options) {
  let url = options.weeklyEndpoint;
  if (options.date) url += `?date=${encodeURIComponent(options.date)}`;
  const res = await http(url, {
    headers: { accept: "application/json", "user-agent": options.userAgent },
    signal: AbortSignal.timeout ? AbortSignal.timeout(options.timeoutMs) : undefined,
  });
  if (!res.ok) throw new Error(`AMRAP request failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// MusicBrainz release-date enrichment
// ---------------------------------------------------------------------------

async function enrichReleaseDates(items, http, options) {
  const cache = await loadCache(options);
  const cacheStart = cache.size;
  let newLookups = 0;
  let hits = 0;

  for (const item of items) {
    const key = `${slugify(item.artist)}::${slugify(item.title)}`;
    let orig = cache.get(key);

    if (orig === undefined) {
      if (newLookups >= options.maxEnrich) {
        applyFreshness(item, null, options, "budget exhausted");
        continue;
      }
      newLookups++;
      try {
        orig = await mbFirstReleaseDate(item.artist, item.title, http, options);
      } catch {
        orig = undefined;
      }
      if (orig !== undefined) cache.set(key, orig || "");
      if (newLookups < options.maxEnrich) await sleep(options.mbDelayMs);
    } else {
      hits++;
    }

    const dateStr = orig && orig !== "" ? orig : null;
    applyFreshness(item, dateStr, options);
  }

  await saveCache(options, cache);
  const counts = tallyFreshness(items);
  console.log(
    `[AMRAP Agent] release-date enrichment | cache hits: ${hits} | new MB lookups: ` +
      `${newLookups}/${options.maxEnrich} | cache ${cacheStart}->${cache.size} | ` +
      `fresh: ${counts.fresh}, catalogue: ${counts.catalogue}, unverified: ${counts.unverified}`
  );
}

function applyFreshness(item, origDate, options, unresolvedReason) {
  item.originalReleaseDate = origDate;
  const weekEnd = item.releaseDate && item.releaseDate !== "unknown" ? item.releaseDate : null;
  const res = classifyFreshness(origDate, weekEnd, options.freshWindowDays, unresolvedReason);
  item.freshness = res.freshness;
  item.freshnessNote = res.note;
  if (res.freshness === "catalogue" && options.cataloguePenalty) {
    item.score = Math.round((item.score - options.cataloguePenalty) * 10) / 10;
    item.bucket = bucketFromScore(item.score);
  }
}

function classifyFreshness(origDate, weekEnd, windowDays, unresolvedReason) {
  if (!origDate) {
    return { freshness: "unverified", note: unresolvedReason || "no MusicBrainz match" };
  }
  const orig = parseLooseDate(origDate);
  const ref = weekEnd ? new Date(weekEnd) : new Date();
  if (!orig || Number.isNaN(orig.getTime())) {
    return { freshness: "unverified", note: `unparseable date ${origDate}` };
  }
  const ageDays = (ref.getTime() - orig.getTime()) / (24 * 60 * 60 * 1000);
  if (ageDays <= windowDays) {
    return { freshness: "fresh", note: `released ${origDate}` };
  }
  return { freshness: "catalogue", note: `originally ${String(origDate).slice(0, 4)}` };
}

async function mbFirstReleaseDate(artist, title, http, options) {
  const q = `artist:"${mbEscape(artist)}" AND recording:"${mbEscape(title)}"`;
  const url = `${options.musicbrainzBase}/recording?query=${encodeURIComponent(q)}&fmt=json&limit=8`;
  const res = await http(url, {
    headers: { accept: "application/json", "user-agent": options.mbUserAgent },
    signal: AbortSignal.timeout ? AbortSignal.timeout(options.mbTimeoutMs) : undefined,
  });
  if (!res.ok) throw new Error(`MusicBrainz ${res.status}`);
  const data = await res.json();
  const recs = Array.isArray(data.recordings) ? data.recordings : [];
  const wantArtist = slugify(artist);
  const wantTitle = slugify(title);

  let best = null;
  for (const r of recs) {
    if ((r.score || 0) < options.mbMinScore) continue;
    if (!titleMatches(wantTitle, slugify(r.title))) continue;
    if (!artistCreditMatches(wantArtist, r["artist-credit"])) continue;
    const frd = r["first-release-date"];
    if (!frd) continue;
    if (best === null || frd < best) best = frd;
  }
  return best;
}

function artistCreditMatches(wantArtistSlug, credit) {
  if (!Array.isArray(credit)) return false;
  for (const c of credit) {
    const name = (c.artist && c.artist.name) || c.name;
    const s = slugify(name);
    if (!s) continue;
    if (s === wantArtistSlug || s.includes(wantArtistSlug) || wantArtistSlug.includes(s)) return true;
  }
  return false;
}

function titleMatches(wantTitleSlug, gotTitleSlug) {
  if (!gotTitleSlug) return false;
  return (
    gotTitleSlug === wantTitleSlug ||
    gotTitleSlug.includes(wantTitleSlug) ||
    wantTitleSlug.includes(gotTitleSlug)
  );
}

function tallyFreshness(items) {
  const c = { fresh: 0, catalogue: 0, unverified: 0 };
  for (const i of items) if (c[i.freshness] !== undefined) c[i.freshness]++;
  return c;
}

function parseLooseDate(value) {
  if (!value) return null;
  const s = String(value);
  if (/^\d{4}$/.test(s)) return new Date(`${s}-01-01`);
  if (/^\d{4}-\d{2}$/.test(s)) return new Date(`${s}-01`);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mbEscape(value) {
  return String(value || "").replace(/(["\\])/g, "\\$1");
}

async function loadCache(options) {
  const map = new Map();
  if (!options.mbCacheFile) return map;
  try {
    const text = await fs.readFile(options.mbCacheFile, "utf8");
    for (const [k, v] of Object.entries(JSON.parse(text))) map.set(k, v);
  } catch {
  }
  return map;
}

async function saveCache(options, map) {
  if (!options.mbCacheFile || map.size === 0) return;
  try {
    await fs.mkdir(path.dirname(options.mbCacheFile), { recursive: true });
    await fs.writeFile(options.mbCacheFile, JSON.stringify(Object.fromEntries(map)), "utf8");
  } catch (e) {
    console.error("[AMRAP Agent] release-date cache write failed:", e.message);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Inference + scoring
// ---------------------------------------------------------------------------

function mergeGenres(baseGenres, text, filters = {}, options = {}) {
  const targetList = (filters && filters.targetGenres) || (options && options.targetGenres) || [];
  const mappings = (filters && filters.genreMappings) || (options && options.genreMappings) || {};
  const allowed = new Set(targetList);
  const found = new Set(baseGenres.filter((g) => allowed.has(g)));
  const lower = String(text).toLowerCase();
  for (const [label, keywords] of Object.entries(mappings)) {
    if (!allowed.has(label)) continue;
    for (const keyword of keywords) {
      if (lower.includes(String(keyword).toLowerCase())) found.add(label);
    }
  }
  return Array.from(found);
}

function inferMarkets(country, filters) {
  if (!Array.isArray(filters.markets)) return [];
  if (country === "Australia" || country === "New Zealand") {
    return filters.markets.filter((m) => ["AU", "NZ", "GB", "IE"].includes(m));
  }
  return filters.markets;
}

function scoreRelease({ releaseType, genresMapped, country, isDebut }, options) {
  let score = 0;
  score += 2;
  if (country === "Australia" || country === "New Zealand") score += 3;

  const direct = genresMapped.filter((g) =>
    ["Indie", "Indie Rock", "Alt Rock", "Surf Rock"].includes(g)
  ).length;
  if (direct >= 2) score += 3;
  else if (direct === 1) score += 2;
  else if (genresMapped.length > 0) score += 1;

  if (releaseType === "album") score += 2;
  else if (releaseType === "ep") score += 2;
  else if (releaseType === "single") score += 2;
  else if (releaseType === "unknown") score -= 1;

  if (isDebut) score += options.debutBonus;

  return Math.round(score * 10) / 10;
}

function bucketFromScore(score) {
  if (score >= 9) return "Best matches";
  if (score >= 5.5) return "Worth checking";
  return "Manual review";
}

function guessReleaseType(track) {
  const album = track.album || {};
  const title = String(track.title || "").toLowerCase();
  const albumTitle = String(album.title || "").toLowerCase();
  if (/\bep\b/.test(title) || /\bep\b/.test(albumTitle)) return "ep";
  return "single";
}

function dedupeAndSort(items, filters) {
  const runWindowDays = filters.runWindowDays || 14;
  const cutoff = Date.now() - runWindowDays * 24 * 60 * 60 * 1000;
  const map = new Map();

  for (const item of items) {
    const parsed = new Date(item.releaseDate).getTime();
    const dateOk =
      item.releaseDate === "unknown" || Number.isNaN(parsed) || parsed >= cutoff;
    if (!dateOk) continue;

    const key = `${slugify(item.artist)}::${slugify(item.title)}`;
    const existing = map.get(key);
    if (!existing || item.score > existing.score) map.set(key, item);
  }

  return Array.from(map.values()).sort(
    (a, b) => b.score - a.score || a.artist.localeCompare(b.artist)
  );
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function detectFeat(title) {
  const s = String(title || "");
  const bracket = s.match(/[[(]\s*feat\.?\s*([^\])]+?)\s*[\])]/i);
  if (bracket) return { featured: true, featuredWith: cleanText(bracket[1]) };
  const trailing = s.match(/\b(?:feat\.?|ft\.?|featuring)\s+(.+)$/i);
  if (trailing) return { featured: true, featuredWith: cleanText(trailing[1]) };
  return { featured: false, featuredWith: null };
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

module.exports = {
  runAmrapAgent
};

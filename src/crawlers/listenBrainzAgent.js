const fs = require("fs/promises");
const path = require("path");

const DEFAULTS = {
  sourceService: "ListenBrainz",
  freshReleasesEndpoint: "https://api.listenbrainz.org/1/explore/fresh-releases",
  musicbrainzBase: "https://musicbrainz.org/ws/2",
  days: 14,
  future: true,
  sort: "release_date",
  maxEnrich: 2000,       // Significantly increased budget
  mbDelayMs: 1100,      
  timeoutMs: 25000,
  includeUnresolved: false,
  allowedTypes: null,   
  cacheFile: path.join(__dirname, "../../saved_searches/cache/listenbrainz-mb-origin.json"), 
  userAgent: "NewIndieFriday/0.1 ( https://kimrampling.com )",
  globalSearch: false,
};

const ISO_TO_COUNTRY = { AU: "Australia", NZ: "New Zealand" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runListenBrainzAgent(config = {}, exclusions = {}) {
  const options = { ...DEFAULTS, ...config };
  const http = fetch;

  const raw = await fetchFreshReleases(http, options);
  console.log(`[ListenBrainz Agent] Fresh releases fetched: ${raw.length}`);

  // Merge config and exclusions for filters (to catch targetGenres)
  const filters = { ...exclusions, ...config };

  // INTELLIGENT SORTING: Prioritize releases that match our target genres
  // so that the MusicBrainz budget is spent on likely candidates first.
  const targetGenres = filters.targetGenres || [];
  const targetKeywords = targetGenres.map(g => g.toLowerCase());
  
  const sortedRaw = raw.sort((a, b) => {
      const aText = `${a.release_name} ${(a.release_tags || []).join(" ")}`.toLowerCase();
      const bText = `${b.release_name} ${(b.release_tags || []).join(" ")}`.toLowerCase();
      
      let aScore = 0; let bScore = 0;
      for (const kw of targetKeywords) {
          if (aText.includes(kw)) aScore++;
          if (bText.includes(kw)) bScore++;
      }
      return bScore - aScore; // Descending
  });

  const mbCache = await loadCache(options);
  const cacheStart = mbCache.size;
  console.log(`[ListenBrainz Agent] MB enrichment ON (max ${options.maxEnrich} new lookups; ${cacheStart} cached origins loaded)`);

  const hintMap = buildHintMap(filters);
  let enrichCount = 0;   
  let cacheHits = 0;     
  let hintMatches = 0;
  const releases = [];

  for (const r of sortedRaw) {
    const artist = firstDefined(r, ["artist_credit_name", "artist_name"]);
    const title = firstDefined(r, ["release_name", "title"]);
    if (!artist || !title) continue;

    const releaseType = mapReleaseType(firstDefined(r, ["release_group_primary_type", "primary_type"]));
    if (Array.isArray(options.allowedTypes) && !options.allowedTypes.includes(releaseType)) continue;

    let country = "unknown";
    let originConfidence = 0;
    let originSource = null;

    const hinted = hintMap.get(slugify(artist));
    if (hinted) {
      hintMatches++;
      country = hinted; originConfidence = 0.99; originSource = "hint";
    } else {
      const mbid = (r.artist_mbids || r.artist_credit_mbids || [])[0];
      if (mbid) {
        let mb = mbCache.get(mbid);
        if (mb) {
          cacheHits++;                       
        } else if (options.maxEnrich > 0 && enrichCount < options.maxEnrich) {
          enrichCount++;
          mb = await resolveArtistCountryMB(mbid, http, options, mbCache);
          if (enrichCount < options.maxEnrich) await sleep(options.mbDelayMs);
        }
        if (mb && mb.country) {
          country = mb.country; originConfidence = mb.confidence;
          originSource = "musicbrainz:" + mb.field;
        }
      }
    }

    const isTarget = country === "Australia" || country === "New Zealand";
    if (!options.globalSearch && !isTarget && !options.includeUnresolved) continue;

    const combinedText = `${artist} ${title} ${(r.release_tags || []).join(" ")}`.toLowerCase();
    const genresMapped = inferGenresMapped(combinedText, filters);
    const rgMbid = firstDefined(r, ["release_group_mbid"]);
    const relMbid = firstDefined(r, ["release_mbid"]);
    const score = scoreRelease({ releaseType, genresMapped, country });

    releases.push({
      artist: String(artist).trim(),
      title: String(title).trim(),
      releaseType,
      releaseDate: normalizeDate(firstDefined(r, ["release_date"])) || "unknown",
      articleDate: normalizeDate(firstDefined(r, ["release_date"])) || "unknown",
      sourceService: options.sourceService,
      sourceUrl: rgMbid
        ? `https://musicbrainz.org/release-group/${rgMbid}`
        : relMbid ? `https://musicbrainz.org/release/${relMbid}` : "#",
      marketsAvailable: inferMarkets(country, filters),
      genresMapped,
      artistCountryMapped: country,
      score,
      bucket: bucketFromScore(score),
      originConfidence,
      originSource,
    });
  }

  await saveCache(options, mbCache);

  console.log(
    `[ListenBrainz Agent] hints: ${hintMatches} | cache hits: ${cacheHits} | new MB lookups: ${enrichCount}/${options.maxEnrich} | ` +
    `cache ${cacheStart}->${mbCache.size} | kept (AU/NZ): ${releases.length}`
  );
  if (releases.length === 0) {
    if (enrichCount >= options.maxEnrich) {
      console.log("[ListenBrainz Agent] Budget was exhausted - raise listenbrainz.maxEnrich for wider coverage (cache makes later runs cheaper).");
    }
  }

  const deduped = dedupeAndSort(releases, filters);

  // MAPPING TO UNIFIED AGENT FORMAT
  const unifiedResults = deduped.map(r => {
      let description = `Score: ${r.score} | Type: ${r.releaseType}`;
      if (r.artistCountryMapped) description += ` | Loc: ${r.artistCountryMapped}`;
      if (r.genresMapped && r.genresMapped.length) description += ` | Genres: ${r.genresMapped.join(', ')}`;
      if (r.originSource) description += ` | Origin: ${r.originSource}`;

      return {
          title: `${r.artist} - ${r.title}`,
          channel: "ListenBrainz API",
          url: r.sourceUrl,
          views: r.bucket,
          uploadedAt: r.releaseDate,
          description: description
      };
  });

  return unifiedResults;
}

// ---------------------------------------------------------------------------
// Persistent cache
// ---------------------------------------------------------------------------

async function loadCache(options) {
  const map = new Map();
  if (!options.cacheFile) return map;
  try {
    const text = await fs.readFile(options.cacheFile, "utf8");
    const obj = JSON.parse(text);
    for (const [k, v] of Object.entries(obj)) map.set(k, v);
  } catch {
  }
  return map;
}

async function saveCache(options, map) {
  if (!options.cacheFile || map.size === 0) return;
  try {
    await fs.mkdir(path.dirname(options.cacheFile), { recursive: true });
    const obj = Object.fromEntries(map);
    await fs.writeFile(options.cacheFile, JSON.stringify(obj), "utf8");
  } catch (e) {
    console.error("[ListenBrainz Agent] cache write failed:", e.message);
  }
}

// ---------------------------------------------------------------------------
// ListenBrainz fetch
// ---------------------------------------------------------------------------

async function fetchFreshReleases(http, options) {
  const url =
    `${options.freshReleasesEndpoint}?days=${options.days}` +
    `&future=${options.future}&sort=${encodeURIComponent(options.sort)}`;
  const res = await http(url, {
    headers: { accept: "application/json", "user-agent": options.userAgent },
    signal: AbortSignal.timeout ? AbortSignal.timeout(options.timeoutMs) : undefined,
  });
  if (!res.ok) throw new Error(`ListenBrainz request failed: ${res.status}`);
  const data = await res.json();
  const releases =
    (data && data.payload && data.payload.releases) ||
    (data && data.releases) || [];
  return Array.isArray(releases) ? releases : [];
}

// ---------------------------------------------------------------------------
// MusicBrainz artist -> country
// ---------------------------------------------------------------------------

async function resolveArtistCountryMB(mbid, http, options, cache) {
  let result = { country: null, confidence: 0, field: null };
  try {
    const url = `${options.musicbrainzBase}/artist/${mbid}?fmt=json`;
    const res = await http(url, {
      headers: { accept: "application/json", "user-agent": options.userAgent },
      signal: AbortSignal.timeout ? AbortSignal.timeout(options.timeoutMs) : undefined,
    });
    if (res.ok) result = originFromArtist(await res.json());
  } catch {
  }
  cache.set(mbid, result); 
  return result;
}

function isoFromArea(area) {
  if (!area) return null;
  const codes = area["iso-3166-1-codes"];
  return Array.isArray(codes) && codes.length ? codes[0] : null;
}

function originFromArtist(a) {
  const beginArea = a["begin-area"] || a["begin_area"];
  const candidates = [
    { field: "begin-area", iso: isoFromArea(beginArea), conf: 0.9 },
    { field: "area", iso: isoFromArea(a.area), conf: 0.8 },
    { field: "country", iso: a.country || null, conf: 0.75 },
  ];
  for (const c of candidates) {
    if (c.iso && ISO_TO_COUNTRY[c.iso]) {
      return { country: ISO_TO_COUNTRY[c.iso], confidence: c.conf, field: c.field };
    }
  }
  return { country: null, confidence: 0, field: null };
}

// ---------------------------------------------------------------------------
// Shared inference + scoring
// ---------------------------------------------------------------------------

function buildHintMap(filters) {
  const m = new Map();
  for (const [name, country] of Object.entries(filters.artistCountryHints || {})) {
    m.set(slugify(name), country);
  }
  return m;
}

function inferGenresMapped(text, filters) {
  const found = new Set();
  for (const [label, keywords] of Object.entries(filters.genreMappings || {})) {
    for (const keyword of keywords) {
      if (text.includes(String(keyword).toLowerCase())) found.add(label);
    }
  }
  const allowed = new Set(filters.targetGenres || []);
  return Array.from(found).filter((g) => allowed.has(g));
}

function inferMarkets(country, filters) {
  if (!Array.isArray(filters.markets)) return [];
  if (country === "Australia" || country === "New Zealand") {
    return filters.markets.filter((m) => ["AU", "NZ", "GB", "IE"].includes(m));
  }
  return filters.markets;
}

function scoreRelease({ releaseType, genresMapped, country }) {
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
  return Math.round(score * 10) / 10;
}

function bucketFromScore(score) {
  if (score >= 9) return "Best matches";
  if (score >= 5.5) return "Worth checking";
  return "Manual review";
}

function mapReleaseType(rgType) {
  const t = String(rgType || "").toLowerCase();
  if (t === "album") return "album";
  if (t === "ep") return "ep";
  if (t === "single") return "single";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Dedupe + sort
// ---------------------------------------------------------------------------

function dedupeAndSort(items, filters) {
  const runWindowDays = filters.runWindowDays || 14;
  const cutoff = Date.now() - runWindowDays * 24 * 60 * 60 * 1000;
  const map = new Map();
  for (const item of items) {
    const parsed = new Date(item.releaseDate).getTime();
    const dateOk = item.releaseDate === "unknown" || Number.isNaN(parsed) || parsed >= cutoff;
    if (!dateOk) continue;
    const key = `${slugify(item.artist)}::${slugify(item.title)}`;
    const existing = map.get(key);
    if (!existing || item.score > existing.score) map.set(key, item);
  }
  return Array.from(map.values()).sort(
    (a, b) => b.score - a.score || a.artist.localeCompare(b.artist)
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function firstDefined(obj, keys) {
  for (const k of keys) if (obj[k] != null && obj[k] !== "") return obj[k];
  return null;
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
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
  runListenBrainzAgent
};

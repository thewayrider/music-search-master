const DEFAULTS = {
  sourceService: "Bandcamp",
  discoverEndpoint: "https://bandcamp.com/api/discover/1/discover_web", 
  slice: "new",
  pageSize: 60,
  maxPages: 2,
  maxItems: 120,
  requestDelayMs: 700,
  timeoutMs: 25000,
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",

  locations: [
    { name: "Melbourne",    geonameId: 2158177, country: "Australia" },
    { name: "Sydney",       geonameId: 2147714, country: "Australia" },
    { name: "Brisbane",     geonameId: 2174003, country: "Australia" },
    { name: "Perth",        geonameId: 2063523, country: "Australia" },
    { name: "Adelaide",     geonameId: 2078025, country: "Australia" },
    { name: "Auckland",     geonameId: 2193733, country: "New Zealand" },
    { name: "Wellington",   geonameId: 2179537, country: "New Zealand" },
    { name: "Christchurch", geonameId: 2192362, country: "New Zealand" },
  ],

  genreTags: ["rock", "punk", "indie", "garage", "psychedelic", "surf"],

  fallbackGenreLabels: {
    "garage rock": "Indie Rock",
    garage: "Indie Rock",
    psychedelic: "Alt Rock",
    psych: "Alt Rock",
    "alternative rock": "Alt Rock",
    alternative: "Alt Rock",
    "surf punk": "Surf Rock",
    "surf garage": "Surf Rock",
    surf: "Surf Rock",
    "bedroom pop": "Indie",
    "bedroom indie": "Indie",
    independent: "Indie",
    "dream pop": "Indie",
    shoegaze: "Alt Rock",
    "lo-fi": "Indie",
    "indie pop": "Indie",
    "power pop": "Indie Rock",
    "post-punk": "Alt Rock",
    grunge: "Alt Rock",
  },
};

const CITY_COUNTRY = {
  melbourne: "Australia", naarm: "Australia", sydney: "Australia", eora: "Australia",
  brisbane: "Australia", meanjin: "Australia", perth: "Australia", boorloo: "Australia",
  adelaide: "Australia", tarntanya: "Australia", canberra: "Australia",
  hobart: "Australia", nipaluna: "Australia", darwin: "Australia", "gold coast": "Australia",
  newcastle: "Australia", geelong: "Australia", wollongong: "Australia", australia: "Australia",
  auckland: "New Zealand", tamaki: "New Zealand", wellington: "New Zealand",
  "te whanganui": "New Zealand", poneke: "New Zealand", christchurch: "New Zealand",
  otautahi: "New Zealand", dunedin: "New Zealand", otepoti: "New Zealand",
  hamilton: "New Zealand", kirikiriroa: "New Zealand", "new zealand": "New Zealand",
  aotearoa: "New Zealand",
};

async function runBandcampAgent(config = {}, exclusions = {}) {
  const options = { ...DEFAULTS, ...config };
  const http = fetch;

  const cards = await harvestDiscover(http, options);
  console.log("[Bandcamp Agent] Discover cards found:", cards.length);

  const releases = [];
  for (const card of cards) {
    const combinedText = cleanText(
      `${card.artist} ${card.title} ${card.genreTag || ""} ${card.queryGenre || ""} ${card.location || ""}`
    ).toLowerCase();

    const artistCountryMapped = resolveCountry(card, combinedText, exclusions);
    const genresMapped = inferGenresMapped(combinedText, exclusions, options);
    const marketsAvailable = inferMarkets(artistCountryMapped, exclusions);
    const releaseType = card.releaseType || "album";
    const score = scoreRelease({ combinedText, releaseType, genresMapped, artistCountryMapped });
    const bucket = bucketFromScore(score);

    releases.push({
      artist: card.artist,
      title: card.title,
      releaseType,
      releaseDate: card.releaseDate || "unknown",
      articleDate: card.releaseDate || "unknown",
      sourceService: options.sourceService,
      sourceUrl: card.url,
      marketsAvailable,
      genresMapped,
      artistCountryMapped,
      score,
      bucket,
      originConfidence: card.originConfidence,
      originSource: "bandcamp-location",
      
      // additional useful fields mapped for description
      location: card.location,
      genreTag: card.genreTag
    });
  }

  console.log("[Bandcamp Agent] Total extracted before dedupe:", releases.length);
  const deduped = dedupeAndSort(releases, exclusions);

  // MAPPING TO UNIFIED AGENT FORMAT
  const unifiedResults = deduped.map(r => {
      let description = `Score: ${r.score} | Type: ${r.releaseType}`;
      if (r.location) description += ` | Loc: ${r.location}`;
      if (r.genresMapped && r.genresMapped.length) {
          description += ` | Genres: ${r.genresMapped.join(', ')}`;
      } else if (r.genreTag) {
          description += ` | Bandcamp Tag: ${r.genreTag}`;
      }

      return {
          title: `${r.artist} - ${r.title}`,
          channel: "Bandcamp Discover",
          url: r.sourceUrl,
          views: r.bucket,
          uploadedAt: r.releaseDate,
          description: description
      };
  });

  return unifiedResults;
}

// ---------------------------------------------------------------------------
// Discover harvesting
// ---------------------------------------------------------------------------

async function harvestDiscover(http, options) {
  const seen = new Set();
  const cards = [];

  outer: for (const location of options.locations) {
    for (const genre of options.genreTags) {
      let cursor = "*";
      for (let page = 0; page < options.maxPages; page++) {
        const req = buildDiscoverRequest({
          location, genre, slice: options.slice, pageSize: options.pageSize, cursor,
        });

        let data;
        try {
          data = await fetchJson(req, http, options);
        } catch (err) {
          console.error(`[Bandcamp Agent] ${location.name}/${genre} failed: ${err.message}`);
          break;
        }

        const { results, cursor: nextCursor } = parseDiscoverResponse(data);
        for (const raw of results) {
          const card = toCard(raw, location, genre);
          if (!card) continue;
          const key = `${slugify(card.artist)}::${slugify(card.title)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          cards.push(card);
          if (cards.length >= options.maxItems) break outer;
        }

        if (!nextCursor || nextCursor === cursor || results.length === 0) break;
        cursor = nextCursor;
        await sleep(options.requestDelayMs);
      }
      await sleep(options.requestDelayMs);
    }
  }
  return cards;
}

function buildDiscoverRequest({ location, genre, slice, pageSize, cursor }) {
  const body = {
    category_id: 0,
    slice,
    cursor: cursor || "*",
    size: pageSize,
    tag_norm_names: genre ? [genre] : [],
    geoname_id: location ? location.geonameId : 0,
    include_result_types: ["a"],
  };
  return { url: DEFAULTS.discoverEndpoint, body };
}

function parseDiscoverResponse(data) {
  const results =
    (data && (data.results || data.items)) ||
    (data && data.discover && data.discover.results) ||
    [];
  const cursor =
    (data && (data.cursor || data.next_cursor)) ||
    (data && data.discover && data.discover.cursor) ||
    null;
  return { results: Array.isArray(results) ? results : [], cursor };
}

function toCard(raw, locationCtx, queryGenre) {
  const artist = firstDefined(raw, ["band_name", "artist", "artist_name", "band"]);
  const title = firstDefined(raw, ["title", "album_title", "name", "item_title"]);
  if (!artist || !title) return null;

  let url = firstDefined(raw, ["item_url_path", "tralbum_url", "url", "item_url"]);
  if (!url) {
    const bandUrl = firstDefined(raw, ["band_url"]);
    const path = firstDefined(raw, ["item_url", "slug"]);
    if (bandUrl && path) {
      url = String(bandUrl).replace(/\/$/, "") + "/" + String(path).replace(/^\//, "");
    }
  }

  const rawLocation = firstDefined(raw, ["band_location", "location", "geo"]);
  const releaseDate = normalizeDate(
    firstDefined(raw, ["release_date", "new_date", "publish_date", "added_date"])
  );

  return {
    artist: cleanText(artist),
    title: cleanText(title),
    url: url || null,
    location: rawLocation || (locationCtx ? locationCtx.name : null),
    hasOwnLocation: !!rawLocation,
    queryLocationCountry: locationCtx ? locationCtx.country : null,
    genreTag: firstDefined(raw, ["genre", "primary_genre", "tag"]) || null,
    queryGenre,
    releaseDate,
    releaseType: guessReleaseType(raw),
  };
}

// ---------------------------------------------------------------------------
// Country resolution
// ---------------------------------------------------------------------------

function resolveCountry(card, combinedText, filters) {
  const artistSlug = slugify(card.artist);

  const artistHints = filters.artistCountryHints || {};
  for (const [name, country] of Object.entries(artistHints)) {
    if (slugify(name) === artistSlug) {
      card.originConfidence = 0.99;
      return country;
    }
  }

  const fromItem = countryFromLocationString(card.location);
  if (fromItem) {
    card.originConfidence = 0.85;
    return fromItem;
  }

  if (card.hasOwnLocation) {
    card.originConfidence = 0;
    return "unknown";
  }

  if (card.queryLocationCountry) {
    card.originConfidence = 0.6;
    return card.queryLocationCountry;
  }

  for (const [country, keywords] of Object.entries(filters.countryBuckets || {})) {
    for (const keyword of keywords) {
      if (combinedText.includes(String(keyword).toLowerCase())) {
        card.originConfidence = 0.6;
        return country;
      }
    }
  }

  card.originConfidence = 0;
  return "unknown";
}

function countryFromLocationString(loc) {
  if (!loc) return null;
  const l = deaccent(String(loc).toLowerCase());
  for (const key of Object.keys(CITY_COUNTRY)) {
    if (l.includes(key)) return CITY_COUNTRY[key];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Inference + scoring
// ---------------------------------------------------------------------------

function inferGenresMapped(text, filters, options) {
  const found = new Set();
  for (const [label, keywords] of Object.entries(filters.genreMappings || {})) {
    for (const keyword of keywords) {
      if (text.includes(String(keyword).toLowerCase())) found.add(label);
    }
  }
  for (const [keyword, label] of Object.entries(options.fallbackGenreLabels)) {
    if (text.includes(keyword)) found.add(label);
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

function scoreRelease({ combinedText, releaseType, genresMapped, artistCountryMapped }) {
  let score = 0;
  score += 2; 
  if (artistCountryMapped === "Australia" || artistCountryMapped === "New Zealand") score += 3;

  const directGenreCount = genresMapped.filter((g) =>
    ["Indie", "Indie Rock", "Alt Rock", "Surf Rock"].includes(g)
  ).length;
  if (directGenreCount >= 2) score += 3;
  else if (directGenreCount === 1) score += 2;
  else if (genresMapped.length > 0) score += 1;

  if (releaseType === "album") score += 2;
  else if (releaseType === "ep") score += 2;
  else if (releaseType === "single") score += 2;
  else if (releaseType === "unknown") score -= 1;

  if (
    /hip-hop|trap|drill|edm|dance|club-ready|rap|house|techno|disco/.test(combinedText) &&
    genresMapped.length === 0
  ) {
    score -= 2;
  }
  return Math.round(score * 10) / 10;
}

function bucketFromScore(score) {
  if (score >= 9) return "Best matches";
  if (score >= 5.5) return "Worth checking";
  return "Manual review";
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

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

async function fetchJson(req, http, options) {
  const response = await http(req.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": options.userAgent,
    },
    body: JSON.stringify(req.body),
    redirect: "follow",
    signal: AbortSignal.timeout ? AbortSignal.timeout(options.timeoutMs) : undefined,
  });
  if (!response.ok) throw new Error(`Bandcamp request failed: ${response.status}`);
  return response.json();
}

function guessReleaseType(raw) {
  const t = String(firstDefined(raw, ["item_type", "type"]) || "").toLowerCase();
  if (t.includes("track") || t === "t") return "single";
  const title = String(firstDefined(raw, ["title", "album_title"]) || "").toLowerCase();
  if (/\bep\b/.test(title)) return "ep";
  if (/\bsingle\b/.test(title)) return "single";
  return "album";
}

function firstDefined(obj, keys) {
  for (const k of keys) if (obj[k] != null && obj[k] !== "") return obj[k];
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function deaccent(value) {
  return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizeDate(value) {
  if (!value) return null;
  if (typeof value === "number") {
    const d = new Date(value * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[​-‍﻿]/g, "")
    .trim();
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
  runBandcampAgent
};

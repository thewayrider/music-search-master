const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");
const { extractReleasesWithAI } = require("../utils/aiScraper");
const { getBrowserHeaders, LINUX_CHROME_UA } = require("../utils/browserHeaders");
const { isWithinDays } = require("../utils/normalizer");
const { checkReleaseFreshnessITunes, check_musicbrainz_artist, inspect_source_clues } = require("../services/verificationTools");

const DEFAULTS = {
  searchName: "The Note Australia",
  baseUrl: "https://www.thenote.com.au",
  listUrl: "https://www.thenote.com.au/news?filter=new-music",
  sourceService: "The Note Australia",
  userAgent: LINUX_CHROME_UA,
  maxArticleAgeDays: 7,
  timeoutMs: 15000,
  originCacheFile: path.join(__dirname, "../../saved_searches/cache/thenote-mb-origin.json"),
};

function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

function stripWrappingQuotes(value) {
  return cleanText(value).replace(/^['"‘“]+|['"’”]+$/g, "").trim();
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseCardDateIso(text) {
  const match = cleanText(text).match(
    /\b(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d\d)/i
  );
  if (!match) return null;
  const d = new Date(match[1]);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function fetchHtml(url, options) {
  const res = await fetch(url, {
    headers: getBrowserHeaders({
      "User-Agent": options.userAgent || LINUX_CHROME_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }),
    signal: AbortSignal.timeout ? AbortSignal.timeout(options.timeoutMs) : undefined,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.text();
}

function loadOriginCache(cacheFile) {
  try {
    if (cacheFile && fs.existsSync(cacheFile)) {
      return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    }
  } catch (_) {}
  return {};
}

function saveOriginCache(cacheFile, cache) {
  try {
    if (!cacheFile) return;
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  } catch (_) {}
}

async function resolveArtistOrigin(artist, originCache, fallbackText = "") {
  const key = slugify(artist);
  if (!key) return null;
  if (Object.prototype.hasOwnProperty.call(originCache, key) && originCache[key] !== undefined) {
    return originCache[key];
  }

  let countryCode = null;
  let hadError = false;
  try {
    const mb = await check_musicbrainz_artist(artist);
    if (mb && mb.error) {
      hadError = true;
    } else if (mb && mb.found && mb.detectedCountryCode && mb.detectedCountryCode !== "UNKNOWN") {
      countryCode = mb.detectedCountryCode;
    }
  } catch (_) {
    hadError = true;
  }

  if (!countryCode && fallbackText) {
    const clue = inspect_source_clues(fallbackText);
    if (clue && clue.detectedCountry) {
      countryCode = clue.detectedCountry;
    }
  }

  if (!hadError) {
    originCache[key] = countryCode;
  }
  return countryCode;
}

/**
 * Parses `Artist – 'Song'` headings from roundup articles like Friday Favourites.
 */
function parseRoundupHeadings($) {
  const releases = [];
  $("h2").each((_, el) => {
    const text = cleanText($(el).text());
    if (/^(related articles|subscribe|never miss a beat|search)/i.test(text)) return false;

    const sepMatch = text.match(/\s+[–—-]\s+/);
    if (!sepMatch) return;
    const idx = sepMatch.index;
    const artist = cleanText(text.slice(0, idx));
    const title = stripWrappingQuotes(text.slice(idx + sepMatch[0].length));

    if (artist.length >= 2 && title.length >= 2) {
      releases.push({ artist, title, releaseType: "single" });
    }
  });
  return releases;
}

/**
 * Parses single-release news headlines, prioritizing newly shared singles over album announcements.
 */
function parseHeadlineRelease(headline) {
  const h = cleanText(headline);

  // If article announces a future album AND shares a new single, extract the single
  const sharedSingleMatch = h.match(
    /^(.+?)\s+(?:announce|announces)[^,]+,\s*(?:share|shares|drop|drops|release|releases|unveil|unveils)\s+(?:new\s+)?(?:single|track|song)\s+(?:['‘](.+?)['’](?=$|[\s.,;:!?])|["“](.+?)["”])/i
  );
  if (sharedSingleMatch) {
    return {
      artist: cleanText(sharedSingleMatch[1]),
      title: stripWrappingQuotes(sharedSingleMatch[2] || sharedSingleMatch[3]),
      releaseType: "single",
    };
  }

  // Skip pure album/EP pre-announcements that don't mention a dropped track/album release
  if (/\bannounces?\b/i.test(h) && !/\b(shares?|drops?|releases?|returns?\s+with|comes?\s+together|unveils?)\b/i.test(h)) {
    return null;
  }

  const dropMatch = h.match(
    /^(.+?)\s+(?:shares?|drops?|releases?|returns?\s+with|embraces?\b[^'‘"“]*|comes?\s+together\b[^'‘"“]*|unveils?)\s+(?:(?:a|the|their|his|her|double|new|10th|studio|debut|synth-pop|acoustic)\s+)*(?:single|track|song|album|anthem|rendition(?:\s+of)?)?\s*(?:['‘](.+?)['’](?=$|[\s.,;:!?])|["“](.+?)["”])/i
  );
  if (dropMatch) {
    const releaseType = /\balbum\b/i.test(h) ? "album" : "single";
    return {
      artist: cleanText(dropMatch[1]),
      title: stripWrappingQuotes(dropMatch[2] || dropMatch[3]),
      releaseType,
    };
  }

  return null;
}

async function runTheNoteAgent(config = {}, exclusions = {}) {
  const options = { ...DEFAULTS, ...config };
  const maxAgeDays = options.maxArticleAgeDays || 7;
  console.log(`[The Note Australia] Fetching ${options.listUrl} (window: ${maxAgeDays} days)...`);

  const html = await fetchHtml(options.listUrl, options);
  const $ = cheerio.load(html);

  const articles = [];
  const seenUrls = new Set();

  $("article").each((_, el) => {
    const linkEl = $(el).find('h3 a[href*="/news/"], a[href*="/news/"]').first();
    const href = linkEl.attr("href");
    if (!href) return;

    const fullUrl = href.startsWith("http") ? href : `${options.baseUrl}${href.startsWith("/") ? "" : "/"}${href}`;
    if (seenUrls.has(fullUrl)) return;

    const spanDate = cleanText($(el).find("span").first().text());
    const dateIso = parseCardDateIso(spanDate) || parseCardDateIso($(el).text());
    if (!dateIso || !isWithinDays(dateIso, maxAgeDays, 36)) return;

    const headline =
      cleanText($(el).find("h3, h2, h1, h4").first().text()) ||
      cleanText(linkEl.text().replace(/Read More$/i, ""));
    if (!headline) return;

    seenUrls.add(fullUrl);
    articles.push({ url: fullUrl, date: dateIso, headline });
  });

  console.log(`[The Note Australia] Found ${articles.length} recent New Music articles within ${maxAgeDays} days.`);

  const originCache = loadOriginCache(options.originCacheFile);
  const candidates = [];
  const seenTracks = new Set();

  for (const art of articles) {
    const isRoundup = /friday\s+favourites|best\s+new\s+tracks/i.test(art.headline);
    let extracted = [];

    if (isRoundup) {
      try {
        const artHtml = await fetchHtml(art.url, options);
        const $art = cheerio.load(artHtml);
        extracted = parseRoundupHeadings($art);
        if (extracted.length === 0) {
          const bodyText = cleanText($art("main, article").text());
          extracted = await extractReleasesWithAI(`${art.headline}\n${bodyText.slice(0, 10000)}`);
        }
      } catch (err) {
        console.warn(`[The Note Australia] Error fetching roundup ${art.url}:`, err.message);
      }
    } else {
      const parsed = parseHeadlineRelease(art.headline);
      if (parsed) {
        extracted = [parsed];
      } else if (!/\bannounces?\b/i.test(art.headline)) {
        try {
          const artHtml = await fetchHtml(art.url, options);
          const $art = cheerio.load(artHtml);
          const bodyText = cleanText($art("main, article").text());
          extracted = await extractReleasesWithAI(`${art.headline}\n${bodyText.slice(0, 6000)}`);
        } catch (err) {
          console.warn(`[The Note Australia] Error fetching article ${art.url}:`, err.message);
        }
      }
    }

    for (const rel of extracted) {
      if (!rel.artist || !rel.title) continue;
      const trackKey = `${slugify(rel.artist)}::${slugify(rel.title)}`;
      if (seenTracks.has(trackKey)) continue;
      seenTracks.add(trackKey);

      const freshness = await checkReleaseFreshnessITunes(rel.artist, rel.title, maxAgeDays);
      if (freshness.status === "stale") {
        console.log(`[The Note Australia] Dropped stale release (> ${maxAgeDays}d): ${rel.artist} - ${rel.title} (${freshness.earliestReleaseDate})`);
        continue;
      }

      const releaseDate = freshness.earliestReleaseDate || art.date;
      if (!isWithinDays(releaseDate, maxAgeDays, 36)) continue;

      const countryCode = await resolveArtistOrigin(rel.artist, originCache, art.headline);
      let originNote = "";
      if (countryCode === "US") {
        originNote = "Note: US artist | ";
      } else if (countryCode === "GB") {
        originNote = "Note: UK artist | ";
      } else if (countryCode) {
        originNote = `Origin: ${countryCode} | `;
      }

      const trackUrl = `${art.url}#${slugify(`${rel.artist}-${rel.title}`)}`;
      candidates.push({
        title: `${rel.artist} - ${rel.title}`,
        artist: rel.artist,
        songTitle: rel.title,
        channel: options.sourceService,
        url: trackUrl,
        views: "Worth checking",
        uploadedAt: releaseDate,
        releaseDate,
        releaseType: rel.releaseType || "single",
        description: `${originNote}Type: ${(rel.releaseType || "single").toUpperCase()} | Source: ${art.headline}`,
      });
    }
  }

  saveOriginCache(options.originCacheFile, originCache);
  console.log(`[The Note Australia] Total verified fresh releases: ${candidates.length}`);
  return candidates;
}

module.exports = {
  runTheNoteAgent,
};

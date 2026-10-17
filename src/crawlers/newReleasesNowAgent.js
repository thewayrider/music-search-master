const cheerio = require("cheerio");
const { isExcluded } = require("../utils/filterEngine");

const DEFAULTS = {
  baseUrl: "https://www.newreleasesnow.com",
  sourceService: "New Releases Now",
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  timeoutMs: 15000,
  genreSlugs: [
    "new-indie-rock-songs",
    "new-indie-pop-songs",
    "new-indie-folk-songs",
    "new-alternative-songs",
    "new-post-punk-songs"
  ],
  releaseWindowDays: 14,
  includeRss: true,
  rssUrl: "https://www.newreleasesnow.com/rss"
};

const REISSUE_REGEX = /\b(reissue|re-issue|remaster|remastered|deluxe|anniversary|expanded|edition|demo(s)?|live\s*at|live\s*from|live\s*in|best\s*of|greatest\s*hits|anthology|collection|box\s*set|soundtrack|ost)\b/i;
const REISSUE_URL_REGEX = /(?:-|\/)(reissue|re-issue|remaster|remastered|deluxe|anniversary|expanded|edition|best-of|box-set)(?:-|$|\/)/i;

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function parsePageDate(html) {
  const match = html.match(/New Albums\s*&amp;?\s*Songs\s*for\s*<span[^>]*>([^<]+)<\/span>/i);
  if (match) {
    const rawDate = cleanText(match[1]);
    const parsed = new Date(rawDate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }
  return new Date().toISOString().slice(0, 10);
}

async function fetchHtml(url, options) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": options.userAgent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      signal: AbortSignal.timeout ? AbortSignal.timeout(options.timeoutMs) : undefined
    });
    if (!res.ok) {
      console.warn(`[New Releases Now] Request failed (${res.status}) for ${url}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.warn(`[New Releases Now] Fetch error for ${url}:`, err.message);
    return null;
  }
}

/**
 * Main New Releases Now Weekly Crawler Agent.
 * Scrapes Friday LP/EP album drops across indie rock, pop, folk, alternative, and post-punk.
 * Strictly filters out reissues, deluxe editions, and back-catalog older than releaseWindowDays.
 */
async function runNewReleasesNowAgent(config = {}, exclusions = {}) {
  const options = { ...DEFAULTS, ...config };
  console.log(`\n[${options.sourceService} Agent] Starting weekly discovery across ${options.genreSlugs.length} genre channels (window: ${options.releaseWindowDays} days)...`);

  const now = new Date();
  const maxAgeMs = options.releaseWindowDays * 24 * 60 * 60 * 1000;
  const candidatesMap = new Map();
  let defaultDate = new Date().toISOString().slice(0, 10);

  // 1. Scrape target genre pages
  for (const genreSlug of options.genreSlugs) {
    const pageUrl = `${options.baseUrl}/${genreSlug}`;
    console.log(`[${options.sourceService}] Fetching genre page: /${genreSlug}`);
    const html = await fetchHtml(pageUrl, options);
    if (!html) continue;

    defaultDate = parsePageDate(html);
    const $ = cheerio.load(html);

    $("article.release-card, .release-card").each((_, el) => {
      const artist = cleanText($(el).find(".small-heading").first().text());
      const title = cleanText($(el).find(".title").first().text());
      let link = $(el).find('a[href*="/album/"]').first().attr("href") || "";
      if (link && !link.startsWith("http")) {
        link = `${options.baseUrl}${link.startsWith('/') ? '' : '/'}${link}`;
      }
      const genres = $(el).find(".genres a").map((_, g) => cleanText($(g).text())).get().join(", ");
      const rawDate = cleanText($(el).find(".release-date").text());

      if (!artist || !title) return;

      // Reissue / Deluxe / Catalog Quarantine
      if (REISSUE_REGEX.test(title) || REISSUE_REGEX.test(artist) || REISSUE_URL_REGEX.test(link) || /\breissue\b/i.test(genres)) {
        return;
      }

      // Reject Various Artists compilations
      if (/^various(\s+artists)?$/i.test(artist)) {
        return;
      }

      // Parse individual release date from the card
      let releaseDateIso = null;
      if (rawDate) {
        const parsedDate = new Date(rawDate);
        if (!Number.isNaN(parsedDate.getTime())) {
          const ageMs = now.getTime() - parsedDate.getTime();
          // Filter out releases older than releaseWindowDays (e.g. 14 days)
          if (ageMs > maxAgeMs) {
            return;
          }
          releaseDateIso = parsedDate.toISOString().slice(0, 10);
        }
      }

      if (!releaseDateIso) {
        releaseDateIso = defaultDate;
      }

      // Exclusions check
      if (isExcluded(`${artist} ${title}`, exclusions)) return;

      const trackKey = `${slugify(artist)}::${slugify(title)}`;
      if (!candidatesMap.has(trackKey)) {
        candidatesMap.set(trackKey, {
          artist,
          title,
          link: link || `${options.baseUrl}/${genreSlug}`,
          genres: genres || "Indie",
          date: releaseDateIso,
          releaseType: "album"
        });
      } else {
        // Merge genres if seen across multiple pages
        const existing = candidatesMap.get(trackKey);
        if (genres && !existing.genres.includes(genres)) {
          existing.genres = `${existing.genres}, ${genres}`;
        }
      }
    });
  }

  // 2. Optionally scrape RSS feed for featured highlights
  if (options.includeRss && options.rssUrl) {
    console.log(`[${options.sourceService}] Checking weekly RSS feed: ${options.rssUrl}`);
    const xml = await fetchHtml(options.rssUrl, options);
    if (xml) {
      const $rss = cheerio.load(xml, { xmlMode: true });
      $rss("item").each((_, el) => {
        const rawTitle = cleanText($rss(el).find("title").text());
        const link = cleanText($rss(el).find("link").text());
        const pubDateStr = $rss(el).find("pubDate").text();
        let pubDateIso = defaultDate;
        if (pubDateStr) {
          const d = new Date(pubDateStr);
          if (!Number.isNaN(d.getTime())) {
            const ageMs = now.getTime() - d.getTime();
            if (ageMs > maxAgeMs) return;
            pubDateIso = d.toISOString().slice(0, 10);
          }
        }

        if (rawTitle.includes(" - ")) {
          const parts = rawTitle.split(" - ").map(s => cleanText(s));
          if (parts.length >= 2) {
            const artist = parts[0];
            const title = parts.slice(1).join(" - ");

            // Reissue / Deluxe check on RSS items
            if (REISSUE_REGEX.test(title) || REISSUE_REGEX.test(artist) || REISSUE_URL_REGEX.test(link)) {
              return;
            }

            if (/^various(\s+artists)?$/i.test(artist)) {
              return;
            }

            if (isExcluded(`${artist} ${title}`, exclusions)) return;

            const trackKey = `${slugify(artist)}::${slugify(title)}`;
            if (!candidatesMap.has(trackKey)) {
              candidatesMap.set(trackKey, {
                artist,
                title,
                link: link || options.baseUrl,
                genres: "Featured Drop",
                date: pubDateIso,
                releaseType: "album"
              });
            }
          }
        }
      });
    }
  }

  console.log(`[${options.sourceService} Agent] Discovered ${candidatesMap.size} distinct candidate releases.`);

  // 3. Transform to standard crawler result items
  const results = [];
  for (const item of candidatesMap.values()) {
    results.push({
      title: `${item.artist} - ${item.title}`,
      artist: item.artist,
      trackTitle: item.title,
      songTitle: item.title,
      channel: options.sourceService,
      url: item.link,
      views: "Worth checking",
      uploadedAt: item.date,
      releaseType: item.releaseType,
      description: `Type: ${item.releaseType.toUpperCase()} | Genres: ${item.genres}`
    });
  }

  return results;
}

module.exports = {
  runNewReleasesNowAgent
};

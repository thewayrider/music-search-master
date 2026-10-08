const cheerio = require("cheerio");
const { extractReleasesWithAI } = require("../utils/aiScraper");

const DEFAULTS = {
  baseUrl: "https://nialler9.com",
  rssUrl: "https://nialler9.com/feed/",
  sourceService: "Nialler9",
  defaultCountry: "Ireland",
  userAgent: "music-release-agent/1.0 (+https://kimrampling.com)",
  maxArticleAgeDays: 14,
  perPage: 6
};

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function fetchArticleHtml(url, userAgent) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": userAgent } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Parses structured Artist - Title headings from roundup articles.
 */
function parseHeadingsCheerio($) {
  const candidates = [];
  $("h2, h3, h4").each((_, el) => {
    const text = cleanText($(el).text());
    if (text.includes("Newsletter") || text.includes("Leave a Reply") || text.includes("Enjoying Nialler9")) return;

    if (text.includes("–") || text.includes(" - ")) {
      const sep = text.includes("–") ? "–" : " - ";
      const parts = text.split(sep).map(s => cleanText(s));
      if (parts.length === 2 && parts[0].length >= 2 && parts[1].length >= 2) {
        // Skip common meta-headings
        if (/best new albums|best songs|also released/i.test(parts[0])) return;
        candidates.push({
          artist: parts[0],
          title: parts[1],
          releaseType: "album/single"
        });
      }
    }
  });
  return candidates;
}

async function runNialler9Agent(config = {}, exclusions = {}) {
  const options = { ...DEFAULTS, ...config };
  const cutoffTime = Date.now() - (options.maxArticleAgeDays * 24 * 60 * 60 * 1000);

  console.log(`[${options.sourceService} Agent] Fetching feed from: ${options.rssUrl}`);

  let xmlText = "";
  try {
    const res = await fetch(options.rssUrl, {
      headers: { "User-Agent": options.userAgent, Accept: "application/rss+xml, application/xml, text/xml" }
    });
    if (!res.ok) throw new Error(`Feed request failed (${res.status})`);
    xmlText = await res.text();
  } catch (err) {
    console.error(`[${options.sourceService} Agent] Feed fetch error:`, err.message);
    return [];
  }

  const $rss = cheerio.load(xmlText, { xmlMode: true });
  const articles = [];

  $rss("item").each((_, el) => {
    if (articles.length >= options.perPage) return;
    const title = cleanText($rss(el).find("title").text());
    const link = cleanText($rss(el).find("link").text());
    const pubDateStr = $rss(el).find("pubDate").text();
    const pubTime = new Date(pubDateStr).getTime();

    // Check age window
    if (Number.isFinite(pubTime) && pubTime < cutoffTime) return;

    // Filter for release-focused articles
    const isReleaseFocused = /album|song|track|ep\b|release|review|single|new music|–/i.test(title);
    const isGigOrTour = /tour date|free palestine tour|festival lineup|in concert/i.test(title);

    if (!isReleaseFocused || isGigOrTour) return;

    const dateFormatted = Number.isFinite(pubTime) ? new Date(pubTime).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    articles.push({ title, link, date: dateFormatted });
  });

  console.log(`[${options.sourceService} Agent] Found ${articles.length} release articles within the last ${options.maxArticleAgeDays} days.`);

  const items = [];
  const seenTracks = new Set();

  for (const art of articles) {
    console.log(`[${options.sourceService} Agent] Processing: ${art.title} (${art.date})`);
    const html = await fetchArticleHtml(art.link, options.userAgent);
    if (!html) continue;

    const $ = cheerio.load(html);
    let releases = parseHeadingsCheerio($);

    // If Cheerio didn't find structured headings, fall back to AI release extraction
    if (releases.length === 0) {
      console.log(`[${options.sourceService} Agent] No structured headings found, falling back to AI extraction...`);
      $('br, p, div, h1, h2, h3, h4, h5, h6, li, strong, b').append(' ');
      const bodyText = cleanText($.text());
      releases = await extractReleasesWithAI(art.title + "\n" + bodyText.substring(0, 8000));
    }

    for (const rel of releases) {
      if (!rel.artist || !rel.title) continue;

      const trackKey = `${slugify(rel.artist)}::${slugify(rel.title)}`;
      if (seenTracks.has(trackKey)) continue;
      seenTracks.add(trackKey);

      const trackUrl = `${art.link}#${slugify(rel.artist + '-' + rel.title)}`;
      let desc = `Type: ${rel.releaseType || 'album/single'} | Country: ${options.defaultCountry}`;
      if (rel.genres) desc += ` | Genres: ${rel.genres}`;

      items.push({
        title: `${rel.artist} - ${rel.title}`,
        channel: options.sourceService,
        url: trackUrl,
        views: "Worth checking",
        uploadedAt: art.date,
        description: desc
      });
    }
  }

  console.log(`[${options.sourceService} Agent] Total distinct releases found: ${items.length}`);
  return items;
}

module.exports = {
  runNialler9Agent
};

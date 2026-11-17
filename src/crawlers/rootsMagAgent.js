const cheerio = require("cheerio");
const { getBrowserHeaders, getRssHeaders, LINUX_CHROME_UA } = require("../utils/browserHeaders");
const { checkReleaseFreshnessITunes } = require("../services/verificationTools");

const DEFAULTS = {
  baseUrl: "https://www.rootsmag.nz/new-music-",
  sourceService: "Roots Mag",
  userAgent: LINUX_CHROME_UA,
  timeoutMs: 10000,
  enableNzMusician: true,
  nzMusicianFeedUrl: "https://nzmusician.co.nz/category/music/feed/",
  nzMusicianMaxAgeDays: 7,
  maxAgeDays: 7
};

const TYPE_PATTERNS = [
  { re: /\(ALBUM\)/i,  type: "Album"  },
  { re: /\(EP\)/i,     type: "EP"     },
  { re: /\(SINGLE\)/i, type: "Single" },
];

function parseReleaseType(headingText) {
  for (const { re, type } of TYPE_PATTERNS) {
    if (re.test(headingText)) return type;
  }
  return "Single";
}

function cleanTitle(raw) {
  return raw.replace(/\s*\((ALBUM|EP|SINGLE)\)\s*$/i, "").trim();
}

function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function candidateSlugs(referenceDate = new Date(), maxDays = 7) {
  const entries = [];
  for (let offset = 0; offset <= maxDays; offset++) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() - offset);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const slug = `${dd}-${mm}`;
    if (!entries.some(e => e.slug === slug)) {
      entries.push({ slug, dateStr: d.toISOString().slice(0, 10) });
    }
  }
  return entries;
}

async function fetchText(url, options) {
  const response = await fetch(url, {
    headers: getBrowserHeaders({
      "User-Agent": options.userAgent || LINUX_CHROME_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }),
    redirect: "follow",
    signal: AbortSignal.timeout ? AbortSignal.timeout(options.timeoutMs) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} for ${url}`);
  }

  return response.text();
}

/**
 * Polls the NZ Musician RSS feed for recent artist/release features.
 */
async function fetchNzMusicianReleases(options = {}) {
  const feedUrl = options.nzMusicianFeedUrl || DEFAULTS.nzMusicianFeedUrl;
  const maxAgeDays = options.nzMusicianMaxAgeDays || DEFAULTS.nzMusicianMaxAgeDays;
  const cutoffTime = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);

  console.log(`[RootsMag Agent -> NZ Musician] Checking feed from: ${feedUrl}`);

  let xmlText = "";
  try {
    const res = await fetch(feedUrl, {
      headers: getRssHeaders({
        "User-Agent": options.userAgent || LINUX_CHROME_UA
      }),
      signal: AbortSignal.timeout ? AbortSignal.timeout(options.timeoutMs || 10000) : undefined
    });
    if (!res.ok) {
      console.warn(`[RootsMag Agent -> NZ Musician] Feed returned status ${res.status}`);
      return [];
    }
    xmlText = await res.text();
  } catch (err) {
    console.warn(`[RootsMag Agent -> NZ Musician] Feed fetch error:`, err.message);
    return [];
  }

  const $ = cheerio.load(xmlText, { xmlMode: true });
  const items = [];

  $("item").each((_, el) => {
    const rawTitle = $(el).find("title").text().trim();
    const link = $(el).find("link").text().trim();
    const pubDate = $(el).find("pubDate").text().trim();
    const pubTime = new Date(pubDate).getTime();

    // Check age window
    if (Number.isFinite(pubTime) && pubTime < cutoffTime) return;

    // Check separator: '–', '—', ':', or '-'
    if (rawTitle.includes("–") || rawTitle.includes("—") || rawTitle.includes(":") || rawTitle.includes(" - ")) {
      const sep = rawTitle.includes("–") ? "–" : (rawTitle.includes("—") ? "—" : (rawTitle.includes(":") ? ":" : " - "));
      const parts = rawTitle.split(sep).map(s => s.trim());
      if (parts.length === 2 && parts[0].length >= 2 && parts[1].length >= 2) {
        const artist = parts[0];
        const title = parts[1];
        const dateStr = Number.isFinite(pubTime) ? new Date(pubTime).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

        items.push({
          title: `${artist} - ${title}`,
          channel: "NZ Musician",
          url: link,
          views: "Feature spotlight",
          uploadedAt: dateStr,
          description: "Type: Single/EP feature | Genres: Indie/Pop/Alternative (NZ)"
        });
      }
    }
  });

  console.log(`[RootsMag Agent -> NZ Musician] Found ${items.length} recent releases within ${maxAgeDays} days.`);
  return items;
}

async function runRootsMagAgent(config = {}, exclusions = {}) {
  const options = { ...DEFAULTS, ...config };
  const maxAgeDays = options.maxAgeDays || options.nzMusicianMaxAgeDays || 7;
  const slugEntries = candidateSlugs(new Date(), maxAgeDays);
  let html = null;
  let sourceUrl = null;
  let postDateStr = new Date().toISOString().split('T')[0];

  // 1. Scrape Roots Mag NZ weekly post
  for (const { slug, dateStr } of slugEntries) {
    const url = `${options.baseUrl}${slug}/`;
    try {
      html = await fetchText(url, options);
      if (html && html.length > 500) {
        console.log(`[RootsMag Agent] Found post at ${url} (${dateStr})`);
        sourceUrl = url;
        postDateStr = dateStr;
        break;
      }
    } catch (e) {
      // Ignore errors (404s) and try the next slug
    }
  }

  const rootsCandidates = [];

  if (html) {
    const $ = cheerio.load(html);

    $("h2").each((_, el) => {
      const headingText = $(el).text().trim();

      if (!headingText.includes("—") && !headingText.includes("–")) return;

      const sep   = headingText.includes("—") ? "—" : "–";
      const parts = headingText.split(sep);
      if (parts.length < 2) return;

      const artist   = parts[0].trim();
      const rawTitle = parts.slice(1).join(sep).trim();
      const releaseType = parseReleaseType(rawTitle);
      const title       = cleanTitle(rawTitle);

      if (!artist || !title) return;

      rootsCandidates.push({
        artist,
        title,
        releaseType,
        sourceUrl
      });
    });

    console.log(`[RootsMag Agent] Parsed ${rootsCandidates.length} candidates from ${sourceUrl}`);
  } else {
    console.warn("[RootsMag Agent] No post found for any candidate slug this week.");
  }

  // Filter Roots Mag candidates against iTunes earliest release date (> 7d stale guard)
  const rootsResults = [];
  for (const r of rootsCandidates) {
    const freshness = await checkReleaseFreshnessITunes(r.artist, r.title, maxAgeDays);
    if (freshness.status === "stale") {
      console.log(`[RootsMag Agent] Dropped stale track (> ${maxAgeDays}d): ${r.artist} - ${r.title} (${freshness.earliestReleaseDate})`);
      continue;
    }
    const releaseDate = freshness.earliestReleaseDate || postDateStr;
    const description = `Type: ${r.releaseType} | Genres: Roots/Indie (NZ)`;
    const trackAnchor = slugify(`${r.artist}-${r.title}`);
    rootsResults.push({
      title: `${r.artist} - ${r.title}`,
      channel: "Roots Mag",
      url: `${r.sourceUrl}#${trackAnchor}`,
      views: "Manual review",
      uploadedAt: releaseDate,
      releaseDate,
      description: description
    });
  }

  // 2. Poll NZ Musician features (if enabled)
  let nzMusicianResults = [];
  if (options.enableNzMusician !== false) {
    try {
      const rawNz = await fetchNzMusicianReleases({ ...options, nzMusicianMaxAgeDays: maxAgeDays });
      for (const item of rawNz) {
        const [artist, ...rest] = item.title.split(" - ");
        const title = rest.join(" - ");
        const freshness = await checkReleaseFreshnessITunes(artist, title, maxAgeDays);
        if (freshness.status === "stale") {
          console.log(`[RootsMag Agent -> NZ Musician] Dropped stale track (> ${maxAgeDays}d): ${item.title} (${freshness.earliestReleaseDate})`);
          continue;
        }
        const releaseDate = freshness.earliestReleaseDate || item.uploadedAt;
        nzMusicianResults.push({ ...item, uploadedAt: releaseDate, releaseDate });
      }
    } catch (nzErr) {
      console.warn("[RootsMag Agent] NZ Musician integration error:", nzErr.message);
    }
  }

  // 3. Combine both New Zealand sources
  const combined = rootsResults.concat(nzMusicianResults);
  console.log(`[RootsMag Agent] Combined NZ pool: ${combined.length} total releases (${rootsResults.length} from Roots Mag, ${nzMusicianResults.length} from NZ Musician).`);

  return combined;
}

module.exports = {
  runRootsMagAgent,
  fetchNzMusicianReleases
};

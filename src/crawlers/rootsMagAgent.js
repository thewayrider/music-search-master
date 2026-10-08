const cheerio = require("cheerio");

const DEFAULTS = {
  baseUrl: "https://www.rootsmag.nz/new-music-",
  sourceService: "Roots Mag",
  userAgent: "music-release-agent/1.0 (+https://kimrampling.com)",
  timeoutMs: 10000,
  enableNzMusician: true,
  nzMusicianFeedUrl: "https://nzmusician.co.nz/category/music/feed/",
  nzMusicianMaxAgeDays: 14
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

function candidateSlugs(referenceDate = new Date()) {
  const slugs = [];
  for (let offset = 0; offset <= 7; offset++) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() - offset);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    slugs.push(`${dd}-${mm}`);
  }
  return [...new Set(slugs)];
}

async function fetchText(url, options) {
  const response = await fetch(url, {
    headers: {
      "user-agent": options.userAgent,
      accept: "text/html,application/xhtml+xml",
    },
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
      headers: {
        "user-agent": options.userAgent || DEFAULTS.userAgent,
        accept: "application/rss+xml, application/xml, text/xml"
      },
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
  const slugs = candidateSlugs();
  let html = null;
  let sourceUrl = null;

  // 1. Scrape Roots Mag NZ weekly post
  for (const slug of slugs) {
    const url = `${options.baseUrl}${slug}/`;
    try {
      html = await fetchText(url, options);
      if (html && html.length > 500) {
        console.log(`[RootsMag Agent] Found post at ${url}`);
        sourceUrl = url;
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

  // Map Roots Mag candidates to unified format
  const rootsResults = rootsCandidates.map(r => {
    let description = `Type: ${r.releaseType} | Genres: Roots/Indie (NZ)`;
    const trackAnchor = slugify(`${r.artist}-${r.title}`);
    return {
      title: `${r.artist} - ${r.title}`,
      channel: "Roots Mag",
      url: `${r.sourceUrl}#${trackAnchor}`,
      views: "Manual review",
      uploadedAt: new Date().toISOString().split('T')[0],
      description: description
    };
  });

  // 2. Poll NZ Musician features (if enabled)
  let nzMusicianResults = [];
  if (options.enableNzMusician !== false) {
    try {
      nzMusicianResults = await fetchNzMusicianReleases(options);
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

const cheerio = require("cheerio");
const { extractReleasesWithAI } = require("../utils/aiScraper");
const { getBrowserHeaders, LINUX_CHROME_UA } = require("../utils/browserHeaders");
const { isWithinDays } = require("../utils/normalizer");
const { checkReleaseFreshnessITunes } = require("../services/verificationTools");

const DEFAULTS = {
  baseUrl: "https://www.abc.net.au/triplejunearthed",
  sourceService: "Triple J Unearthed",
  userAgent: LINUX_CHROME_UA,
  runWindowDays: 7,
};

// The strict genre combinations requested by the user, converted to Sets for order-agnostic matching.
const ALLOWED_SETS = [
    new Set(['pop', 'rock', 'indie']),
    new Set(['pop', 'indie']),
    new Set(['indie', 'rock']),       // Also covers Rock/Indie
    new Set(['rock', 'indie', 'experimental']),
    new Set(['indie', 'pop', 'electronic'])
];

function parseGenresToSet(genreString) {
    if (!genreString || typeof genreString !== 'string') return new Set();
    // Replace non-alphabetic characters (like '/', ',', '&') with spaces and split
    const words = genreString.toLowerCase().replace(/[^a-z]+/g, ' ').trim().split(/\s+/);
    return new Set(words.filter(w => w.length > 0));
}

function isAllowedGenreSet(genreString) {
    const trackSet = parseGenresToSet(genreString);
    if (trackSet.size === 0) return false;
    
    for (const allowedSet of ALLOWED_SETS) {
        if (trackSet.size === allowedSet.size && [...trackSet].every(g => allowedSet.has(g))) {
            return true;
        }
    }
    return false;
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

/**
 * Extracts structured track entries (with exact uploadedOn timestamps) from Next.js SSR data.
 */
function extractTracksFromNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return null;

  try {
    const nextData = JSON.parse(match[1]);
    const props = nextData?.props?.pageProps;
    if (!props) return null;

    const ts = props.tracksShowcase || {};
    const reviews = props.reviewsShowcase?.reviews || [];
    const rawTracks = [
      ts.trackOfTheDay,
      ...(Array.isArray(ts.popularTracks) ? ts.popularTracks : []),
      ...(Array.isArray(ts.discoverTracks) ? ts.discoverTracks : []),
      ...reviews.map(r => r && r.track)
    ].filter(Boolean);

    const seen = new Set();
    const deduped = [];
    for (const t of rawTracks) {
      const artist = cleanText(t.artist?.profileName);
      const title = cleanText(t.title);
      if (!artist || !title) continue;
      const key = `${artist.toLowerCase()}::${title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      deduped.push({
        artist,
        title,
        slug: t.artist?.slug || "",
        uploadedOn: t.uploadedOn || null,
        genres: Array.isArray(t.genres) ? t.genres.join(" / ") : "",
        releaseType: "single"
      });
    }
    return deduped;
  } catch {
    return null;
  }
}

async function runTripleJUnearthedAgent(config = {}, exclusions = {}) {
  const options = { ...DEFAULTS, ...config };
  const runWindowDays = options.runWindowDays || 7;
  console.log(`[Triple J Unearthed Agent] Fetching main page HTML (window: ${runWindowDays} days)...`);

  const res = await fetch(options.baseUrl, {
    headers: getBrowserHeaders({ "User-Agent": options.userAgent, Accept: "text/html" }),
  });
  
  if (!res || !res.ok) {
    throw new Error(`Unearthed: Fetch failed (${res && res.status})`);
  }
  
  const html = await res.text();
  const structuredTracks = extractTracksFromNextData(html);

  const items = [];
  if (structuredTracks && structuredTracks.length > 0) {
    console.log(`[Triple J Unearthed Agent] Parsed ${structuredTracks.length} structured tracks from __NEXT_DATA__.`);
    let staleCount = 0;

    for (const rel of structuredTracks) {
      if (!isAllowedGenreSet(rel.genres)) continue;

      if (!isWithinDays(rel.uploadedOn, runWindowDays, 36)) {
        staleCount++;
        continue;
      }

      // Guard against older commercial releases re-uploaded to Unearthed
      const itunesCheck = await checkReleaseFreshnessITunes(rel.artist, rel.title, runWindowDays);
      if (itunesCheck.status === "stale") {
        staleCount++;
        console.log(`[Triple J Unearthed Agent] Dropped stale commercial release: ${rel.artist} - ${rel.title} (${itunesCheck.earliestReleaseDate})`);
        continue;
      }

      const uploadDate = itunesCheck.earliestReleaseDate || rel.uploadedOn.slice(0, 10);
      if (!isWithinDays(uploadDate, runWindowDays, 36)) {
        staleCount++;
        continue;
      }

      items.push({ ...rel, uploadDate });
    }
    console.log(`[Triple J Unearthed Agent] Kept ${items.length} fresh indie tracks (filtered ${staleCount} older than ${runWindowDays}d).`);
  } else {
    const $ = cheerio.load(html);
    $('br, p, div, h1, h2, h3, h4, h5, h6, li, strong, b, span').append(' ');
    const bodyText = cleanText($('body').text());

    console.log(`[Triple J Unearthed Agent] __NEXT_DATA__ unavailable; falling back to AI extraction...`);
    const aiResults = await extractReleasesWithAI(bodyText);

    for (const rel of aiResults) {
      if (!isAllowedGenreSet(rel.genres)) continue;
      const itunesCheck = await checkReleaseFreshnessITunes(rel.artist, rel.title, runWindowDays);
      if (itunesCheck.status === "fresh") {
        items.push({ ...rel, uploadDate: itunesCheck.earliestReleaseDate });
      }
    }
  }

  // MAPPING TO UNIFIED AGENT FORMAT
  const unifiedResults = items.map(r => {
      const displayGenres = r.genres ? r.genres.replace(/[^a-zA-Z]/g, ' ').replace(/\s+/g, ' / ').trim() : 'Unknown';
      const description = `Type: ${r.releaseType || 'single'} | Genres: ${displayGenres}`;
      const trackUrl = r.slug ? `${options.baseUrl}/artist/${r.slug}` : options.baseUrl;

      return {
          title: `${r.artist} - ${r.title}`,
          channel: "Triple J Unearthed",
          url: trackUrl,
          views: "Manual review",
          uploadedAt: r.uploadDate,
          releaseDate: r.uploadDate,
          description: description
      };
  });

  console.log(`[Triple J Unearthed Agent] Final tracks matched: ${unifiedResults.length}`);
  return unifiedResults;
}

module.exports = { runTripleJUnearthedAgent };

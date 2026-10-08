const cheerio = require("cheerio");
const { extractReleasesWithAI } = require("../utils/aiScraper");

const DEFAULTS = {
  baseUrl: "https://www.abc.net.au/triplejunearthed",
  sourceService: "Triple J Unearthed",
  userAgent: "music-release-agent/1.0 ( https://kimrampling.com )",
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

async function runTripleJUnearthedAgent(config = {}, exclusions = {}) {
  const options = { ...DEFAULTS, ...config };
  console.log(`[Triple J Unearthed Agent] Fetching main page HTML...`);

  const res = await fetch(options.baseUrl, {
    headers: { "User-Agent": options.userAgent, Accept: "text/html" },
  });
  
  if (!res || !res.ok) {
    throw new Error(`Unearthed: Fetch failed (${res && res.status})`);
  }
  
  const html = await res.text();
  const $ = cheerio.load(html);
  
  // Extract clean text from the body, adding spaces to block elements to prevent word joining
  $('br, p, div, h1, h2, h3, h4, h5, h6, li, strong, b, span').append(' ');
  const bodyText = cleanText($('body').text());

  console.log(`[Triple J Unearthed Agent] AI extracting from full page content...`);
  const aiResults = await extractReleasesWithAI(bodyText);

  console.log(`[Triple J Unearthed Agent] Extracted ${aiResults.length} total tracks. Filtering by strict genre combinations...`);

  const items = [];
  for (const rel of aiResults) {
      if (isAllowedGenreSet(rel.genres)) {
          items.push(rel);
      } else {
          console.log(`[Triple J Unearthed Agent] Filtering out: ${rel.artist} - ${rel.title} (Genres: ${rel.genres || 'none'})`);
      }
  }

  // MAPPING TO UNIFIED AGENT FORMAT
  const unifiedResults = items.map(r => {
      // Format genres for description display
      const displayGenres = r.genres ? r.genres.replace(/[^a-zA-Z]/g, ' ').replace(/\s+/g, ' / ').trim() : 'Unknown';
      let description = `Type: ${r.releaseType} | Genres: ${displayGenres}`;

      return {
          title: `${r.artist} - ${r.title}`,
          channel: "Triple J Unearthed",
          url: options.baseUrl, // Unearthed doesn't easily provide direct article links on the main page without deep parsing
          views: "Manual review", // Defaulting bucket since we are bypassing scoring
          uploadedAt: "unknown", // Bypassing release date checks
          description: description
      };
  });

  console.log(`[Triple J Unearthed Agent] Final tracks matched: ${unifiedResults.length}`);
  return unifiedResults;
}

module.exports = { runTripleJUnearthedAgent };

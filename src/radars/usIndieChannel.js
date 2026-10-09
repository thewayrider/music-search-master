const cheerio = require('cheerio');
const { isWithinHours, hasNegativeKeywords, parseArtistTitle, sanitizeHeadline } = require('../utils/normalizer');

async function harvestUSIndieDaily(config = {}, exclusions = {}) {
  // On Mondays, expand window to 72h to capture Friday afternoon/weekend US drops
  const dayOfWeek = new Date().getDay(); // 1 = Monday
  const defaultHours = dayOfWeek === 1 ? 72 : (config.maxRecencyHours || 36);
  const maxHours = config.maxRecencyHours || defaultHours;
  const negativeKeywords = exclusions.negativeKeywords || [];

  const usFeeds = [
    { name: "BrooklynVegan", url: "https://www.brooklynvegan.com/feed/", region: "US (New York/National)" },
    { name: "Stereogum", url: "https://www.stereogum.com/feed/", region: "US (National Premieres)" },
    { name: "The Big Takeover", url: "https://bigtakeover.com/rss", region: "US (Indie/Post-Punk Premieres)" },
    { name: "Gorilla vs Bear", url: "https://www.gorillavsbear.net/feed/", region: "US (Texas/National)" },
    { name: "Aquarium Drunkard", url: "https://aquariumdrunkard.com/feed/", region: "US (LA/National)" },
    { name: "Austin Town Hall", url: "https://austintownhall.com/feed/", region: "US (Austin Indie)" },
    { name: "Glide Magazine", url: "https://glidemagazine.com/feed/", region: "US (Indie Music)" },
    { name: "Post-Trash", url: "https://post-trash.com/news?format=rss", region: "US (DIY Underground)" }
  ];

  console.log(`[US Indie Channel] Checking ${usFeeds.length} premier US indie rock tastemaker feeds (Window: ${maxHours}h)...`);

  const discoveries = [];
  const seenUrls = new Set();

  for (const feed of usFeeds) {
    try {
      const res = await fetch(feed.url, {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        },
        signal: AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined
      });

      if (!res.ok) continue;

      const xml = await res.text();
      const $ = cheerio.load(xml, { xmlMode: true });

      $('item').each((i, el) => {
        const title = $(el).find('title').text().trim();
        const link = $(el).find('link').text().trim();
        const pubDate = $(el).find('pubDate').text().trim();
        const desc = $(el).find('description').text().trim();

        if (!title || !link || seenUrls.has(link)) return;

        // Skip non-release article sections (podcasts, radio shows, interviews, festival tours, album reviews, archival recordings)
        if (/\/(shows|interviews|radio|podcast|podcasts|events|tour|tours|festival|galleries|photos|contest|recordings|reviews?|album-review)\//i.test(link)) {
          return;
        }

        // Reject retrospective reviews (album reviews are posted weeks/months after street date)
        if (/\|\s*(album\s+review|track\s+review|review)|album\s+review:|track\s+review:|album-review/i.test(title) || /album-review/i.test(link)) {
          return;
        }

        // Check strict recency
        if (!isWithinHours(pubDate, maxHours)) return;

        // Check negative keywords (interviews, tour announcements, festival lineups)
        const fullText = `${title} ${desc}`;
        if (hasNegativeKeywords(fullText, negativeKeywords)) return;

        // Strip label parentheticals e.g. (self-released), (ATOM Records), (Aenaos Records)
        let cleanTitle = title
          .replace(/\s*\([a-z0-9\s&._-]+(?:records|recordings|music|self-released)\)/gi, '')
          .replace(/^(stream|listen\s*to|watch|hear|share)\s+/i, '')
          .replace(/\s*\|\s*(stream|listen|watch|premiere|video|post-trash premiere).*$/i, '');

        // Reject podcast / radio show titles
        if (/takeover\s*show|show\s*[—–-]\s*number|episode\s*\d+/i.test(cleanTitle)) {
          return;
        }

        let parsed = parseArtistTitle(cleanTitle);

        // Headline regex matching for "Artist shares new single 'Song'"
        if (parsed.artist === "Unknown Artist" && !cleanTitle.includes(" - ") && !cleanTitle.includes(" – ")) {
          const matchWith = cleanTitle.match(/^(.+?)\s+(?:share|release|announce|drop|debut|unveil)s?\s+(?:new\s+single|new\s+song|new\s+track|new\s+video|single|video)\s+['"“](.+?)['"”]/i);
          if (matchWith) {
            parsed.artist = sanitizeHeadline(matchWith[1]);
            parsed.title = sanitizeHeadline(matchWith[2]);
          } else {
            return;
          }
        }

        seenUrls.add(link);
        discoveries.push({
          artist: parsed.artist,
          title: parsed.title,
          channel: feed.name,
          url: link,
          releaseDate: new Date(pubDate).toISOString().slice(0, 10),
          releaseType: "single",
          genre: "US Indie Rock / Alternative",
          location: feed.region,
          description: `US Premiere on ${feed.name} (${feed.region}) | ${new Date(pubDate).toISOString().slice(0, 10)}`
        });
      });
    } catch (e) {
      // Continue quietly
    }
  }

  console.log(`[US Indie Channel] Found ${discoveries.length} verified US indie premieres in the last ${maxHours}h.`);
  return discoveries;
}

module.exports = {
  harvestUSIndieDaily
};

const cheerio = require('cheerio');
const { isWithinHours, hasNegativeKeywords, parseArtistTitle } = require('../utils/normalizer');

async function harvestBlogsDaily(config = {}, exclusions = {}) {
  const channelConfig = config.channels?.blogs || {};
  if (!channelConfig.enabled) return [];

  const feeds = channelConfig.feeds || [
    { name: "Post-Trash", url: "https://post-trash.com/news?format=rss", region: "US/Global DIY" },
    { name: "The Line of Best Fit", url: "https://www.thelineofbestfit.com/rss", region: "UK/Global" },
    { name: "Clash Music", url: "https://www.clashmusic.com/feed/", region: "UK/Global" },
    { name: "Austin Town Hall", url: "https://austintownhall.com/feed/", region: "US Indie" },
    { name: "Various Small Flames", url: "https://varioussmallflames.co.uk/feed/", region: "UK/Europe Indie" }
  ];

  const maxHours = config.maxRecencyHours || 36;
  const negativeKeywords = exclusions.negativeKeywords || [];

  const discoveries = [];
  const seenUrls = new Set();

  console.log(`[Blogs Channel] Checking ${feeds.length} live indie review RSS feeds...`);

  for (const feed of feeds) {
    try {
      const res = await fetch(feed.url, {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
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

        // Check strict recency
        if (!isWithinHours(pubDate, maxHours)) return;

        // Check negative keywords (interviews, podcasts, reissues)
        const fullText = `${title} ${desc}`;
        if (hasNegativeKeywords(fullText, negativeKeywords)) return;

        // Parse artist and title from headline
        const parsed = parseArtistTitle(title);
        if (parsed.artist === "Unknown Artist" && !title.includes(" - ") && !title.includes(" – ")) {
          // Skip general editorial commentary without a clear artist/track pair
          return;
        }

        seenUrls.add(link);
        discoveries.push({
          artist: parsed.artist,
          title: parsed.title,
          channel: feed.name,
          url: link,
          releaseDate: new Date(pubDate).toISOString().slice(0, 10),
          releaseType: "single",
          genre: "Indie Rock / Alternative",
          location: feed.region,
          description: `Premiered on ${feed.name} (${feed.region}) | ${new Date(pubDate).toISOString().slice(0, 10)}`
        });
      });
    } catch (e) {
      // Continue quietly on feed timeout
    }
  }

  console.log(`[Blogs Channel] Found ${discoveries.length} fresh track premieres in the last ${maxHours}h.`);
  return discoveries;
}

module.exports = {
  harvestBlogsDaily
};

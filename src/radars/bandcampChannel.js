const { isWithinHours, hasNegativeKeywords } = require('../utils/normalizer');

const DISCOVER_ENDPOINT = "https://bandcamp.com/api/discover/1/discover_web";

async function harvestBandcampDaily(config = {}, exclusions = {}) {
  const channelConfig = config.channels?.bandcamp || {};
  if (!channelConfig.enabled) return [];

  const locations = channelConfig.locations || [
    { name: "Melbourne", geonameId: 2158177, country: "Australia" },
    { name: "Sydney", geonameId: 2147714, country: "Australia" },
    { name: "London", geonameId: 2643743, country: "UK" }
  ];
  const tags = channelConfig.tags || ["indie-rock", "post-punk", "garage-rock"];
  const maxHours = config.maxRecencyHours || 36;
  const negativeKeywords = exclusions.negativeKeywords || [];

  const discoveries = [];
  const seenUrls = new Set();

  console.log(`[Bandcamp Channel] Checking live releases across ${locations.length} locations & ${tags.length} tags...`);

  for (const loc of locations) {
    for (const tag of tags) {
      try {
        const body = {
          category_id: 0,
          slice: "new",
          cursor: "*",
          size: 30,
          tag_norm_names: [tag],
          geoname_id: loc.geonameId,
          include_result_types: ["a"]
        };

        const res = await fetch(DISCOVER_ENDPOINT, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
          },
          body: JSON.stringify(body)
        });

        if (!res.ok) continue;

        const data = await res.json();
        const items = data.results || (data.discover && data.discover.results) || [];

        for (const item of items) {
          if (!item.artist || !item.title) continue;
          if (seenUrls.has(item.url)) continue;

          // Check strict recency (released within the last 24-36h)
          const releaseDate = item.release_date || item.publish_date;
          if (!isWithinHours(releaseDate, maxHours)) continue;

          // Check negative keywords (remaster, reissue, deluxe)
          const fullText = `${item.artist} ${item.title} ${item.genre_text || ''}`;
          if (hasNegativeKeywords(fullText, negativeKeywords)) continue;

          seenUrls.add(item.url);
          discoveries.push({
            artist: String(item.artist).trim(),
            title: String(item.title).trim(),
            channel: `Bandcamp (${loc.name})`,
            url: item.url,
            releaseDate: releaseDate ? new Date(releaseDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
            releaseType: item.type || "album",
            genre: tag,
            location: `${loc.name}, ${loc.country}`,
            description: `Type: ${item.type || 'album'} | Tag: ${tag} | Location: ${loc.name}, ${loc.country}`
          });
        }
      } catch (err) {
        // Continue quietly on single tag failure
      }
    }
  }

  console.log(`[Bandcamp Channel] Found ${discoveries.length} candidates published in the last ${maxHours}h.`);
  return discoveries;
}

module.exports = {
  harvestBandcampDaily
};

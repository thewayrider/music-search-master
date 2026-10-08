const { isWithinHours, hasNegativeKeywords } = require('../utils/normalizer');

async function harvestDeezerDaily(config = {}, exclusions = {}) {
  const channelConfig = config.channels?.deezer || {};
  if (!channelConfig.enabled) return [];

  const maxHours = config.maxRecencyHours || 36;
  const negativeKeywords = exclusions.negativeKeywords || [];
  const discoveries = [];
  const seenIds = new Set();

  console.log(`[Deezer Channel] Checking Deezer Alternative/Indie catalog drops...`);

  const queries = ["genre:alternative", "indie rock"];

  for (const q of queries) {
    try {
      const url = `https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&order=RELEASE_DATE_DESC&limit=25`;
      const res = await fetch(url, {
        headers: { "user-agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined
      });

      if (!res.ok) continue;

      const data = await res.json();
      const items = data.data || [];

      for (const item of items) {
        if (!item.id || seenIds.has(item.id)) continue;
        const artist = item.artist?.name || "";
        const title = item.title || "";
        const releaseDate = item.release_date;

        if (!artist || !title || !releaseDate) continue;
        if (!isWithinHours(releaseDate, maxHours)) continue;

        const fullText = `${artist} ${title}`;
        if (hasNegativeKeywords(fullText, negativeKeywords)) continue;

        seenIds.add(item.id);
        discoveries.push({
          artist: String(artist).trim(),
          title: String(title).trim(),
          channel: "Deezer Open API",
          url: item.link || `https://www.deezer.com/album/${item.id}`,
          releaseDate: releaseDate,
          releaseType: item.record_type || "single",
          genre: "Alternative",
          description: `Type: ${item.record_type || 'Release'} | Released: ${releaseDate}`
        });
      }
    } catch (e) {
      // Continue quietly
    }
  }

  console.log(`[Deezer Channel] Found ${discoveries.length} candidates.`);
  return discoveries;
}

module.exports = {
  harvestDeezerDaily
};

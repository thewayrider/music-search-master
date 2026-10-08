const { isWithinHours, hasNegativeKeywords } = require('../utils/normalizer');

const MB_BASE = "https://musicbrainz.org/ws/2";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function harvestMusicBrainzDaily(config = {}, exclusions = {}) {
  const channelConfig = config.channels?.musicbrainz || {};
  if (!channelConfig.enabled) return [];

  const targetTags = channelConfig.targetTags || ["indie rock", "post-punk", "alternative rock"];
  const negativeKeywords = exclusions.negativeKeywords || [];

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const discoveries = [];
  const seenMbids = new Set();

  console.log(`[MusicBrainz Channel] Querying Lucene index for releases from ${yesterdayStr} to ${todayStr}...`);

  for (const tag of targetTags) {
    try {
      const queryTag = tag.includes(" ") ? `"${tag}"` : tag;
      const query = `date:[${yesterdayStr} TO ${todayStr}] AND tag:${queryTag}`;
      const url = `${MB_BASE}/release/?query=${encodeURIComponent(query)}&limit=25&fmt=json`;

      const res = await fetch(url, {
        headers: {
          "accept": "application/json",
          "user-agent": "NewIndieLive24/1.0 ( https://streamusique.com )"
        }
      });

      if (!res.ok) {
        await sleep(1500);
        continue;
      }

      const data = await res.json();
      const releasesList = data.releases || [];

      for (const rel of releasesList) {
        if (seenMbids.has(rel.id)) continue;

        const artist = rel["artist-credit"] && rel["artist-credit"][0] ? rel["artist-credit"][0].name : "";
        const title = rel.title || "";
        if (!artist || !title) continue;

        const fullText = `${artist} ${title} ${rel.disambiguation || ''}`;
        if (hasNegativeKeywords(fullText, negativeKeywords)) continue;

        seenMbids.add(rel.id);
        const rg = rel["release-group"] || {};
        const sourceUrl = rg.id ? `https://musicbrainz.org/release-group/${rg.id}` : `https://musicbrainz.org/release/${rel.id}`;

        discoveries.push({
          artist: String(artist).trim(),
          title: String(title).trim(),
          channel: "MusicBrainz",
          url: sourceUrl,
          releaseDate: rel.date || todayStr,
          releaseType: rg["primary-type"]?.toLowerCase() || "single",
          genre: tag,
          description: `Type: ${rg["primary-type"] || 'Release'} | Tag: ${tag} | Cataloged: ${rel.date || todayStr}`
        });
      }
    } catch (e) {
      // Continue quietly
    }
    await sleep(1200);
  }

  console.log(`[MusicBrainz Channel] Found ${discoveries.length} fresh registrations today.`);
  return discoveries;
}

module.exports = {
  harvestMusicBrainzDaily
};

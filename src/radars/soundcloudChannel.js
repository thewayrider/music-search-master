const { isWithinHours, hasNegativeKeywords, parseArtistTitle } = require('../utils/normalizer');

let _cachedClientId = null;

async function getSoundCloudClientId() {
  if (_cachedClientId) return _cachedClientId;
  try {
    const pageUrl = "https://soundcloud.com/search/sounds?q=indie%20rock&filter.created_at=last_day";
    const res = await fetch(pageUrl, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
    });
    if (!res.ok) return null;

    const html = await res.text();
    const match = html.match(/<script>window\.__sc_hydration\s*=\s*(\[.+?\]);<\/script>/);
    if (!match) return null;

    const arr = JSON.parse(match[1]);
    const clientObj = arr.find(d => d.hydratable === 'apiClient');
    _cachedClientId = clientObj?.data?.id || null;
    return _cachedClientId;
  } catch (e) {
    return null;
  }
}

async function harvestSoundCloudDaily(config = {}, exclusions = {}) {
  const channelConfig = config.channels?.soundcloud || { enabled: true };
  if (channelConfig.enabled === false) return [];

  const maxHours = config.maxRecencyHours || 36;
  const negativeKeywords = exclusions.negativeKeywords || [];
  const discoveries = [];
  const seenUrls = new Set();

  console.log(`[SoundCloud Channel] Checking SoundCloud live indie stream drops in the last 24h...`);

  const clientId = await getSoundCloudClientId();
  if (!clientId) {
    console.log("[SoundCloud Channel] Could not obtain guest client ID. Skipping.");
    return [];
  }

  const bannedGenres = exclusions.bannedGenres || [];
  const queries = ["indie rock", "post-punk", "alternative rock", "garage rock"];

  for (const q of queries) {
    try {
      const apiUrl = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(q)}&filter.created_at=last_day&limit=20&client_id=${clientId}`;
      const res = await fetch(apiUrl, {
        headers: { "user-agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined
      });

      if (!res.ok) continue;

      const data = await res.json();
      const items = data.collection || [];

      for (const item of items) {
        if (!item.permalink_url || seenUrls.has(item.permalink_url)) continue;

        // Check strict recency
        if (!isWithinHours(item.created_at, maxHours)) continue;

        const rawTitle = item.title || "";
        const uploader = item.user?.username || "";
        const genre = (item.genre || "").toLowerCase();
        const tags = (item.tag_list || "").toLowerCase();
        const fullText = `${uploader} ${rawTitle} ${genre} ${tags}`;

        // Reject banned genres (e.g. Hip-hop & Rap, Electronic, EDM, Trap, Dream Pop)
        const genreAndTags = `${genre} ${tags}`;
        if (bannedGenres.some(bg => genreAndTags.includes(bg.toLowerCase()))) {
          continue;
        }

        // Reject negative keywords (type beats, remixes, loops)
        if (hasNegativeKeywords(fullText, negativeKeywords)) continue;

        // Parse artist and title
        let parsed = parseArtistTitle(rawTitle);
        if (parsed.artist === "Unknown Artist" && uploader) {
          parsed.artist = uploader;
        }

        seenUrls.add(item.permalink_url);
        discoveries.push({
          artist: parsed.artist,
          title: parsed.title,
          channel: "SoundCloud",
          url: item.permalink_url,
          releaseDate: new Date(item.created_at).toISOString().slice(0, 10),
          releaseType: "single",
          genre: item.genre || q,
          description: `SoundCloud Drop | Uploader: ${uploader} | Tag: ${item.genre || q}`
        });
      }
    } catch (e) {
      // Continue quietly
    }
  }

  console.log(`[SoundCloud Channel] Found ${discoveries.length} candidates.`);
  return discoveries;
}

module.exports = {
  harvestSoundCloudDaily
};

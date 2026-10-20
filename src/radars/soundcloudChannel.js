const fs = require('fs');
const path = require('path');
const { isWithinHours, hasNegativeKeywords, parseArtistTitle } = require('../utils/normalizer');

let _cachedClientId = null;

async function getSoundCloudClientId() {
  if (_cachedClientId) return _cachedClientId;
  try {
    const pageUrl = "https://soundcloud.com/search/sounds?q=indie";
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

/**
 * Curated SoundCloud Harvester:
 * Instead of noisy open keyword search, monitors verified, reputable indie record
 * labels (Sub Pop, Domino, Rough Trade, Merge, 4AD, Captured Tracks, Secretly Canadian, etc.)
 * and premiere tastemakers for fresh 24h official audio drops.
 */
async function harvestSoundCloudDaily(config = {}, exclusions = {}) {
  const channelConfig = config.channels?.soundcloud || { enabled: true };
  if (channelConfig.enabled === false) return [];

  const maxHours = config.maxRecencyHours || 36;
  const negativeKeywords = [
    ...(exclusions.negativeKeywords || []),
    ...(exclusions.keywords || [])
  ];
  const bannedArtists = [
    ...(exclusions.bannedArtists || []),
    ...(exclusions.artists || [])
  ];
  const bannedGenres = exclusions.bannedGenres || [];

  const projectRoot = path.resolve(__dirname, '../../');
  const channelsPath = path.join(projectRoot, 'configs/soundcloud_channels.json');

  if (!fs.existsSync(channelsPath)) {
    console.log("[SoundCloud Channel] configs/soundcloud_channels.json not found. Skipping.");
    return [];
  }

  let curatedChannels = [];
  try {
    curatedChannels = JSON.parse(fs.readFileSync(channelsPath, 'utf8'));
  } catch (e) {
    console.error("[SoundCloud Channel] Error parsing soundcloud_channels.json:", e.message);
    return [];
  }

  console.log(`[SoundCloud Channel] Checking ${curatedChannels.length} curated indie label feeds for 24h drops...`);

  const clientId = await getSoundCloudClientId();
  if (!clientId) {
    console.log("[SoundCloud Channel] Could not obtain guest client ID. Skipping.");
    return [];
  }

  const discoveries = [];
  const seenUrls = new Set();

  for (const ch of curatedChannels) {
    try {
      let userId = ch.userId;

      // Fallback resolve if userId is missing
      if (!userId && ch.permalink) {
        const rRes = await fetch(`https://api-v2.soundcloud.com/resolve?url=https://soundcloud.com/${ch.permalink}&client_id=${clientId}`, {
          headers: { "user-agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined
        });
        if (rRes.ok) {
          const u = await rRes.json();
          userId = u.id;
        }
      }

      if (!userId) continue;

      const apiUrl = `https://api-v2.soundcloud.com/users/${userId}/tracks?limit=5&client_id=${clientId}`;
      const res = await fetch(apiUrl, {
        headers: { "user-agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
      });

      if (!res.ok) continue;

      const data = await res.json();
      const items = data.collection || [];

      for (const item of items) {
        if (!item.permalink_url || seenUrls.has(item.permalink_url)) continue;

        // 1. Strict recency check (last 24-36h)
        if (!isWithinHours(item.created_at, maxHours)) continue;

        const rawTitle = item.title || "";
        const trackDesc = item.description || "";
        const genre = (item.genre || "").toLowerCase();
        const tags = (item.tag_list || "").toLowerCase();
        const fullText = `${ch.name} ${rawTitle} ${genre} ${tags} ${trackDesc}`;

        // 2. Reject non-song audio: must be complete track between 1m30s and 7m30s
        const duration = item.duration || 0;
        if (duration > 0 && (duration < 90000 || duration > 450000)) {
          continue;
        }

        // 3. Reject podcasts, interviews, teasers, previews, radio shows
        if (/\b(podcast|interview|teaser|preview|sampler|promo\s*clip|snippet|trailer)\b/i.test(rawTitle) ||
            /\b(operation\s*xray|radio\s*(station|broadcast|announcement|show|set)?|airplay\s*log)\b/i.test(fullText)) {
          continue;
        }

        // 4. Reject reissues, remasters, anniversary editions
        if (/\b(reissue|re-issue|remaster|remastered|deluxe|anniversary|expanded|edition|demo(s)?|live\s*at|live\s*from)\b/i.test(rawTitle)) {
          continue;
        }

        // 5. Reject banned genres
        const genreAndTags = `${genre} ${tags}`.toLowerCase();
        const isBannedGenre = bannedGenres.some(bg => {
          const b = bg.toLowerCase().trim();
          if (!b) return false;
          const reg = new RegExp(`(^|\\b|[,/&-])${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\b|[,/&-]|\$)`, 'i');
          return reg.test(genreAndTags);
        });
        if (isBannedGenre) continue;

        // 6. Reject negative keywords & banned artists
        if (hasNegativeKeywords(fullText, negativeKeywords)) continue;
        if (bannedArtists.some(b => fullText.toLowerCase().includes(b.toLowerCase()))) continue;

        // 7. Parse artist and title
        let parsed = parseArtistTitle(rawTitle);

        // If artist couldn't be parsed from title, check publisher_metadata or description
        if (parsed.artist === "Unknown Artist" && item.publisher_metadata?.artist) {
          parsed.artist = item.publisher_metadata.artist;
        }

        // If still unknown, skip to prevent uncredited clutter
        if (!parsed.artist || parsed.artist === "Unknown Artist" || !parsed.title) {
          continue;
        }

        seenUrls.add(item.permalink_url);
        discoveries.push({
          artist: parsed.artist,
          title: parsed.title,
          channel: `SoundCloud (${ch.name})`,
          url: item.permalink_url,
          releaseDate: new Date(item.created_at).toISOString().slice(0, 10),
          releaseType: "single",
          genre: item.genre || "Indie",
          description: `Curated Label Drop | Label: ${ch.name} | Category: ${ch.category || 'Indie Label'}`
        });
      }
    } catch (e) {
      // Continue next channel
    }
  }

  console.log(`[SoundCloud Channel] Harvested ${discoveries.length} verified 24h drop(s) from curated label accounts.`);
  return discoveries;
}

module.exports = {
  harvestSoundCloudDaily,
  getSoundCloudClientId
};

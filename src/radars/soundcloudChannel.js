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
  const negativeKeywords = [
    ...(exclusions.negativeKeywords || []),
    ...(exclusions.keywords || [])
  ];
  const bannedArtists = [
    ...(exclusions.bannedArtists || []),
    ...(exclusions.artists || [])
  ];
  const discoveries = [];
  const seenUrls = new Set();

  const AI_REGEX = /\b(ai|a\.i\.|artificial\s+intelligence|suno(\.ai)?|udio(\.com)?|chatgpt|generative\s+ai|virtual\s+(band|artist|singer)|ai\s+(generated|technology|creation|music|song|rock|pop|metal|indie|cover))\b/i;
  const PODCAST_ESSAY_REGEX = /\b(podcast|investigating|documentary|video\s+essay|tutorial|how\s+to|open\s+source|pro\s+tools|fl\s+studio|ableton|logic\s+pro|nepo\s+babies|breakdown|explained|tier\s+list|gear\s+review|plugin|vst|daw|audio\s+interface)\b/i;

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
        const trackDesc = item.description || "";
        const fullText = `${uploader} ${rawTitle} ${genre} ${tags} ${trackDesc}`;

        // Credibility check 1: Reject zero/low-follower throwaways and bots (minimum 50 followers)
        const user = item.user || {};
        const followers = user.followers_count || 0;
        const trackCount = user.track_count || 0;
        const minFollowers = channelConfig.minFollowers !== undefined ? channelConfig.minFollowers : 50;

        if (followers < minFollowers) {
          continue;
        }

        // Credibility check 2: Reject spam content farms dumping hundreds of tracks with low following
        // e.g. 714 tracks with 43 followers (ratio > 3:1 with > 25 tracks, or > 40 tracks with < 150 followers)
        if ((trackCount > 40 && followers < 150) || (trackCount > 25 && (trackCount / Math.max(1, followers)) > 3)) {
          continue;
        }

        // Credibility check 3: Reject keyword-stuffed titles (e.g. "(Indie Rock)" appended)
        if (/\((indie|alternative|alt|garage|punk|surf|psych|math)\s*rock\)\s*$/i.test(rawTitle)) {
          continue;
        }

        // Reject type beats and producer instrumental packs
        if (/\b(type\s*beat|beat\s*pack|free\s*beat|instrumental\s*beat)\b/i.test(rawTitle)) {
          continue;
        }

        // Reject banned artists (e.g. Cryptid Park)
        if (bannedArtists.some(b => fullText.toLowerCase().includes(b.toLowerCase()))) {
          continue;
        }

        // Reject AI generated music
        if (AI_REGEX.test(fullText)) {
          continue;
        }

        // Reject podcasts, tutorials, clickbait questions
        if (PODCAST_ESSAY_REGEX.test(fullText) || /\?|!{2,}|\?!|!\?/.test(rawTitle)) {
          continue;
        }

        // Reject titles that are pure dates (e.g. "Oct 9, 2026")
        if (/^\s*(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|september|oct|october|nov|november|dec|december)\s+\d{1,2},?\s*(20\d\d)?\s*$/i.test(rawTitle) ||
            /^\s*\d{1,2}[./-]\d{1,2}([./-]\d{2,4})?\s*$/.test(rawTitle)) {
          continue;
        }

        // Reject radio shows / broadcast announcements
        if (/\b(operation\s*xray|radio\s*(station|broadcast|announcement|show|set)?|airplay\s*log)\b/i.test(fullText)) {
          continue;
        }

        // Reject DarkPop genre
        if (/\b(dark\s*pop|darkpop)\b/i.test(fullText)) {
          continue;
        }

        // Reject vulgarity in title
        if (/\b(bitch|bitches|fuck|fucking|shit|shitty|nigga|asshole|cunt)\b/i.test(rawTitle)) {
          continue;
        }

        // Reject banned genres (e.g. Hip-hop & Rap, Electronic, EDM, Trap, Dream Pop, DarkPop)
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

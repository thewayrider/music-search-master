const { hasNegativeKeywords, parseArtistTitle } = require('../utils/normalizer');

async function harvestYouTubeDaily(config = {}, exclusions = {}) {
  const channelConfig = config.channels?.youtube || { enabled: true };
  if (channelConfig.enabled === false) return [];

  const negativeKeywords = [
    ...(exclusions.negativeKeywords || []),
    ...(exclusions.keywords || [])
  ];
  const bannedArtists = [
    ...(exclusions.bannedArtists || []),
    ...(exclusions.artists || [])
  ];
  const discoveries = [];
  const seenVideoIds = new Set();

  const AI_REGEX = /\b(ai|a\.i\.|artificial\s+intelligence|suno(\.ai)?|udio(\.com)?|chatgpt|generative\s+ai|virtual\s+(band|artist|singer)|ai\s+(generated|technology|creation|music|song|rock|pop|metal|indie|cover))\b/i;
  const PODCAST_ESSAY_REGEX = /\b(podcast|investigating|documentary|video\s+essay|tutorial|how\s+to|open\s+source|pro\s+tools|fl\s+studio|ableton|logic\s+pro|nepo\s+babies|breakdown|explained|tier\s+list|gear\s+review|plugin|vst|daw|audio\s+interface)\b/i;
  const RETRO_DATE_REGEX = /\b(released|out\s+now|album\s+out|ep\s+out|available\s+since)\s+(on\s+)?(january|february|march|april|may|june|july|august|september)\s+\d{1,2},?\s+20\d\d\b/i;

  console.log(`[YouTube Channel] Scanning YouTube live video premieres uploaded in the last 24h...`);

  // sp=EgIIAg%253D%253D filters YouTube search results to "Uploaded Today"
  const queries = [
    "indie rock new single official video",
    "post punk official music video",
    "indie rock track premiere"
  ];

  for (const q of queries) {
    try {
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIIAg%253D%253D`;
      const res = await fetch(searchUrl, {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "accept-language": "en-US,en;q=0.9"
        },
        signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined
      });

      if (!res.ok) continue;

      const html = await res.text();
      const match = html.match(/ytInitialData\s*=\s*({.+?});<\/script>/);
      if (!match) continue;

      const data = JSON.parse(match[1]);
      const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];

      for (const section of contents) {
        const items = section.itemSectionRenderer?.contents || [];
        for (const item of items) {
          const v = item.videoRenderer;
          if (!v || !v.videoId || seenVideoIds.has(v.videoId)) continue;

          // 1. Reject future scheduled streams/premieres (e.g. Toyah September 11)
          if (v.upcomingEventData) continue;

          // 1b. Reject video length > 10 mins or > 1 hour (podcasts, tutorials, full albums, DJ mixes)
          const lengthText = v.lengthText?.simpleText || "";
          if (lengthText) {
            const parts = lengthText.split(':');
            if (parts.length > 2) continue; // > 1 hour
            if (parts.length === 2 && parseInt(parts[0], 10) > 10) continue; // > 10 mins
          }

          const rawTitle = v.title?.runs?.[0]?.text || "";
          const channelName = v.ownerText?.runs?.[0]?.text || "YouTube";
          const publishedText = v.publishedTimeText?.simpleText || "Today";
          const descSnippet = v.descriptionSnippet?.runs?.map(r => r.text).join(' ') || "";
          const badges = (v.badges || []).map(b => b.metadataBadgeRenderer?.label || "").join(' ');
          const detailedMetadata = JSON.stringify(v.detailedMetadataSnippets || {});

          if (!rawTitle) continue;

          // 1c. Reject clickbait question / sensationalist punctuation in title (? or !?)
          if (/\?|!{2,}|\?!|!\?/.test(rawTitle)) continue;

          // 2. Reject negative keywords, AI generated flags, and podcasts/essays
          const fullText = `${rawTitle} ${channelName} ${descSnippet} ${badges} ${detailedMetadata}`;

          // Check banned artists & channels
          if (bannedArtists.some(b => fullText.toLowerCase().includes(b.toLowerCase()))) continue;

          // Check built-in AI patterns
          if (AI_REGEX.test(fullText)) continue;

          // Check built-in podcast/tutorial/video essay patterns
          if (PODCAST_ESSAY_REGEX.test(fullText)) continue;

          // Check retro/past release dates stated in description
          if (RETRO_DATE_REGEX.test(descSnippet)) continue;

          // Check negative keywords
          if (hasNegativeKeywords(fullText, negativeKeywords)) continue;

          // 3. Parse artist and title
          let parsed = parseArtistTitle(rawTitle);
          if (parsed.artist === "Unknown Artist" && channelName && channelName !== "YouTube") {
            // Use channel name if video title only contains song name
            parsed.artist = channelName.replace(/\s*-\s*Topic$/i, '').trim();
          }

          // Strip accidental duplicate artist at beginning of song title (e.g. "b side tramps — b side tramps ...")
          if (parsed.title.toLowerCase().startsWith(parsed.artist.toLowerCase())) {
            parsed.title = parsed.title.slice(parsed.artist.length).replace(/^[\s\-_:–—]+/, '').trim();
          }

          seenVideoIds.add(v.videoId);
          discoveries.push({
            artist: parsed.artist,
            title: parsed.title,
            channel: `YouTube (${channelName})`,
            url: `https://www.youtube.com/watch?v=${v.videoId}`,
            releaseDate: new Date().toISOString().slice(0, 10),
            releaseType: "single",
            genre: "Indie Rock / Video Premiere",
            description: `YouTube Video Premiere | ${publishedText} | Channel: ${channelName}`
          });

          if (discoveries.length >= 15) break;
        }
      }
    } catch (e) {
      // Continue quietly
    }
  }

  console.log(`[YouTube Channel] Found ${discoveries.length} premiere candidates today.`);
  return discoveries;
}

module.exports = {
  harvestYouTubeDaily
};

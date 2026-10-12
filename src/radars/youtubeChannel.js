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

  const AI_REGEX = /\b(ai|a\.i\.|artificial\s+intelligence|suno(\.ai)?|udio(\.com)?|chatgpt|generative\s+ai|virtual\s+(band|artist|singer|vocalist|human)|ai\s+(generated|technology|creation|music|song|rock|pop|metal|indie|cover|video|visualizer|concept|animation|model|art|singer)|sora|veo|hailuo|minimax|hedra|sync\s*labs|flux(\.1)?|leonardo(\.ai)?|riffusion|elevenlabs|midjourney|runway(ml)?|kling(\.ai)?|luma(\.ai)?|pika(\.art)?|comfyui|deforum|stable\s+diffusion|stable\s+audio|neural\s+network|deepfake)\b/i;
  const TYPE_BEAT_REGEX = /\b(type\s*beat|prod\.\s*|producer\s*beat|instrumental\s*beat|free\s+for\s+profit|beat\s*pack|buy\s*1\s*get|drum\s*kit)\b/i;
  const PODCAST_ESSAY_REGEX = /\b(podcast|investigating|documentary|video\s+essay|tutorial|how\s+to|open\s+source|pro\s+tools|fl\s+studio|ableton|logic\s+pro|nepo\s+babies|breakdown|explained|tier\s+list|gear\s+review|plugin|vst|daw|audio\s+interface)\b/i;
  const RETRO_DATE_REGEX = /\b(released|out\s+now|album\s+out|ep\s+out|available\s+since)\s+(on\s+)?(january|february|march|april|may|june|july|august|september)\s+\d{1,2},?\s+20\d\d\b/i;
  const SOUTH_ASIAN_CHANNELS = /\b(india|indian|bollywood|tollywood|kollywood|punjabi|desi|bhangra|t-series|zee\s*music|think\s*music|aditya\s*music|speed\s*records|yrf|tips\s*official)\b/i;

  function isRetroRelease(text, maxDaysOld = 21) {
    if (!text) return false;
    const isoMatch = text.match(/\b(20\d\d)-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])\b/);
    if (isoMatch) {
      const d = new Date(isoMatch[0]);
      if (!isNaN(d.getTime())) {
        const daysDiff = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
        if (daysDiff > maxDaysOld) return true;
      }
    }
    const dmyMatch = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(20\d\d)\b/i);
    if (dmyMatch) {
      const d = new Date(`${dmyMatch[2]} ${dmyMatch[1]}, ${dmyMatch[3]}`);
      if (!isNaN(d.getTime())) {
        const daysDiff = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
        if (daysDiff > maxDaysOld) return true;
      }
    }
    const mdyMatch = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d\d)\b/i);
    if (mdyMatch) {
      const d = new Date(`${mdyMatch[1]} ${mdyMatch[2]}, ${mdyMatch[3]}`);
      if (!isNaN(d.getTime())) {
        const daysDiff = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
        if (daysDiff > maxDaysOld) return true;
      }
    }
    return false;
  }

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

          // 1c. Native YouTube "Altered or Synthetic Content" / C2PA detection
          const rawItemStr = JSON.stringify(item);
          if (/altered\s+or\s+synthetic|made\s+with\s+ai|howthiswasmade/i.test(rawItemStr)) {
            continue;
          }

          // 1d. Reject "type beat" / producer instrumentals / beat packs
          if (TYPE_BEAT_REGEX.test(rawTitle) || TYPE_BEAT_REGEX.test(descSnippet) || TYPE_BEAT_REGEX.test(channelName)) {
            continue;
          }

          // 1e. Reject DistroKid auto-generated Topic dumps (Records DK)
          if (/-\s*Topic$/i.test(channelName) && (/records\s*dk\b/i.test(descSnippet) || /\bdistrokid\b/i.test(descSnippet))) {
            continue;
          }

          // 1f. Reject clickbait question / sensationalist punctuation in title (? or !?)
          if (/\?|!{2,}|\?!|!\?/.test(rawTitle)) continue;

          // 1g. Reject titles that are pure dates (e.g. "Oct 9, 2026")
          if (/^\s*(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|september|oct|october|nov|november|dec|december)\s+\d{1,2},?\s*(20\d\d)?\s*$/i.test(rawTitle) ||
              /^\s*\d{1,2}[./-]\d{1,2}([./-]\d{2,4})?\s*$/.test(rawTitle)) {
            continue;
          }

          // 1h. Reject South Asian / Indian mainstream promo channels (Think Music India, T-Series, etc.)
          if (SOUTH_ASIAN_CHANNELS.test(channelName)) continue;

          // 2. Reject negative keywords, AI generated flags, podcasts, and past album releases
          const fullText = `${rawTitle} ${channelName} ${descSnippet} ${badges} ${detailedMetadata}`;

          // Check banned artists & channels
          if (bannedArtists.some(b => fullText.toLowerCase().includes(b.toLowerCase()))) continue;

          // Check built-in AI patterns
          if (AI_REGEX.test(fullText)) continue;

          // Check DarkPop genre
          if (/\b(dark\s*pop|darkpop)\b/i.test(fullText)) continue;

          // Check radio show / broadcast
          if (/\b(operation\s*xray|radio\s*(station|broadcast|announcement|show|set)?|airplay\s*log)\b/i.test(fullText)) continue;

          // Check built-in podcast/tutorial/video essay patterns
          if (PODCAST_ESSAY_REGEX.test(fullText)) continue;

          // Check retro/past release dates stated in description (> 21 days old)
          if (isRetroRelease(descSnippet) || RETRO_DATE_REGEX.test(descSnippet)) continue;

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

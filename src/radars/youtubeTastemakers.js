const fs = require('fs');
const path = require('path');
const { isWithinHours, hasNegativeKeywords, parseArtistTitle } = require('../utils/normalizer');

const CHANNELS_CONFIG_PATH = path.join(__dirname, '../../configs/youtube_channels.json');

function loadCuratedChannels() {
  try {
    if (fs.existsSync(CHANNELS_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CHANNELS_CONFIG_PATH, 'utf-8'));
    }
  } catch (e) {
    // Fallback quietly
  }
  return [];
}

async function fetchChannelRss(channel, maxHours = 36) {
  const url = channel.rssUrl || `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`;
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
  });

  if (!res.ok) return [];

  const xml = await res.text();
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  const items = [];

  for (const entry of entries) {
    const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
    const pubMatch = entry.match(/<published>([\s\S]*?)<\/published>/);
    const idMatch = entry.match(/<yt:videoId>([\s\S]*?)<\/yt:videoId>/) || entry.match(/watch\?v=([a-zA-Z0-9_-]{11})/);
    const descMatch = entry.match(/<media:description>([\s\S]*?)<\/media:description>/);

    if (!titleMatch || !pubMatch || !idMatch) continue;

    let title = titleMatch[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();

    const publishedDate = pubMatch[1].trim();
    const videoId = idMatch[1].trim();
    const description = descMatch ? descMatch[1].trim() : '';

    if (!isWithinHours(publishedDate, maxHours)) continue;

    items.push({
      videoId,
      title,
      publishedDate,
      description,
      channelName: channel.name,
      category: channel.category || 'Curated Indie'
    });
  }

  return items;
}

async function harvestYouTubeTastemakersDaily(config = {}, exclusions = {}) {
  const channelConfig = config.channels?.youtubeTastemakers || { enabled: true };
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

  const channels = loadCuratedChannels();
  if (!channels || channels.length === 0) {
    console.log('[YouTube Tastemakers] No curated channels found in configs/youtube_channels.json.');
    return [];
  }

  console.log(`[YouTube Tastemakers] Monitoring ${channels.length} curated tastemaker & label channels...`);

  const results = await Promise.allSettled(
    channels.map(ch => fetchChannelRss(ch, maxHours))
  );

  const rawEntries = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      rawEntries.push(...r.value);
    }
  }

  const discoveries = [];
  const seenVideoIds = new Set();

  for (const entry of rawEntries) {
    if (seenVideoIds.has(entry.videoId)) continue;

    const rawTitle = entry.title;

    // Filter out full interviews, podcasts, documentaries, full concerts/live sets, playlists, compilations
    if (/\b(full\s+performance|full\s+interview|full\s+set|full\s+session|full\s+album|documentary|behind\s+the\s+scenes|podcast|playlist|compilation|sampler)\b/i.test(rawTitle)) {
      continue;
    }

    // Filter negative keywords
    const fullText = `${entry.channelName} ${rawTitle} ${entry.description}`;
    if (hasNegativeKeywords(fullText, negativeKeywords)) continue;
    if (bannedArtists.some(b => fullText.toLowerCase().includes(b.toLowerCase()))) continue;

    // Handle "Artist performs Song" pattern common in session channels
    let parsed;
    const performsMatch = rawTitle.match(/^(.*?)\s+performs\s+["“](.*?)["”]/i);
    if (performsMatch) {
      parsed = { artist: performsMatch[1].trim(), title: performsMatch[2].trim() };
    } else {
      parsed = parseArtistTitle(rawTitle);
    }

    // Skip if artist could not be parsed
    if (!parsed.artist || parsed.artist === "Unknown Artist" || !parsed.title) {
      continue;
    }

    // Clean up typical live session suffixes (e.g. "Interpol - My Desire (Live on KEXP)" -> "Interpol", "My Desire")
    parsed.title = parsed.title
      .replace(/\s*\(Live\s+on\s+[^)]+\)/i, '')
      .replace(/\s*\(Audiotree\s+Live\)/i, '')
      .replace(/\s*\(Live\s+from\s+[^)]+\)/i, '')
      .replace(/\s*\(Paste\s+Studio\s+[^)]+\)/i, '')
      .replace(/\s*\|\s*A\s+COLORS\s+SHOW/i, '')
      .replace(/\s*\(Official\s+Music\s+Video\)/i, '')
      .replace(/\s*\(Official\s+Video\)/i, '')
      .replace(/\s*\(Official\s+Audio\)/i, '')
      .replace(/\s*\(Visualizer\)/i, '')
      .trim();

    seenVideoIds.add(entry.videoId);
    discoveries.push({
      artist: parsed.artist,
      title: parsed.title,
      channel: `YouTube (${entry.channelName})`,
      url: `https://www.youtube.com/watch?v=${entry.videoId}`,
      releaseDate: new Date(entry.publishedDate).toISOString().slice(0, 10),
      releaseType: "single",
      genre: entry.category === "Live Sessions" ? "Live Session" : "Indie Single / Premiere",
      description: `Curated Indie Drop | Channel: ${entry.channelName} | Category: ${entry.category}`
    });
  }

  console.log(`[YouTube Tastemakers] Found ${discoveries.length} verified curated releases in the last ${maxHours}h.`);
  return discoveries;
}

module.exports = {
  harvestYouTubeTastemakersDaily
};

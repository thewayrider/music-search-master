const https = require('https');
const { isWithinHours, hasNegativeKeywords } = require('../utils/normalizer');

const DISCOVER_ENDPOINT = "https://bandcamp.com/api/discover/1/discover_web";

function httpsPostJson(urlStr, body, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(data),
        'accept': 'application/json',
        'user-agent': options.userAgent || 'curl/8.4.0'
      },
      timeout: options.timeoutMs || 20000
    }, res => {
      let chunks = '';
      res.on('data', d => chunks += d);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const trimmed = chunks.trim();
        if (trimmed.startsWith('<')) {
          return reject(new Error('HTML challenge page returned'));
        }
        try {
          resolve(JSON.parse(chunks));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

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

        const data = await httpsPostJson(DISCOVER_ENDPOINT, body, { userAgent: "curl/8.4.0", timeoutMs: 20000 });
        const items = data.results || (data.discover && data.discover.results) || [];

        for (const item of items) {
          const artist = item.bandName || item.band_name || item.artist || item.albumArtist;
          const title = item.title || item.album_title || item.item_title;
          const itemUrl = item.itemUrl || item.url || item.item_url;
          if (!artist || !title || !itemUrl) continue;
          if (seenUrls.has(itemUrl)) continue;

          // Drop Silent Pre-Orders & Pre-Orders (support both playerData and legacy featured_track)
          const trackObj = item.playerData || item.featuredTrack || item.featured_track;
          const streamUrl = trackObj && (trackObj.streamUrl || trackObj.stream_url);
          if (!streamUrl || trackObj.isStreamingDisabled) continue;
          const isPreorder = Boolean(
            item.isAlbumPreorder ||
            item.is_album_preorder ||
            item.is_preorder ||
            trackObj.isPreorder ||
            (trackObj.album && trackObj.album.isPreorder)
          );
          if (isPreorder) continue;

          // Check strict recency (released within the last 24-36h)
          const releaseDate = item.releaseDate || item.release_date || item.publish_date;
          if (!isWithinHours(releaseDate, maxHours)) continue;

          // Check negative keywords (remaster, reissue, deluxe)
          const fullText = `${artist} ${title} ${item.genre_text || item.genre || ''}`;
          if (hasNegativeKeywords(fullText, negativeKeywords)) continue;

          seenUrls.add(itemUrl);
          discoveries.push({
            artist: String(artist).trim(),
            title: String(title).trim(),
            channel: `Bandcamp (${loc.name})`,
            url: itemUrl,
            releaseDate: releaseDate ? new Date(releaseDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
            releaseType: item.itemType === 't' ? 'single' : (item.type || "album"),
            genre: tag,
            location: item.bandLocation || `${loc.name}, ${loc.country}`,
            description: `Type: ${item.itemType === 't' ? 'single' : (item.type || 'album')} | Tag: ${tag} | Location: ${loc.name}, ${loc.country}`
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

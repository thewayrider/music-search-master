const fs = require('fs');
const path = require('path');
const { harvestBandcampDaily } = require('./bandcampChannel');
const { harvestMusicBrainzDaily } = require('./musicbrainzChannel');
const { harvestBlogsDaily } = require('./blogsChannel');
const { harvestDeezerDaily } = require('./deezerChannel');
const { harvestYouTubeDaily } = require('./youtubeChannel');
const { harvestSoundCloudDaily } = require('./soundcloudChannel');
const { harvestUSIndieDaily } = require('./usIndieChannel');
const { evaluateCandidateTrack, getMasterStats } = require('../utils/masterDb');
const { isCleanTrack, parseArtistTitle } = require('../utils/normalizer');
const { sendDailyRadarEmail } = require('../utils/mailer');

async function runDailyRadar(options = {}) {
  const isDryRun = options.dryRun || false;
  const market = options.market === 'US' ? 'US' : 'GLOBAL';
  const projectRoot = path.resolve(__dirname, '../../');

  // Load configs
  const configPath = path.join(projectRoot, 'configs/radar_config.json');
  const exclusionsPath = path.join(projectRoot, 'configs/exclusions.json');

  const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
  const exclusions = fs.existsSync(exclusionsPath) ? JSON.parse(fs.readFileSync(exclusionsPath, 'utf8')) : {};
  config.market = market;

  console.log("\n============================================================");
  console.log(`       NEW INDIE LIVE 24 — ${market === 'US' ? 'US EDITION 🇺🇸' : 'GLOBAL RADAR 🌍'}            `);
  console.log("============================================================");
  console.log(`Market Scope:   ${market === 'US' ? 'UNITED STATES (Curated Tastemakers)' : 'GLOBAL MULTI-CHANNEL'}`);
  console.log(`Mode:           ${isDryRun ? 'DRY-RUN (Sandbox / No Email)' : 'LIVE EXECUTION'}`);
  console.log(`Max Recency:    ${config.maxRecencyHours || 36} hours`);
  console.log(`Timestamp:      ${new Date().toISOString()}`);
  console.log("------------------------------------------------------------\n");

  let rawCandidates = [];

  if (market === 'US') {
    // Curated US Tastemaker Pipeline
    console.log("[Radar Engine] Launching US Indie Tastemaker Harvester (BrooklynVegan, Stereogum, Big Takeover, Under The Radar, Austin Town Hall, Post-Trash)...");
    const usItems = await harvestUSIndieDaily(config, exclusions).catch(e => { console.error("[US Channel] Error:", e.message); return []; });
    rawCandidates = usItems;
    console.log(`\n[Radar Engine] Aggregated ${rawCandidates.length} raw US candidates.`);
  } else {
    // 1. Run all 6 discovery channels in parallel
    console.log("[Radar Engine] Launching multi-channel open-web discovery (6 channels)...");
    const [bandcampItems, mbItems, blogItems, deezerItems, youtubeItems, soundcloudItems] = await Promise.all([
      harvestBandcampDaily(config, exclusions).catch(e => { console.error("[Bandcamp] Error:", e.message); return []; }),
      harvestMusicBrainzDaily(config, exclusions).catch(e => { console.error("[MusicBrainz] Error:", e.message); return []; }),
      harvestBlogsDaily(config, exclusions).catch(e => { console.error("[Blogs] Error:", e.message); return []; }),
      harvestDeezerDaily(config, exclusions).catch(e => { console.error("[Deezer] Error:", e.message); return []; }),
      harvestYouTubeDaily(config, exclusions).catch(e => { console.error("[YouTube] Error:", e.message); return []; }),
      harvestSoundCloudDaily(config, exclusions).catch(e => { console.error("[SoundCloud] Error:", e.message); return []; })
    ]);

    rawCandidates = [...bandcampItems, ...mbItems, ...blogItems, ...deezerItems, ...youtubeItems, ...soundcloudItems];
    console.log(`\n[Radar Engine] Aggregated ${rawCandidates.length} raw candidates across all 6 channels.`);
  }

  // 2. Evaluate against Clean Track Integrity & Master SQLite Memory
  const passedNewReleases = [];
  let uncleanFiltered = 0;
  let recycledSinglesBlocked = 0;
  let consensusUpdates = 0;
  const seenSlugsInBatch = new Set();

  const artistCounts = new Map();
  const channelCounts = new Map();
  const MAX_TRACKS_PER_ARTIST = config.maxTracksPerArtist || 2;
  const MAX_SOUNDCLOUD_TRACKS = config.maxSoundCloudTracks || 5;
  const MAX_TRACKS_PER_CHANNEL = config.maxTracksPerChannel || 8;

  for (const item of rawCandidates) {
    if (!item.artist || !item.title) continue;

    // A. Parse & Clean Title
    const parsed = parseArtistTitle(`${item.artist} - ${item.title}`);
    item.artist = parsed.artist;
    item.title = parsed.title;

    // B. Clean Track Integrity Filter (EveryNoise rule)
    if (!isCleanTrack(item.artist, item.title, exclusions.negativeKeywords, exclusions.artists)) {
      uncleanFiltered++;
      console.log(`  [x] Filtered Unclean Track: "${item.artist} - ${item.title}" [${item.channel}]`);
      continue;
    }

    // C. Limit flood drops by the same artist in a single daily run
    const artistKey = item.artist.toLowerCase();
    const currentArtistCount = artistCounts.get(artistKey) || 0;
    if (currentArtistCount >= MAX_TRACKS_PER_ARTIST) {
      console.log(`  [x] Capped Artist Flood: "${item.artist} - ${item.title}" (Exceeds ${MAX_TRACKS_PER_ARTIST} daily tracks)`);
      continue;
    }

    // D. Limit channel quota so high-velocity direct-upload platforms (SoundCloud) don't dominate the briefing
    const channelKey = item.channel.toLowerCase();
    const isSoundCloud = channelKey.includes('soundcloud');
    const channelCap = isSoundCloud ? MAX_SOUNDCLOUD_TRACKS : MAX_TRACKS_PER_CHANNEL;
    const currentChannelCount = channelCounts.get(channelKey) || 0;
    if (currentChannelCount >= channelCap) {
      console.log(`  [x] Capped Channel Quota: "${item.artist} - ${item.title}" [${item.channel}] (Exceeds ${channelCap} daily limit)`);
      continue;
    }

    // E. Master Database Recycled Single Check
    const evaluation = evaluateCandidateTrack(item, item.channel, { isDryRun });

    if (evaluation.isRecycledSingle) {
      recycledSinglesBlocked++;
      console.log(`  [-] Blocked Recycled Single: "${item.artist} - ${item.title}" (Previously logged on ${evaluation.firstSeenAt})`);
      continue;
    }

    if (evaluation.isNewGlobal) {
      const batchKey = `${item.artist.toLowerCase()}::${item.title.toLowerCase()}`;
      if (!seenSlugsInBatch.has(batchKey)) {
        seenSlugsInBatch.add(batchKey);
        artistCounts.set(artistKey, currentArtistCount + 1);
        channelCounts.set(channelKey, currentChannelCount + 1);
        passedNewReleases.push({
          ...item,
          heatScore: evaluation.heatScore,
          sources: evaluation.sources
        });
        console.log(`  [+] Verified Clean Drop: "${item.artist} - ${item.title}" [${item.channel}]`);
      }
    } else if (evaluation.isNewSighting) {
      consensusUpdates++;
      console.log(`  [🔥] Tastemaker Consensus: "${item.artist} - ${item.title}" confirmed by ${item.channel} (Heat: ${evaluation.heatScore})`);
    }
  }

  console.log("\n------------------------------------------------------------");
  console.log(`[Summary] Raw Candidates:   ${rawCandidates.length}`);
  console.log(`[Summary] Unclean Filtered: ${uncleanFiltered}`);
  console.log(`[Summary] Recycled Blocked: ${recycledSinglesBlocked}`);
  console.log(`[Summary] Consensus Bumped: ${consensusUpdates}`);
  console.log(`[Summary] Pure Clean Drops: ${passedNewReleases.length}`);
  // 3. Dispatch Email if Live
  if (!isDryRun && passedNewReleases.length > 0) {
    await sendDailyRadarEmail(passedNewReleases, config);
  } else if (isDryRun) {
    console.log("[Dry-Run] Skipped email dispatch. Showing verified tracks:");
    passedNewReleases.forEach((t, i) => {
      console.log(`  ${i + 1}. ${t.artist} — ${t.title} [${t.channel}] -> ${t.url}`);
    });
  }

  const dbStats = getMasterStats();
  console.log(`\n[Master DB] Total Cataloged Songs: ${dbStats.totalUniqueSongs} | Sightings: ${dbStats.totalSightings}`);
  console.log("============================================================\n");

  // 4. Update Telemetry & Sync to Gist for Android App
  if (!isDryRun) {
    try {
      const savedSearchesDir = path.resolve(__dirname, '../../saved_searches');
      const safeRadarId = market === 'US' ? 'us_radar_daily' : 'global_radar_daily';
      const radarName = market === 'US' ? 'US Edition Radar' : 'Global 24h Radar';
      const radarDir = path.join(savedSearchesDir, safeRadarId);
      if (!fs.existsSync(radarDir)) fs.mkdirSync(radarDir, { recursive: true });

      const now = new Date();
      const ts = now.toISOString().replace(/T/, '_').replace(/:/g, '').split('.')[0];
      const runFile = path.join(radarDir, `${safeRadarId}_${ts}.json`);
      fs.writeFileSync(runFile, JSON.stringify(passedNewReleases, null, 2));

      const statusFile = path.join(savedSearchesDir, 'dashboard_status.json');
      let statusData = {};
      if (fs.existsSync(statusFile)) {
        try { statusData = JSON.parse(fs.readFileSync(statusFile, 'utf8')); } catch (_) {}
      }
      statusData[safeRadarId] = {
        name: radarName,
        lastRun: now.toISOString(),
        totalSongsFound: rawCandidates.length,
        newSongsEmailed: passedNewReleases.length,
        status: "Success"
      };
      fs.writeFileSync(statusFile, JSON.stringify(statusData, null, 2));

      const { aggregateCrawlerMetrics } = require('../utils/metricsAggregator');
      const { syncMetricsToGist } = require('../utils/gistSync');
      const aggregated = aggregateCrawlerMetrics();
      await syncMetricsToGist(aggregated);
    } catch (metricErr) {
      console.warn('[Telemetry] Notice updating radar telemetry or Gist:', metricErr.message);
    }
  }

  return {
    rawCount: rawCandidates.length,
    recycledBlocked: recycledSinglesBlocked,
    newPassed: passedNewReleases.length,
    tracks: passedNewReleases,
    dbStats
  };
}

module.exports = {
  runDailyRadar
};

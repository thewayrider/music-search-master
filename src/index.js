const fs = require('fs');
const path = require('path');
const { getMasterStats } = require('./utils/masterDb');
const { runDailyRadar } = require('./radars/radarEngine');
const { generateHTML } = require('./utils/htmlGenerator');
const { getPreviousReport, getNewAdditions } = require('./utils/diffEngine');
const { sendEmailNotification } = require('./utils/emailNotifier');
const { aggregateCrawlerMetrics } = require('./utils/metricsAggregator');
const { syncMetricsToGist } = require('./utils/gistSync');

// Resilient on-demand lazy loader for weekly crawler agents
function loadAgentSafely(agentName, relativePath) {
    try {
        return require(relativePath);
    } catch (err) {
        console.error(`\n[Crawler Loader] Warning: Could not load agent '${agentName}' from '${relativePath}': ${err.message}\n`);
        return null;
    }
}

async function main() {
    const args = process.argv.slice(2);

    // 1. Stats command
    if (args.includes('--stats')) {
        console.log("\n========================================================");
        console.log("📊 MASTER CATALOG STATISTICS");
        console.log("========================================================");
        const stats = getMasterStats();
        console.log(`🏆 Total Unique Songs:     ${stats.totalUniqueSongs}`);
        console.log(`🔥 Total Sightings:        ${stats.totalSightings}`);
        console.log(`✨ Consensus Multi-Source: ${stats.consensusSongsCount}`);
        console.log(`💾 Database File:          ${stats.databasePath}`);
        console.log("========================================================\n");
        return;
    }

    // 2. Daily Radar commands
    const isRadarUS = args.includes('--us') || args.includes('--radar-us');
    const isRadarGlobal = args.includes('--radar') || args.includes('--radar-global') || args.includes('--global');
    const isDryRun = args.includes('--dry-run');

    if (isRadarUS || isRadarGlobal) {
        const market = isRadarUS ? 'US' : 'GLOBAL';
        await runDailyRadar({ market, dryRun: isDryRun });
        return;
    }

    // 3. Weekly Crawler runner via configuration file
    const configArg = args.find(a => !a.startsWith('--'));
    if (!configArg) {
        console.log(`
========================================================
🛰️  MUSIC SEARCH MASTER — UNIFIED FLEET CLI
========================================================
Usage:
  node src/index.js --radar-global [--dry-run]   Run 24h Global Radar
  node src/index.js --radar-us [--dry-run]       Run 24h US Tastemaker Radar
  node src/index.js <config-file>                Run a weekly crawler
  node src/index.js --stats                      Show master catalog metrics
  node src/server.js                             Start Fleet Command Center

Examples:
  node src/index.js configs/bandcamp_indie.json
  node src/index.js configs/amrap_indie.json
  node src/index.js --radar-global --dry-run
========================================================
`);
        return;
    }

    const configPath = path.resolve(process.cwd(), configArg);
    if (!fs.existsSync(configPath)) {
        console.error(`\nERROR: Configuration file not found at ${configPath}\n`);
        process.exit(1);
    }

    const exclusionsPath = path.join(__dirname, '../configs/exclusions.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const exclusions = fs.existsSync(exclusionsPath) ? JSON.parse(fs.readFileSync(exclusionsPath, 'utf8')) : { keywords: [] };

    let results = [];

    // Dispatch to specific crawler agent with lazy loading resilience
    if (config.airChart) {
        const agent = loadAgentSafely('airChart', './crawlers/airChartAgent');
        if (agent?.runAirChartAgent) {
            results = results.concat(await agent.runAirChartAgent(config.airChart, exclusions));
        }
    } else if (config.amrap) {
        const agent = loadAgentSafely('amrap', './crawlers/amrapAgent');
        if (agent?.runAmrapAgent) {
            results = results.concat(await agent.runAmrapAgent(config.amrap, exclusions));
        }
    } else if (config.bandcamp) {
        const agent = loadAgentSafely('bandcamp', './crawlers/bandcampAgent');
        if (agent?.runBandcampAgent) {
            results = results.concat(await agent.runBandcampAgent(config.bandcamp, exclusions));
        }
    } else if (config.futuremag) {
        const agent = loadAgentSafely('futuremag', './crawlers/futuremagAgent');
        if (agent?.runFuturemagAgent) {
            results = results.concat(await agent.runFuturemagAgent(config.futuremag, exclusions));
        }
    } else if (config.listenbrainz) {
        const agent = loadAgentSafely('listenbrainz', './crawlers/listenBrainzAgent');
        if (agent?.runListenBrainzAgent) {
            results = results.concat(await agent.runListenBrainzAgent(config.listenbrainz, exclusions));
        }
    } else if (config.musicbrainz) {
        const agent = loadAgentSafely('musicbrainz', './crawlers/musicBrainzAgent');
        if (agent?.runMusicBrainzAgent) {
            results = results.concat(await agent.runMusicBrainzAgent(config.musicbrainz, exclusions));
        }
    } else if (config.rootsmag) {
        const agent = loadAgentSafely('rootsmag', './crawlers/rootsMagAgent');
        if (agent?.runRootsMagAgent) {
            results = results.concat(await agent.runRootsMagAgent(config.rootsmag, exclusions));
        }
    } else if (configPath.includes('triplej_unearthed')) {
        const agent = loadAgentSafely('triplej_unearthed', './crawlers/tripleJUnearthedAgent');
        if (agent?.runTripleJUnearthedAgent) {
            results = results.concat(await agent.runTripleJUnearthedAgent(config.triplej_unearthed || {}, config));
        }
    } else if (configPath.includes('triplej')) {
        const agent = loadAgentSafely('triplej', './crawlers/tripleJApiAgent');
        if (agent?.runTripleJApiAgent) {
            results = results.concat(await agent.runTripleJApiAgent(config.triplej || {}, config));
        }
    } else if (config.deezer) {
        const agent = loadAgentSafely('deezer', './crawlers/deezerAgent');
        if (agent?.runDeezerAgent) {
            results = results.concat(await agent.runDeezerAgent(config.deezer, exclusions));
        }
    } else if (config.spotify_oauth) {
        const agent = loadAgentSafely('spotify_oauth', './crawlers/spotifyOAuthAgent');
        if (agent?.runSpotifyOAuthAgent) {
            results = results.concat(await agent.runSpotifyOAuthAgent(config.spotify_oauth, exclusions));
        }
    } else if (config.nialler9) {
        const agent = loadAgentSafely('nialler9', './crawlers/nialler9Agent');
        if (agent?.runNialler9Agent) {
            results = results.concat(await agent.runNialler9Agent(config.nialler9, exclusions));
        }
    }

    // Save outputs in saved_searches
    const savedSearchesDir = path.join(__dirname, '../saved_searches');
    const searchName = config.searchName || 
                       config.airChart?.searchName || 
                       config.amrap?.searchName ||
                       config.bandcamp?.searchName ||
                       config.futuremag?.searchName ||
                       config.listenbrainz?.searchName ||
                       config.musicbrainz?.searchName ||
                       config.rootsmag?.searchName ||
                       config.triplej_unearthed?.searchName ||
                       config.triplej?.searchName ||
                       config.deezer?.searchName ||
                       config.spotify_oauth?.searchName ||
                       config.nialler9?.searchName ||
                       'search_results';

    const safeSearchName = searchName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const searchSpecificDir = path.join(savedSearchesDir, safeSearchName);
    if (!fs.existsSync(searchSpecificDir)) {
        fs.mkdirSync(searchSpecificDir, { recursive: true });
    }

    const baseJsonPath = path.join(searchSpecificDir, `${safeSearchName}_base.json`);
    const baseHtmlPath = path.join(searchSpecificDir, `${safeSearchName}_base.html`);
    const isBaseRun = !fs.existsSync(baseJsonPath);

    let jsonPath, htmlPath;
    if (isBaseRun) {
        console.log("[Base Run] No base file found. Generating permanent base run files.");
        jsonPath = baseJsonPath;
        htmlPath = baseHtmlPath;
    } else {
        const now = new Date();
        const ts = now.toISOString().replace(/T/, '_').replace(/:/g, '').split('.')[0];
        const baseFilename = `${safeSearchName}_${ts}`;
        jsonPath = path.join(searchSpecificDir, `${baseFilename}.json`);
        htmlPath = path.join(searchSpecificDir, `${baseFilename}.html`);
    }

    // EveryNoise Purity Gate & Diff Engine
    const previousResults = getPreviousReport(searchSpecificDir, path.basename(jsonPath));
    const newSongs = getNewAdditions(results, previousResults);

    console.log(`[Diff Engine] Found ${newSongs.length} totally new songs since the last run.`);

    const songsToSave = newSongs;

    // Send email alert
    await sendEmailNotification(newSongs, baseHtmlPath, searchName);

    // Save JSON & HTML
    fs.writeFileSync(jsonPath, JSON.stringify(songsToSave, null, 2));
    const htmlContent = generateHTML(searchName, songsToSave);
    fs.writeFileSync(htmlPath, htmlContent);

    console.log(`Archived JSON saved to ${jsonPath}`);
    console.log(`Interactive HTML report saved to ${htmlPath}`);

    // Update Dashboard Status
    const dashboardStatusPath = path.join(savedSearchesDir, 'dashboard_status.json');
    let dashboardStatus = {};
    if (fs.existsSync(dashboardStatusPath)) {
        try {
            dashboardStatus = JSON.parse(fs.readFileSync(dashboardStatusPath, 'utf8'));
        } catch (_) {}
    }
    dashboardStatus[safeSearchName] = {
        name: searchName,
        lastRun: new Date().toISOString(),
        totalSongsFound: results.length,
        newSongsEmailed: newSongs.length,
        status: "Success"
    };
    fs.writeFileSync(dashboardStatusPath, JSON.stringify(dashboardStatus, null, 2));

    // Update Telemetry & Sync to Gist for Android app
    try {
        console.log("\n[Telemetry] Updating aggregated crawler statistics...");
        const aggregated = aggregateCrawlerMetrics();
        await syncMetricsToGist(aggregated);
    } catch (metricErr) {
        console.warn("[Telemetry] Warning updating analytics or Gist:", metricErr.message);
    }

    console.log("Search Agent finished execution.\n");
}

main().catch(console.error);

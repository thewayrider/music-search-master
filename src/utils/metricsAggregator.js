const fs = require('fs');
const path = require('path');

const AGENTS = [
    { id: 'air_charts_discovery', name: 'Air Charts', schedule: 'Mon 16:00' },
    { id: 'amrap_indie_discovery', name: 'Amrap', schedule: 'Thu 16:00' },
    { id: 'bandcamp_indie_discovery', name: 'Bandcamp', schedule: 'Mon, Wed, Fri, Sat 09:00' },
    { id: 'listenbrainz_indie_discovery', name: 'ListenBrainz', schedule: 'Mon, Fri 09:00' },
    { id: 'musicbrainz_indie_discovery', name: 'MusicBrainz', schedule: 'Mon, Wed, Fri 09:30' },
    { id: 'futuremag_indie_discovery', name: 'Futuremag', schedule: 'Fri 09:00' },
    { id: 'roots_mag', name: 'Roots Mag', schedule: 'Fri 09:00' },
    { id: 'triple_j_unearthed_discovery', name: 'Triple J Unearthed', schedule: 'Mon, Wed, Fri 14:00' },
    { id: 'nialler9_indie_discovery', name: 'Nialler9', schedule: 'Fri 10:00' }
];

function parseTimestampFromFilename(filename, stats) {
    // Format: name_YYYY-MM-DD_HHMMSS.json
    const match = filename.match(/_(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})(\d{2})\.json$/);
    if (match) {
        const [_, datePart, hh, mm, ss] = match;
        return new Date(`${datePart}T${hh}:${mm}:${ss}`);
    }
    return stats.mtime;
}

function calculateHealth(agent, runHistory, statusData) {
    const nonBaseRuns = runHistory.filter(r => !r.isBase);
    const lastRunTime = statusData.lastRun ? new Date(statusData.lastRun) : (runHistory.length > 0 ? runHistory[runHistory.length - 1].date : null);
    
    // Check consecutive zero-yield runs
    let consecutiveZeros = 0;
    for (let i = nonBaseRuns.length - 1; i >= 0; i--) {
        if (nonBaseRuns[i].count === 0) {
            consecutiveZeros++;
        } else {
            break;
        }
    }

    const now = new Date();
    const daysSinceLastRun = lastRunTime ? Math.floor((now - lastRunTime) / (1000 * 60 * 60 * 24)) : 999;

    // Check past 7 days discoveries
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const past7DaysRuns = nonBaseRuns.filter(r => r.date >= sevenDaysAgo);
    const past7DaysNew = past7DaysRuns.reduce((sum, r) => sum + r.count, 0);

    let healthStatus = 'Healthy';
    let badge = 'success';
    let recommendation = 'Operating normally with consistent discoveries.';

    if (agent.schedule !== 'Manual' && daysSinceLastRun > 10) {
        healthStatus = 'Inactive';
        badge = 'danger';
        recommendation = `No runs detected in ${daysSinceLastRun} days. Check Windows Task Scheduler.`;
    } else if (consecutiveZeros >= 4 || (past7DaysRuns.length >= 3 && past7DaysNew === 0)) {
        healthStatus = 'Needs Review';
        badge = 'warning';
        recommendation = `Yielded 0 new songs across last ${consecutiveZeros} runs. Consider adjusting filters or eliminating.`;
    } else if (past7DaysNew === 0 && nonBaseRuns.length > 0) {
        healthStatus = 'Moderate';
        badge = 'info';
        recommendation = 'No new songs this week, but normal for bi-weekly / monthly release patterns.';
    } else if (past7DaysNew > 10) {
        healthStatus = 'High Yield';
        badge = 'success';
        recommendation = `High performer! Added ${past7DaysNew} new tracks in the past 7 days.`;
    }

    return {
        healthStatus,
        badge,
        recommendation,
        consecutiveZeros,
        daysSinceLastRun
    };
}

function aggregateCrawlerMetrics() {
    const savedSearchesDir = path.join(__dirname, '..', '..', 'saved_searches');
    const dashboardStatusPath = path.join(savedSearchesDir, 'dashboard_status.json');
    
    let dashboardStatus = {};
    if (fs.existsSync(dashboardStatusPath)) {
        try {
            dashboardStatus = JSON.parse(fs.readFileSync(dashboardStatusPath, 'utf8'));
        } catch (e) {
            console.error('Error reading dashboard_status.json:', e.message);
        }
    }

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const crawlerReports = [];
    let systemTotalNewToday = 0;
    let systemTotalNewWeek = 0;
    let systemTotalNewAllTime = 0;
    let systemTotalRunsAllTime = 0;

    for (const agent of AGENTS) {
        const agentDir = path.join(savedSearchesDir, agent.id);
        const statusData = dashboardStatus[agent.id] || {};
        const runHistory = [];

        if (fs.existsSync(agentDir)) {
            const files = fs.readdirSync(agentDir).filter(f => f.endsWith('.json'));

            for (const file of files) {
                const filePath = path.join(agentDir, file);
                try {
                    const stats = fs.statSync(filePath);
                    const fileDate = parseTimestampFromFilename(file, stats);
                    const isBase = file.includes('_base.json');
                    
                    let count = 0;
                    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    if (Array.isArray(content)) {
                        count = content.length;
                    }

                    runHistory.push({
                        filename: file,
                        date: fileDate,
                        dateStr: fileDate.toISOString(),
                        count: count,
                        isBase: isBase
                    });
                } catch (err) {
                    console.warn(`Could not parse ${file}: ${err.message}`);
                }
            }
        }

        // Sort chronologically
        runHistory.sort((a, b) => a.date - b.date);

        const nonBaseRuns = runHistory.filter(r => !r.isBase);
        const baseRun = runHistory.find(r => r.isBase);

        // Daily (last 24 hours)
        const runsToday = nonBaseRuns.filter(r => r.date >= oneDayAgo);
        const newSongsToday = runsToday.reduce((sum, r) => sum + r.count, 0);

        // Weekly (last 7 days)
        const runsWeek = nonBaseRuns.filter(r => r.date >= sevenDaysAgo);
        const newSongsWeek = runsWeek.reduce((sum, r) => sum + r.count, 0);

        // Monthly (last 30 days)
        const runsMonth = nonBaseRuns.filter(r => r.date >= thirtyDaysAgo);
        const newSongsMonth = runsMonth.reduce((sum, r) => sum + r.count, 0);

        // All Time
        const allTimeNewSongs = nonBaseRuns.reduce((sum, r) => sum + r.count, 0);
        const totalRuns = nonBaseRuns.length;
        const baselineSongCount = baseRun ? baseRun.count : 0;

        // Health & Diagnostics
        const health = calculateHealth(agent, runHistory, statusData);

        // Add to system totals
        systemTotalNewToday += newSongsToday;
        systemTotalNewWeek += newSongsWeek;
        systemTotalNewAllTime += allTimeNewSongs;
        systemTotalRunsAllTime += totalRuns;

        crawlerReports.push({
            id: agent.id,
            name: agent.name,
            schedule: agent.schedule,
            status: statusData.status || (nonBaseRuns.length > 0 ? 'Success' : 'Pending'),
            lastRun: statusData.lastRun || (nonBaseRuns.length > 0 ? nonBaseRuns[nonBaseRuns.length - 1].dateStr : null),
            lastRunFoundTotal: statusData.totalSongsFound !== undefined ? statusData.totalSongsFound : null,
            lastRunNewAdded: statusData.newSongsEmailed !== undefined ? statusData.newSongsEmailed : (nonBaseRuns.length > 0 ? nonBaseRuns[nonBaseRuns.length - 1].count : 0),
            stats: {
                today: { runs: runsToday.length, newSongs: newSongsToday },
                past7Days: { runs: runsWeek.length, newSongs: newSongsWeek },
                past30Days: { runs: runsMonth.length, newSongs: newSongsMonth },
                allTime: { 
                    runs: totalRuns, 
                    newSongs: allTimeNewSongs,
                    baselinePool: baselineSongCount,
                    totalUniqueProcessed: baselineSongCount + allTimeNewSongs
                }
            },
            health: health,
            recentRunHistory: nonBaseRuns.slice(-5).map(r => ({
                date: r.dateStr,
                newSongs: r.count
            }))
        });
    }

    const payload = {
        generatedAt: now.toISOString(),
        summary: {
            totalCrawlers: AGENTS.length,
            systemNewToday: systemTotalNewToday,
            systemNewWeek: systemTotalNewWeek,
            systemNewAllTime: systemTotalNewAllTime,
            systemTotalRuns: systemTotalRunsAllTime,
            healthyCount: crawlerReports.filter(c => c.health.badge === 'success').length,
            reviewCount: crawlerReports.filter(c => c.health.badge === 'warning').length,
            inactiveCount: crawlerReports.filter(c => c.health.badge === 'danger').length
        },
        crawlers: crawlerReports
    };

    const outputPath = path.join(savedSearchesDir, 'crawler_analytics.json');
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));

    return payload;
}

if (require.main === module) {
    console.log("Aggregating historical crawler metrics...");
    const result = aggregateCrawlerMetrics();
    console.log(`\nAggregated metrics successfully generated for ${result.crawlers.length} crawlers.`);
    console.log(`- New songs today: ${result.summary.systemNewToday}`);
    console.log(`- New songs past 7 days: ${result.summary.systemNewWeek}`);
    console.log(`- All-time new discoveries: ${result.summary.systemNewAllTime}`);
    console.log(`- Total crawler runs recorded: ${result.summary.systemTotalRuns}`);
    console.log(`- Crawlers needing review (zero-yield): ${result.summary.reviewCount}`);
}

module.exports = {
    aggregateCrawlerMetrics,
    AGENTS
};

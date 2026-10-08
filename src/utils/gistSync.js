const fs = require('fs');
const path = require('path');

function getGistConfig() {
    let gistId = process.env.GITHUB_GIST_ID;
    let token = process.env.GITHUB_TOKEN;

    const secretsPath = path.join(__dirname, '..', '..', 'configs', 'secrets.json');
    if (fs.existsSync(secretsPath)) {
        try {
            const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
            if (!gistId && secrets.githubGistId) gistId = secrets.githubGistId;
            if (!token && secrets.githubToken) token = secrets.githubToken;
        } catch (e) {
            console.warn('[Gist Sync] Warning: Unable to parse configs/secrets.json:', e.message);
        }
    }

    return { gistId, token };
}

async function fetchCurrentGistData(gistId, token) {
    try {
        const response = await fetch(`https://api.github.com/gists/${gistId}`, {
            method: 'GET',
            headers: {
                'Accept': 'application/vnd.github+json',
                'Authorization': `Bearer ${token}`,
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'LiveMusicSearchAgent-Telemetry'
            }
        });

        if (!response.ok) return null;
        const data = await response.json();

        const files = data.files || {};
        const metricsFile = files['crawler_metrics.json'];
        if (metricsFile && metricsFile.content) {
            return JSON.parse(metricsFile.content);
        }
    } catch (e) {
        console.warn('[Gist Sync] Could not fetch/parse current Gist data:', e.message);
    }
    return null;
}

function mergeMetrics(localMetrics, gistMetrics) {
    if (!gistMetrics || !gistMetrics.crawlers) return localMetrics;

    const mergedCrawlers = [];
    const localCrawlersMap = new Map(localMetrics.crawlers.map(c => [c.id, c]));
    const gistCrawlersMap = new Map(gistMetrics.crawlers.map(c => [c.id, c]));

    // Combine all unique crawler IDs
    const allCrawlerIds = new Set([...localCrawlersMap.keys(), ...gistCrawlersMap.keys()]);

    for (const id of allCrawlerIds) {
        const localCrawler = localCrawlersMap.get(id);
        const gistCrawler = gistCrawlersMap.get(id);

        if (!localCrawler) {
            mergedCrawlers.push(gistCrawler);
            continue;
        }
        if (!gistCrawler) {
            mergedCrawlers.push(localCrawler);
            continue;
        }

        const localDate = localCrawler.lastRun ? new Date(localCrawler.lastRun).getTime() : 0;
        const gistDate = gistCrawler.lastRun ? new Date(gistCrawler.lastRun).getTime() : 0;

        if (gistDate > localDate) {
            // Ensure daysSinceLastRun and Inactive status is dynamically updated for old Gist data
            const now = new Date();
            const daysSince = gistCrawler.lastRun ? Math.floor((now - gistDate) / (1000 * 60 * 60 * 24)) : 999;
            gistCrawler.health.daysSinceLastRun = daysSince;
            if (gistCrawler.schedule !== 'Manual' && daysSince > 10) {
                gistCrawler.health.healthStatus = 'Inactive';
                gistCrawler.health.badge = 'danger';
                gistCrawler.health.recommendation = `No runs detected in ${daysSince} days. Check Windows Task Scheduler.`;
            }
            mergedCrawlers.push(gistCrawler);
        } else {
            mergedCrawlers.push(localCrawler);
        }
    }

    // Recompute the dashboard summary counts based on the merged crawlers
    const summary = {
        totalCrawlers: mergedCrawlers.length,
        systemNewToday: mergedCrawlers.reduce((sum, c) => sum + (c.stats?.today?.newSongs || 0), 0),
        systemNewWeek: mergedCrawlers.reduce((sum, c) => sum + (c.stats?.past7Days?.newSongs || 0), 0),
        systemNewAllTime: mergedCrawlers.reduce((sum, c) => sum + (c.stats?.allTime?.newSongs || 0), 0),
        systemTotalRuns: mergedCrawlers.reduce((sum, c) => sum + (c.stats?.allTime?.runs || 0), 0),
        healthyCount: mergedCrawlers.filter(c => c.health?.badge === 'success' || c.health?.healthStatus === 'Healthy' || c.health?.badge === 'info' || c.health?.healthStatus === 'Moderate').length,
        reviewCount: mergedCrawlers.filter(c => c.health?.badge === 'warning' || c.health?.healthStatus === 'Needs Review').length,
        inactiveCount: mergedCrawlers.filter(c => c.health?.badge === 'danger' || c.health?.healthStatus === 'Inactive').length
    };

    return {
        generatedAt: new Date().toISOString(),
        summary: summary,
        crawlers: mergedCrawlers
    };
}

async function syncMetricsToGist(metricsData) {
    const { gistId, token } = getGistConfig();

    if (!gistId || !token) {
        console.log('[Gist Sync] Notice: GITHUB_GIST_ID or GITHUB_TOKEN not configured. Skipping remote sync.');
        console.log('[Gist Sync] (Add githubGistId and githubToken to configs/secrets.json when ready).');
        return { success: false, skipped: true };
    }

    let finalMetricsData = metricsData;
    // Always attempt to fetch and merge existing remote Gist data before pushing
    if (typeof metricsData !== 'string') {
        const gistData = await fetchCurrentGistData(gistId, token);
        if (gistData) {
            console.log('[Gist Sync] Fetched existing Gist data, merging local and remote crawlers...');
            finalMetricsData = mergeMetrics(metricsData, gistData);
        }
    }

    const payload = {
        description: 'Live Music Search Agent - Crawler Health & Metrics',
        files: {
            'crawler_metrics.json': {
                content: typeof finalMetricsData === 'string' ? finalMetricsData : JSON.stringify(finalMetricsData, null, 2)
            }
        }
    };

    try {
        const response = await fetch(`https://api.github.com/gists/${gistId}`, {
            method: 'PATCH',
            headers: {
                'Accept': 'application/vnd.github+json',
                'Authorization': `Bearer ${token}`,
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'LiveMusicSearchAgent-Telemetry',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errBody = await response.text();
            console.error(`[Gist Sync] GitHub API Error (${response.status}):`, errBody);
            return { success: false, status: response.status, error: errBody };
        }

        const data = await response.json();
        console.log(`[Gist Sync] Successfully updated GitHub Gist (${gistId}) at ${data.updated_at}`);
        return { success: true, updatedAt: data.updated_at };
    } catch (err) {
        console.error('[Gist Sync] Network error connecting to GitHub API:', err.message);
        return { success: false, error: err.message };
    }
}

module.exports = {
    syncMetricsToGist,
    getGistConfig,
    fetchCurrentGistData,
    mergeMetrics
};


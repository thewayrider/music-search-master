const fs = require('fs');
const path = require('path');
const { aggregateCrawlerMetrics } = require('./metricsAggregator');
const { getGistConfig, fetchCurrentGistData, mergeMetrics } = require('./gistSync');

async function generateDashboard() {
    // 1. Ensure latest metrics are computed
    let analytics = aggregateCrawlerMetrics();
    const gistConfig = getGistConfig();
    
    // Fetch and merge Gist data if available
    if (gistConfig.gistId && gistConfig.token) {
        const gistData = await fetchCurrentGistData(gistConfig.gistId, gistConfig.token);
        if (gistData) {
            analytics = mergeMetrics(analytics, gistData);
        }
    }

    const gistStatusLabel = (gistConfig.gistId && gistConfig.token) 
        ? `<span class="badge badge-success">Gist Cloud Sync Active</span> (ID: ${gistConfig.gistId.slice(0, 8)}...)`
        : `<span class="badge badge-neutral">Local Only</span> (Gist sync not yet configured in configs/secrets.json)`;

    const summary = analytics.summary;

    let tableRows = '';
    for (const crawler of analytics.crawlers) {
        let lastRunText = 'Never';
        if (crawler.lastRun) {
            const d = new Date(crawler.lastRun);
            lastRunText = d.toLocaleString();
        }

        const healthBadgeClass = crawler.health.badge === 'success' 
            ? 'badge-success' 
            : (crawler.health.badge === 'warning' ? 'badge-warning' : (crawler.health.badge === 'danger' ? 'badge-danger' : 'badge-neutral'));

        tableRows += `
            <tr class="${crawler.health.badge === 'warning' ? 'row-warning' : ''}">
                <td>
                    <div class="crawler-name">${crawler.name}</div>
                    <div class="crawler-schedule">${crawler.schedule}</div>
                </td>
                <td>
                    <span class="status-pill status-${crawler.status.toLowerCase()}">${crawler.status}</span>
                    <div class="last-run-date">${lastRunText}</div>
                </td>
                <td class="metric-num">
                    <span class="stat-highlight">${crawler.stats.today.newSongs}</span>
                    <span class="stat-sub">(${crawler.stats.today.runs} runs)</span>
                </td>
                <td class="metric-num">
                    <span class="stat-highlight">${crawler.stats.past7Days.newSongs}</span>
                    <span class="stat-sub">(${crawler.stats.past7Days.runs} runs)</span>
                </td>
                <td class="metric-num">
                    <span class="stat-highlight">${crawler.stats.allTime.newSongs}</span>
                    <span class="stat-sub">(${crawler.stats.allTime.runs} runs)</span>
                </td>
                <td>
                    <span class="badge ${healthBadgeClass}">${crawler.health.healthStatus}</span>
                    <div class="recommendation-text">${crawler.health.recommendation}</div>
                </td>
            </tr>
        `;
    }

    // Generate alerts for crawlers needing attention
    const reviewCrawlers = analytics.crawlers.filter(c => c.health.badge === 'warning' || c.health.badge === 'danger');
    let alertsHtml = '';
    if (reviewCrawlers.length > 0) {
        alertsHtml = `
            <div class="alert-box">
                <div class="alert-header">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    <strong>Action Required: Reviewing Non-Performing Crawlers (${reviewCrawlers.length})</strong>
                </div>
                <div class="alert-content">
                    <ul>
                        ${reviewCrawlers.map(c => `<li><strong>${c.name}:</strong> ${c.health.recommendation}</li>`).join('')}
                    </ul>
                </div>
            </div>
        `;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Live Music Search Agent - Performance & Health Dashboard</title>
    <style>
        :root {
            --bg-primary: #0b0f19;
            --bg-card: #151d2f;
            --bg-card-hover: #1e293b;
            --border: #243048;
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --accent: #38bdf8;
            --success: #34d399;
            --warning: #fbbf24;
            --danger: #f87171;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg-primary);
            color: var(--text-main);
            margin: 0;
            padding: 32px 24px;
        }

        .container {
            max-width: 1240px;
            margin: 0 auto;
        }

        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 28px;
            border-bottom: 1px solid var(--border);
            padding-bottom: 20px;
        }

        .header-title h1 {
            font-size: 1.8rem;
            margin: 0 0 6px 0;
            color: var(--accent);
            letter-spacing: -0.02em;
        }

        .header-title p {
            margin: 0;
            color: var(--text-muted);
            font-size: 0.9rem;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 16px;
            margin-bottom: 24px;
        }

        .stat-card {
            background-color: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 18px 20px;
        }

        .stat-card .label {
            font-size: 0.8rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--text-muted);
            margin-bottom: 8px;
        }

        .stat-card .value {
            font-size: 2rem;
            font-weight: 700;
            color: var(--text-main);
        }

        .stat-card .subtext {
            font-size: 0.8rem;
            color: var(--text-muted);
            margin-top: 4px;
        }

        .alert-box {
            background: rgba(251, 191, 36, 0.08);
            border: 1px solid rgba(251, 191, 36, 0.3);
            border-radius: 10px;
            padding: 16px 20px;
            margin-bottom: 24px;
        }

        .alert-header {
            display: flex;
            align-items: center;
            gap: 10px;
            color: var(--warning);
            font-size: 0.95rem;
            margin-bottom: 8px;
        }

        .alert-content ul {
            margin: 0;
            padding-left: 24px;
            color: #e2e8f0;
            font-size: 0.88rem;
            line-height: 1.5;
        }

        .table-container {
            background-color: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            margin-bottom: 24px;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            text-align: left;
        }

        th {
            background-color: #0f172a;
            color: var(--text-muted);
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            padding: 14px 18px;
            border-bottom: 1px solid var(--border);
        }

        td {
            padding: 14px 18px;
            border-bottom: 1px solid var(--border);
            vertical-align: middle;
            font-size: 0.9rem;
        }

        tr:last-child td {
            border-bottom: none;
        }

        tr:hover {
            background-color: var(--bg-card-hover);
        }

        tr.row-warning {
            background: rgba(251, 191, 36, 0.03);
        }

        .crawler-name {
            font-weight: 600;
            font-size: 0.95rem;
            color: #fff;
        }

        .crawler-schedule {
            font-size: 0.78rem;
            color: var(--text-muted);
            margin-top: 3px;
        }

        .last-run-date {
            font-size: 0.78rem;
            color: var(--text-muted);
            margin-top: 3px;
        }

        .metric-num {
            text-align: left;
        }

        .stat-highlight {
            font-weight: 700;
            font-size: 1.05rem;
            color: var(--text-main);
        }

        .stat-sub {
            font-size: 0.78rem;
            color: var(--text-muted);
            margin-left: 4px;
        }

        .badge {
            display: inline-block;
            font-size: 0.75rem;
            font-weight: 600;
            padding: 3px 8px;
            border-radius: 4px;
            letter-spacing: 0.02em;
        }

        .badge-success { background: rgba(52, 211, 153, 0.15); color: var(--success); }
        .badge-warning { background: rgba(251, 191, 36, 0.15); color: var(--warning); }
        .badge-danger { background: rgba(248, 113, 113, 0.15); color: var(--danger); }
        .badge-neutral { background: rgba(148, 163, 184, 0.15); color: var(--text-muted); }

        .status-pill {
            display: inline-block;
            font-size: 0.75rem;
            font-weight: 600;
            padding: 2px 6px;
            border-radius: 4px;
        }

        .status-success { background: rgba(52, 211, 153, 0.12); color: var(--success); }
        .status-failed { background: rgba(248, 113, 113, 0.12); color: var(--danger); }
        .status-pending { background: rgba(148, 163, 184, 0.12); color: var(--text-muted); }

        .recommendation-text {
            font-size: 0.8rem;
            color: #cbd5e1;
            margin-top: 4px;
            max-width: 320px;
            line-height: 1.35;
        }

        .footer-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 0.82rem;
            color: var(--text-muted);
            padding: 10px 4px;
        }

        .refresh-btn {
            background-color: var(--accent);
            color: #0b0f19;
            border: none;
            border-radius: 6px;
            padding: 10px 18px;
            font-weight: 600;
            font-size: 0.88rem;
            cursor: pointer;
            transition: opacity 0.2s;
        }

        .refresh-btn:hover {
            opacity: 0.9;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="header-title">
                <h1>Live Music Search Agent &mdash; Health & Metrics</h1>
                <p>Telemetry, discovery statistics, and scheduler performance for all 10 music crawlers</p>
            </div>
            <button class="refresh-btn" onclick="location.reload()">Refresh & Recalculate</button>
        </header>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="label">Weekly Discoveries</div>
                <div class="value" style="color: var(--accent);">${summary.systemNewWeek}</div>
                <div class="subtext">New songs past 7 days</div>
            </div>
            <div class="stat-card">
                <div class="label">All-Time Discoveries</div>
                <div class="value">${summary.systemNewAllTime}</div>
                <div class="subtext">From ${summary.systemTotalRuns} recorded crawler runs</div>
            </div>
            <div class="stat-card">
                <div class="label">Performing Crawlers</div>
                <div class="value" style="color: var(--success);">${summary.healthyCount} / ${summary.totalCrawlers}</div>
                <div class="subtext">Yielding new indie tracks</div>
            </div>
            <div class="stat-card">
                <div class="label">Needs Review</div>
                <div class="value" style="color: ${summary.reviewCount > 0 ? 'var(--warning)' : 'var(--text-muted)'};">${summary.reviewCount}</div>
                <div class="subtext">Consecutive zero-yield runs</div>
            </div>
        </div>

        ${alertsHtml}

        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Crawler & Schedule</th>
                        <th>Last Run Status</th>
                        <th>Today (New / Runs)</th>
                        <th>Past 7 Days</th>
                        <th>All Time</th>
                        <th>Health & Recommendation</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
        </div>

        <div class="footer-bar">
            <div>Cloud Bridge: ${gistStatusLabel}</div>
            <div>Generated: ${new Date().toLocaleString()} &bull; Host: Mini PC / Desktop Dual-Setup</div>
        </div>
    </div>
</body>
</html>`;

    const outPath = path.join(__dirname, '..', '..', 'dashboard.html');
    fs.writeFileSync(outPath, html);
    console.log(`[Dashboard] Upgraded dashboard generated successfully at: ${outPath}`);
}

if (require.main === module) {
    generateDashboard().catch(console.error);
}

module.exports = {
    generateDashboard
};

// Fleet Command Center Client Controller

let currentActiveDrawerService = null;
let logPollInterval = null;
let cachedDiscoveries = [];

// DOM Elements
const serverStatusPill = document.getElementById('server-status-pill');
const serverStatusText = document.getElementById('server-status-text');
const uptimeDisplay = document.getElementById('uptime-display');
const kpiUniqueSongs = document.getElementById('kpi-unique-songs');
const kpiSightings = document.getElementById('kpi-sightings');
const kpiConsensus = document.getElementById('kpi-consensus');
const kpiActiveServices = document.getElementById('kpi-active-services');
const servicesContainer = document.getElementById('services-container');
const discoveriesTbody = document.getElementById('discoveries-tbody');
const trackFilterInput = document.getElementById('track-filter-input');
const btnRefreshTracks = document.getElementById('btn-refresh-tracks');
const btnManualRefresh = document.getElementById('btn-manual-refresh');

// Drawer Elements
const logDrawer = document.getElementById('log-drawer');
const drawerServiceName = document.getElementById('drawer-service-name');
const drawerServiceId = document.getElementById('drawer-service-id');
const terminalBody = document.getElementById('terminal-body');
const autoscrollCheck = document.getElementById('autoscroll-check');
const btnClearTerminal = document.getElementById('btn-clear-terminal');
const btnCloseDrawer = document.getElementById('btn-close-drawer');

// Format duration
function formatDuration(ms) {
  if (!ms && ms !== 0) return 'N/A';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Format relative date
function formatDate(isoString) {
  if (!isoString) return 'Never';
  const d = new Date(isoString);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// 1. Fetch Fleet Status
async function fetchFleetStatus() {
  try {
    const res = await fetch('/api/fleet/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Update Telemetry Header
    serverStatusPill.className = 'telemetry-pill live';
    serverStatusText.textContent = 'FLEET OPERATIONAL';
    const mins = Math.floor(data.uptimeSeconds / 60);
    const secs = data.uptimeSeconds % 60;
    uptimeDisplay.textContent = `Uptime: ${mins}m ${secs}s`;

    // Update KPIs
    kpiUniqueSongs.textContent = data.database?.totalUniqueSongs?.toLocaleString() || '0';
    kpiSightings.textContent = data.database?.totalSightings?.toLocaleString() || '0';
    kpiConsensus.textContent = data.database?.consensusSongsCount?.toLocaleString() || '0';

    const runningCount = data.services.filter(s => s.state === 'running').length;
    kpiActiveServices.textContent = runningCount > 0 ? `${runningCount} Running` : `${data.services.length} Ready`;

    // Render Services Grid
    renderServices(data.services);

  } catch (err) {
    serverStatusPill.className = 'telemetry-pill error';
    serverStatusText.textContent = 'OFFLINE / RECONNECTING';
    console.warn('Fleet poll error:', err);
  }
}

// 2. Render Service Cards
function renderServices(services) {
  servicesContainer.innerHTML = '';

  services.forEach(s => {
    const card = document.createElement('div');
    card.className = `service-card ${s.state === 'running' ? 'running' : ''}`;

    const isRunning = s.state === 'running';
    const exitStatus = s.lastExitCode === 0 ? '✓ Clean Exit' : s.lastExitCode !== null ? `✗ Exit ${s.lastExitCode}` : 'Idle';

    card.innerHTML = `
      <div>
        <div class="service-top">
          <div class="service-badge-group">
            <span class="market-badge">${s.market || 'RADAR'}</span>
            <span class="state-badge ${s.state}">${s.state}</span>
          </div>
          <button class="btn-terminal" onclick="openDrawer('${s.id}', '${s.name}')" title="Inspect Terminal">
            📟 Logs (${s.logCount})
          </button>
        </div>

        <h3 class="service-name">${s.name}</h3>
        <p class="service-desc">${s.description}</p>
      </div>

      <div class="service-meta">
        <div><strong>Schedule:</strong> ${s.schedule}</div>
        <div><strong>Last Run:</strong> ${formatDate(s.lastRunStartedAt)} (${formatDuration(s.lastDurationMs)})</div>
        <div><strong>Result:</strong> ${exitStatus}</div>
      </div>

      <div class="service-actions">
        ${isRunning ? `
          <button class="btn-stop" onclick="stopService('${s.id}')">⏹ Stop</button>
          <button class="btn-launch" disabled>⏳ Executing...</button>
        ` : `
          <button class="btn-launch" onclick="triggerService('${s.id}')">
            ▶ 1-Click Launch
          </button>
        `}
      </div>
    `;

    servicesContainer.appendChild(card);
  });
}

// 3. Trigger Service
async function triggerService(serviceId) {
  try {
    const res = await fetch(`/api/fleet/trigger/${serviceId}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      alert(`Error launching service: ${data.error}`);
      return;
    }
    openDrawer(serviceId, data.name || serviceId);
    fetchFleetStatus();
  } catch (err) {
    alert(`Failed to trigger: ${err.message}`);
  }
}

// 4. Stop Service
async function stopService(serviceId) {
  try {
    const res = await fetch(`/api/fleet/stop/${serviceId}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      alert(`Error: ${data.error}`);
      return;
    }
    fetchFleetStatus();
  } catch (err) {
    alert(`Failed to stop: ${err.message}`);
  }
}

// 5. Drawer & Live Terminal Logs
function openDrawer(serviceId, name) {
  currentActiveDrawerService = serviceId;
  drawerServiceName.textContent = name || serviceId;
  drawerServiceId.textContent = serviceId;
  logDrawer.classList.add('open');

  pollLogs();
  if (logPollInterval) clearInterval(logPollInterval);
  logPollInterval = setInterval(pollLogs, 1000);
}

function closeDrawer() {
  logDrawer.classList.remove('open');
  if (logPollInterval) clearInterval(logPollInterval);
  currentActiveDrawerService = null;
}

async function pollLogs() {
  if (!currentActiveDrawerService) return;
  try {
    const res = await fetch(`/api/fleet/logs/${currentActiveDrawerService}`);
    if (!res.ok) return;
    const data = await res.json();

    terminalBody.innerHTML = '';
    if (!data.logs || data.logs.length === 0) {
      terminalBody.innerHTML = '<div class="terminal-line">[Idle] No output logged for this session yet.</div>';
      return;
    }

    data.logs.forEach(line => {
      const lineEl = document.createElement('div');
      lineEl.className = 'terminal-line';
      if (line.includes('[stderr]') || line.includes('error') || line.includes('Error')) {
        lineEl.classList.add('error');
      } else if (line.includes('Discovered') || line.includes('Finished') || line.includes('PASS') || line.includes('SUCCESS')) {
        lineEl.classList.add('success');
      } else if (line.includes('Command Center') || line.includes('STARTING')) {
        lineEl.classList.add('info');
      }
      lineEl.textContent = line;
      terminalBody.appendChild(lineEl);
    });

    if (autoscrollCheck.checked) {
      terminalBody.scrollTop = terminalBody.scrollHeight;
    }
  } catch (err) {
    console.error('Error polling logs:', err);
  }
}

// 6. Fetch Recent Discoveries
async function fetchDiscoveries() {
  try {
    const res = await fetch('/api/fleet/recent-discoveries?limit=25');
    if (!res.ok) return;
    const data = await res.json();
    cachedDiscoveries = data.tracks || [];
    renderDiscoveries();
  } catch (err) {
    console.error('Error fetching discoveries:', err);
  }
}

function renderDiscoveries() {
  const query = (trackFilterInput.value || '').trim().toLowerCase();
  const filtered = cachedDiscoveries.filter(t => {
    if (!query) return true;
    return (t.artist && t.artist.toLowerCase().includes(query)) ||
           (t.title && t.title.toLowerCase().includes(query));
  });

  discoveriesTbody.innerHTML = '';
  if (filtered.length === 0) {
    discoveriesTbody.innerHTML = '<tr><td colspan="5" class="empty-state">No matching tracks found in recent discoveries.</td></tr>';
    return;
  }

  filtered.forEach(t => {
    const tr = document.createElement('tr');
    const isHot = (t.heat_score || 0) >= 2;

    tr.innerHTML = `
      <td><span class="heat-badge ${isHot ? 'hot' : ''}">🔥 ${t.heat_score || 1}</span></td>
      <td><strong>${t.artist}</strong></td>
      <td>${t.title}</td>
      <td><span class="market-badge">${t.first_channel || 'Radar'}</span></td>
      <td>${formatDate(t.first_seen_at || t.created_at)}</td>
    `;
    discoveriesTbody.appendChild(tr);
  });
}

// Event Listeners
btnCloseDrawer.addEventListener('click', closeDrawer);
btnClearTerminal.addEventListener('click', () => {
  terminalBody.innerHTML = '<div class="terminal-line">[Cleared] Console display cleared.</div>';
});
btnManualRefresh.addEventListener('click', () => {
  fetchFleetStatus();
  fetchDiscoveries();
  fetchAnalytics();
});
btnRefreshTracks.addEventListener('click', fetchDiscoveries);
trackFilterInput.addEventListener('input', renderDiscoveries);

// 7. Fetch Crawler Performance & Health Analytics (Android & Gist Synced)
const analyticsTbody = document.getElementById('analytics-tbody');
const analyticsAlertBox = document.getElementById('analytics-alert-box');
const analyticsAlertList = document.getElementById('analytics-alert-list');
const btnSyncGist = document.getElementById('btn-sync-gist');

async function fetchAnalytics() {
  try {
    const res = await fetch('/api/analytics');
    if (!res.ok) return;
    const data = await res.json();
    renderAnalytics(data);
  } catch (err) {
    console.error('Error fetching analytics:', err);
  }
}

function renderAnalytics(data) {
  if (!analyticsTbody || !data.crawlers) return;
  analyticsTbody.innerHTML = '';

  const reviewCrawlers = data.crawlers.filter(c => c.health.badge === 'warning' || c.health.badge === 'danger');
  if (reviewCrawlers.length > 0) {
    analyticsAlertBox.style.display = 'block';
    analyticsAlertList.innerHTML = reviewCrawlers.map(c => `<li><strong>${c.name}:</strong> ${c.health.recommendation}</li>`).join('');
  } else {
    analyticsAlertBox.style.display = 'none';
  }

  data.crawlers.forEach(c => {
    const tr = document.createElement('tr');
    if (c.health.badge === 'warning') tr.className = 'row-warning';

    const healthBadgeClass = c.health.badge === 'success'
      ? 'badge-success'
      : (c.health.badge === 'warning' ? 'badge-warning' : (c.health.badge === 'danger' ? 'badge-danger' : 'badge-neutral'));

    const lastRunText = c.lastRun ? new Date(c.lastRun).toLocaleString() : 'Never';

    tr.innerHTML = `
      <td>
        <div style="font-weight: 600; color: #f8fafc;">${c.name}</div>
        <div style="font-size: 0.75rem; color: #94a3b8;">${c.schedule}</div>
      </td>
      <td>
        <span class="status-pill status-${(c.status || 'success').toLowerCase()}">${c.status || 'Success'}</span>
        <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 2px;">${lastRunText}</div>
      </td>
      <td style="text-align: center;">
        <span style="font-weight: 700; color: #38bdf8;">${c.stats?.today?.newSongs || 0}</span>
        <span style="font-size: 0.75rem; color: #94a3b8; display: block;">(${c.stats?.today?.runs || 0} runs)</span>
      </td>
      <td style="text-align: center;">
        <span style="font-weight: 700; color: #38bdf8;">${c.stats?.past7Days?.newSongs || 0}</span>
        <span style="font-size: 0.75rem; color: #94a3b8; display: block;">(${c.stats?.past7Days?.runs || 0} runs)</span>
      </td>
      <td style="text-align: center;">
        <span style="font-weight: 700; color: #38bdf8;">${c.stats?.allTime?.newSongs || 0}</span>
        <span style="font-size: 0.75rem; color: #94a3b8; display: block;">(${c.stats?.allTime?.runs || 0} runs)</span>
      </td>
      <td>
        <span class="badge ${healthBadgeClass}">${c.health?.healthStatus || 'Healthy'}</span>
        <div style="font-size: 0.78rem; color: #94a3b8; margin-top: 4px;">${c.health?.recommendation || ''}</div>
      </td>
    `;
    analyticsTbody.appendChild(tr);
  });
}

if (btnSyncGist) {
  btnSyncGist.addEventListener('click', async () => {
    btnSyncGist.textContent = '⏳ Syncing...';
    btnSyncGist.disabled = true;
    try {
      const res = await fetch('/api/analytics/sync', { method: 'POST' });
      const d = await res.json();
      if (d.success) {
        alert('Telemetry synchronized successfully to GitHub Gist for Android Monitor!');
        fetchAnalytics();
      } else {
        alert('Sync error: ' + (d.error || 'Failed'));
      }
    } catch (e) {
      alert('Network error syncing to Gist: ' + e.message);
    } finally {
      btnSyncGist.textContent = '☁️ Sync to Gist';
      btnSyncGist.disabled = false;
    }
  });
}

// Initialization
fetchFleetStatus();
fetchDiscoveries();
fetchAnalytics();
setInterval(fetchFleetStatus, 2500);


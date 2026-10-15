const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getMasterStats, getDatabase } = require('../utils/masterDb');

class FleetManager {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '../../');

    // Complete Fleet Registry: Daily Radars + Weekly Crawlers
    this.services = {
      // 24/7 Daily Radars
      'global-radar': {
        id: 'global-radar',
        name: 'Global 24h Radar',
        description: 'Multi-channel 24h open-web discovery (Bandcamp, YouTube, SoundCloud, Blogs, Deezer, MusicBrainz)',
        market: 'DAILY',
        schedule: 'Daily at 06:30 AM',
        command: 'node',
        args: ['src/index.js', '--radar-global'],
        cwd: this.projectRoot,
        state: 'idle',
        lastRunStartedAt: null,
        lastRunFinishedAt: null,
        lastExitCode: null,
        lastDurationMs: null,
        logs: []
      },
      'us-radar': {
        id: 'us-radar',
        name: 'US Edition Radar',
        description: 'Curated 24h US indie rock tastemakers (BrooklynVegan, Stereogum, Big Takeover, Gorilla vs Bear, etc.)',
        market: 'DAILY',
        schedule: 'Daily at 07:00 AM',
        command: 'node',
        args: ['src/index.js', '--radar-us'],
        cwd: this.projectRoot,
        state: 'idle',
        lastRunStartedAt: null,
        lastRunFinishedAt: null,
        lastExitCode: null,
        lastDurationMs: null,
        logs: []
      },
      'global-dry-run': {
        id: 'global-dry-run',
        name: 'Global Sandbox (Dry-Run)',
        description: 'Scans live global web, applies EveryNoise filters, read-only database mode (no email sent)',
        market: 'SANDBOX',
        schedule: 'On-Demand',
        command: 'node',
        args: ['src/index.js', '--radar-global', '--dry-run'],
        cwd: this.projectRoot,
        state: 'idle',
        lastRunStartedAt: null,
        lastRunFinishedAt: null,
        lastExitCode: null,
        lastDurationMs: null,
        logs: []
      },
      'us-dry-run': {
        id: 'us-dry-run',
        name: 'US Sandbox (Dry-Run)',
        description: 'Scans live US tastemakers, applies EveryNoise filters, read-only database mode (no email sent)',
        market: 'SANDBOX',
        schedule: 'On-Demand',
        command: 'node',
        args: ['src/index.js', '--radar-us', '--dry-run'],
        cwd: this.projectRoot,
        state: 'idle',
        lastRunStartedAt: null,
        lastRunFinishedAt: null,
        lastExitCode: null,
        lastDurationMs: null,
        logs: []
      },

      // Weekly Crawlers Fleet
      'bandcamp-weekly': {
        id: 'bandcamp-weekly',
        name: 'Bandcamp Discover Fleet',
        description: 'AU/NZ city-filtered indie & alternative releases from Bandcamp',
        market: 'WEEKLY',
        schedule: 'Mon/Wed/Fri/Sat at 09:00 AM',
        command: 'node',
        args: ['src/index.js', 'configs/bandcamp_indie.json'],
        cwd: this.projectRoot,
        state: 'idle',
        lastRunStartedAt: null,
        lastRunFinishedAt: null,
        lastExitCode: null,
        lastDurationMs: null,
        logs: []
      },
      'amrap-weekly': {
        id: 'amrap-weekly',
        name: 'AMRAP Community Radio',
        description: 'Australian community radio chart debuts with MusicBrainz enrichment',
        market: 'WEEKLY',
        schedule: 'Thursday at 04:00 PM',
        command: 'node',
        args: ['src/index.js', 'configs/amrap_indie.json'],
        cwd: this.projectRoot,
        state: 'idle',
        lastRunStartedAt: null,
        lastRunFinishedAt: null,
        lastExitCode: null,
        lastDurationMs: null,
        logs: []
      },
      'listenbrainz-weekly': {
        id: 'listenbrainz-weekly',
        name: 'ListenBrainz Explorer',
        description: 'Fresh releases stream mapped with MusicBrainz origin cache',
        market: 'WEEKLY',
        schedule: 'Mon/Fri at 09:00 AM',
        command: 'node',
        args: ['src/index.js', 'configs/listenbrainz_indie.json'],
        cwd: this.projectRoot,
        state: 'idle',
        lastRunStartedAt: null,
        lastRunFinishedAt: null,
        lastExitCode: null,
        lastDurationMs: null,
        logs: []
      },
      'musicbrainz-weekly': {
        id: 'musicbrainz-weekly',
        name: 'MusicBrainz Tag Registry',
        description: 'Lucene query across registered indie rock release groups',
        market: 'WEEKLY',
        schedule: 'Mon/Wed/Fri at 09:30 AM',
        command: 'node',
        args: ['src/index.js', 'configs/musicbrainz_indie.json'],
        cwd: this.projectRoot,
        state: 'idle',
        lastRunStartedAt: null,
        lastRunFinishedAt: null,
        lastExitCode: null,
        lastDurationMs: null,
        logs: []
      },
      'triplejunearthed-weekly': {
        id: 'triplejunearthed-weekly',
        name: 'Triple J Unearthed',
        description: 'New Australian indie discoveries and debuts from Triple J Unearthed',
        market: 'WEEKLY',
        schedule: 'Mon, Wed, Fri at 02:00 PM',
        command: 'node',
        args: ['src/index.js', 'configs/triplej_unearthed_indie.json'],
        cwd: this.projectRoot,
        state: 'idle',
        lastRunStartedAt: null,
        lastRunFinishedAt: null,
        lastExitCode: null,
        lastDurationMs: null,
        logs: []
      },
      'aircharts-weekly': {
        id: 'aircharts-weekly',
        name: 'AIR Independent Charts',
        description: 'Headless browser scraping of 100% Australian Independent Charts',
        market: 'WEEKLY',
        schedule: 'Monday at 04:00 PM',
        command: 'node',
        args: ['src/index.js', 'configs/air_charts.json'],
        cwd: this.projectRoot,
        state: 'idle',
        lastRunStartedAt: null,
        lastRunFinishedAt: null,
        lastExitCode: null,
        lastDurationMs: null,
        logs: []
      },
      'deezer-weekly': {
        id: 'deezer-weekly',
        name: 'Deezer Editorial Playlists',
        description: 'Editorial indie playlists with ISRC origin verification',
        market: 'WEEKLY',
        schedule: 'Friday at 11:00 AM',
        command: 'node',
        args: ['src/index.js', 'configs/deezer_indie.json'],
        cwd: this.projectRoot,
        state: 'idle',
        lastRunStartedAt: null,
        lastRunFinishedAt: null,
        lastExitCode: null,
        lastDurationMs: null,
        logs: []
      },
      'futuremag-weekly': {
        id: 'futuremag-weekly',
        name: 'Futuremag Music Blog',
        description: 'Australian music blog roundup with Gemini AI release extraction',
        market: 'WEEKLY',
        schedule: 'Friday at 09:00 AM',
        command: 'node',
        args: ['src/index.js', 'configs/futuremag_indie.json'],
        cwd: this.projectRoot,
        state: 'idle',
        lastRunStartedAt: null,
        lastRunFinishedAt: null,
        lastExitCode: null,
        lastDurationMs: null,
        logs: []
      },
      'rootsmag-weekly': {
        id: 'rootsmag-weekly',
        name: 'Roots Mag & NZ Musician',
        description: 'Curated New Zealand indie releases from Roots Mag and NZ Musician',
        market: 'WEEKLY',
        schedule: 'Friday at 09:00 AM',
        command: 'node',
        args: ['src/index.js', 'configs/rootsmag_indie.json'],
        cwd: this.projectRoot,
        state: 'idle',
        lastRunStartedAt: null,
        lastRunFinishedAt: null,
        lastExitCode: null,
        lastDurationMs: null,
        logs: []
      },
      'nialler9-weekly': {
        id: 'nialler9-weekly',
        name: 'Nialler9 Irish Indie',
        description: 'Irish and European indie releases from Nialler9 with AI extraction',
        market: 'WEEKLY',
        schedule: 'Friday at 10:00 AM',
        command: 'node',
        args: ['src/index.js', 'configs/nialler9_indie.json'],
        cwd: this.projectRoot,
        state: 'idle',
        lastRunStartedAt: null,
        lastRunFinishedAt: null,
        lastExitCode: null,
        lastDurationMs: null,
        logs: []
      },
      'newreleasesnow-weekly': {
        id: 'newreleasesnow-weekly',
        name: 'New Releases Now',
        description: 'Friday album & EP releases across indie rock, pop, folk, alternative, and post-punk',
        market: 'WEEKLY',
        schedule: 'Saturday at 09:30 AM',
        command: 'node',
        args: ['src/index.js', 'configs/newreleasesnow_indie.json'],
        cwd: this.projectRoot,
        state: 'idle',
        lastRunStartedAt: null,
        lastRunFinishedAt: null,
        lastExitCode: null,
        lastDurationMs: null,
        logs: []
      }
    };

    this.activeProcesses = new Map();
    this.statusFilePath = path.join(this.projectRoot, 'saved_searches/dashboard_status.json');
    this._loadPersistedStatus();
  }

  _loadPersistedStatus() {
    if (!fs.existsSync(this.statusFilePath)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.statusFilePath, 'utf8'));
      const STATUS_KEY_MAP = {
        'global-radar': 'global_radar_daily',
        'us-radar': 'us_radar_daily',
        'bandcamp-weekly': 'bandcamp_indie_discovery',
        'amrap-weekly': 'amrap_indie_discovery',
        'listenbrainz-weekly': 'listenbrainz_indie_discovery',
        'musicbrainz-weekly': 'musicbrainz_indie_discovery',
        'aircharts-weekly': 'air_charts_discovery',
        'rootsmag-weekly': 'roots_mag',
        'futuremag-weekly': 'futuremag_indie_discovery',
        'deezer-weekly': 'deezer_indie_discovery',
        'nialler9-weekly': 'nialler9_indie_discovery',
        'triplejunearthed-weekly': 'triple_j_unearthed_discovery',
        'newreleasesnow-weekly': 'newreleasesnow_indie_discovery'
      };

      for (const [serviceId, statusKey] of Object.entries(STATUS_KEY_MAP)) {
        const service = this.services[serviceId];
        const statusEntry = data[statusKey];
        if (service && statusEntry && statusEntry.lastRun) {
          service.lastRunStartedAt = statusEntry.lastRun;
          service.lastRunFinishedAt = statusEntry.lastRun;
          service.lastExitCode = statusEntry.status === 'Success' ? 0 : (statusEntry.status === 'Failed' ? 1 : null);
        }
      }
    } catch (err) {
      console.warn('[FleetManager] Warning loading persisted status:', err.message);
    }
  }

  _persistServiceStatus(service, exitCode) {
    if (!fs.existsSync(this.statusFilePath)) return;
    try {
      const STATUS_KEY_MAP = {
        'global-radar': 'global_radar_daily',
        'us-radar': 'us_radar_daily',
        'bandcamp-weekly': 'bandcamp_indie_discovery',
        'amrap-weekly': 'amrap_indie_discovery',
        'listenbrainz-weekly': 'listenbrainz_indie_discovery',
        'musicbrainz-weekly': 'musicbrainz_indie_discovery',
        'aircharts-weekly': 'air_charts_discovery',
        'rootsmag-weekly': 'roots_mag',
        'futuremag-weekly': 'futuremag_indie_discovery',
        'deezer-weekly': 'deezer_indie_discovery',
        'nialler9-weekly': 'nialler9_indie_discovery',
        'triplejunearthed-weekly': 'triple_j_unearthed_discovery',
        'newreleasesnow-weekly': 'newreleasesnow_indie_discovery'
      };
      const key = STATUS_KEY_MAP[service.id];
      if (!key) return;
      const data = JSON.parse(fs.readFileSync(this.statusFilePath, 'utf8'));
      data[key] = {
        ...(data[key] || {}),
        name: service.name,
        lastRun: service.lastRunFinishedAt || new Date().toISOString(),
        status: exitCode === 0 ? 'Success' : 'Failed'
      };
      fs.writeFileSync(this.statusFilePath, JSON.stringify(data, null, 2));
    } catch (_) {}
  }

  getFleetStatus() {
    let dbStats = { totalUniqueSongs: 0, totalSightings: 0, consensusSongsCount: 0 };
    try {
      dbStats = getMasterStats();
    } catch (e) {
      // Database may be initializing
    }

    const serviceSummaries = Object.values(this.services).map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      market: s.market,
      schedule: s.schedule,
      state: s.state,
      lastRunStartedAt: s.lastRunStartedAt,
      lastRunFinishedAt: s.lastRunFinishedAt,
      lastExitCode: s.lastExitCode,
      lastDurationMs: s.lastDurationMs,
      logCount: s.logs.length
    }));

    return {
      status: 'operational',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      platform: process.platform,
      database: dbStats,
      services: serviceSummaries
    };
  }

  getRecentDiscoveries(limit = 25) {
    try {
      const db = getDatabase();
      const query = `
        SELECT s.id, s.artist, s.title, s.slug, s.first_seen_at, s.first_channel, s.heat_score, s.created_at
        FROM songs s
        ORDER BY s.id DESC
        LIMIT ?
      `;
      const rows = db.prepare(query).all(limit);
      return rows;
    } catch (e) {
      console.error('Error in getRecentDiscoveries:', e);
      return [];
    }
  }

  _resolveService(serviceId) {
    if (!serviceId) return null;
    if (this.services[serviceId]) return this.services[serviceId];
    if (this.services[`${serviceId}-weekly`]) return this.services[`${serviceId}-weekly`];
    if (this.services[`${serviceId}-radar`]) return this.services[`${serviceId}-radar`];
    const stripped = serviceId.replace(/-weekly$/, '').replace(/-radar$/, '');
    if (this.services[stripped]) return this.services[stripped];
    return null;
  }

  getServiceLogs(serviceId) {
    const service = this._resolveService(serviceId);
    if (!service) return { error: `Service '${serviceId}' not found.` };
    return {
      serviceId: service.id,
      name: service.name,
      state: service.state,
      logs: service.logs
    };
  }

  triggerService(serviceId) {
    const service = this._resolveService(serviceId);
    if (!service) {
      return { success: false, error: `Service '${serviceId}' does not exist.` };
    }

    if (service.state === 'running') {
      return { success: false, error: `Service '${service.name}' is already running.` };
    }

    service.state = 'running';
    service.lastRunStartedAt = new Date().toISOString();
    service.lastRunFinishedAt = null;
    service.lastExitCode = null;
    service.logs = [];

    const startTime = Date.now();
    this._addLog(service, `[Command Center] Starting execution of ${service.name}...`);
    this._addLog(service, `[Command Center] Command: ${service.command} ${service.args.join(' ')}`);

    const isWindows = process.platform === 'win32';
    const child = spawn(service.command, service.args, {
      cwd: service.cwd,
      shell: isWindows,
      env: { ...process.env, FORCE_COLOR: '1' }
    });

    this.activeProcesses.set(serviceId, child);

    child.stdout.on('data', data => {
      const text = data.toString();
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.trim()) this._addLog(service, line.trimEnd());
      }
    });

    child.stderr.on('data', data => {
      const text = data.toString();
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.trim()) this._addLog(service, `[stderr] ${line.trimEnd()}`);
      }
    });

    child.on('close', code => {
      const durationMs = Date.now() - startTime;
      service.state = code === 0 ? 'idle' : 'error';
      service.lastRunFinishedAt = new Date().toISOString();
      service.lastExitCode = code;
      service.lastDurationMs = durationMs;
      this.activeProcesses.delete(service.id);

      this._persistServiceStatus(service, code);

      this._addLog(service, `[Command Center] Execution finished with exit code ${code} (Duration: ${(durationMs / 1000).toFixed(1)}s)`);
    });

    child.on('error', err => {
      service.state = 'error';
      service.lastExitCode = -1;
      this.activeProcesses.delete(service.id);
      this._addLog(service, `[Command Center] Process failed to spawn: ${err.message}`);
    });

    this.activeProcesses.set(service.id, child);

    return {
      success: true,
      serviceId: service.id,
      name: service.name,
      state: 'running',
      startedAt: service.lastRunStartedAt
    };
  }

  stopService(serviceId) {
    const service = this._resolveService(serviceId);
    if (!service) {
      return { success: false, error: `Service '${serviceId}' not found.` };
    }

    const child = this.activeProcesses.get(service.id);
    if (!child) {
      return { success: false, error: `Service '${service.name}' is not currently running.` };
    }

    try {
      child.kill('SIGTERM');
      this._addLog(service, `[Command Center] Termination signal sent by user.`);
      service.state = 'idle';
      this.activeProcesses.delete(service.id);
      return { success: true, message: `Terminated service '${service.name}' successfully.` };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  _addLog(service, line) {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `[${timestamp}] ${line}`;
    service.logs.push(formatted);
    if (service.logs.length > 250) {
      service.logs.shift();
    }
  }
}

module.exports = new FleetManager();

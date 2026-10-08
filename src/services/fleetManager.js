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
      'triplej-weekly': {
        id: 'triplej-weekly',
        name: 'Triple J Broadcasts',
        description: 'ABC Radio live broadcast rotations filtered to new Australian releases',
        market: 'WEEKLY',
        schedule: 'Friday at 12:00 PM',
        command: 'node',
        args: ['src/index.js', 'configs/triplej_indie.json'],
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
      }
    };

    this.activeProcesses = new Map();
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

  getServiceLogs(serviceId) {
    const service = this.services[serviceId];
    if (!service) return { error: `Service '${serviceId}' not found.` };
    return {
      serviceId,
      name: service.name,
      state: service.state,
      logs: service.logs
    };
  }

  triggerService(serviceId) {
    const service = this.services[serviceId];
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
      this.activeProcesses.delete(serviceId);

      this._addLog(service, `[Command Center] Execution finished with exit code ${code} (Duration: ${(durationMs / 1000).toFixed(1)}s)`);
    });

    child.on('error', err => {
      service.state = 'error';
      service.lastExitCode = -1;
      this.activeProcesses.delete(serviceId);
      this._addLog(service, `[Command Center] Process failed to spawn: ${err.message}`);
    });

    return {
      success: true,
      serviceId,
      name: service.name,
      state: 'running',
      startedAt: service.lastRunStartedAt
    };
  }

  stopService(serviceId) {
    const child = this.activeProcesses.get(serviceId);
    if (!child) {
      return { success: false, error: `Service '${serviceId}' is not currently running.` };
    }

    try {
      child.kill('SIGTERM');
      const service = this.services[serviceId];
      if (service) {
        this._addLog(service, `[Command Center] Termination signal sent by user.`);
        service.state = 'idle';
      }
      this.activeProcesses.delete(serviceId);
      return { success: true, message: `Terminated service '${serviceId}' successfully.` };
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

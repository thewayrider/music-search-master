const path = require('path');
const fs = require('fs');
const fleetManager = require('./fleetManager');

// Optional load of node-cron if installed, but fully functional with zero dependencies
let cronLib = null;
try {
  cronLib = require('node-cron');
} catch (_) {
  // Gracefully operate with native built-in Node timer loop
}

const DAY_MAP = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6
};

class FleetScheduler {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '../../');
    this.schedulesConfigPath = path.join(this.projectRoot, 'configs/schedules.json');
    this.activeTasks = new Map(); // id -> job definition
    this.cronTasks = new Map();   // id -> node-cron instance if used
    this.timerInterval = null;
    this.initialized = false;
  }

  /**
   * Parses time ("09:00AM", "04:00PM", "14:00") into hour, minute, and cron string
   */
  parseTime(timeStr, daysArray) {
    if (!timeStr) return null;
    const clean = String(timeStr).trim().toUpperCase();
    const match = clean.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);
    if (!match) return null;

    let hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    const period = match[3];

    if (period === 'PM' && hour < 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;

    let dayNums = null;
    let dayExpr = '*';
    if (Array.isArray(daysArray) && daysArray.length > 0) {
      const nums = daysArray
        .map(d => DAY_MAP[String(d).toLowerCase().trim()])
        .filter(n => n !== undefined);
      if (nums.length > 0) {
        dayNums = [...new Set(nums)].sort();
        dayExpr = dayNums.join(',');
      }
    }

    return {
      hour,
      minute,
      days: dayNums, // Array of day numbers 0-6 or null (all days)
      cron: `${minute} ${hour} * * ${dayExpr}`
    };
  }

  /**
   * Initializes all scheduled jobs
   */
  init() {
    if (this.initialized) {
      this.reload();
      return;
    }

    const engineName = cronLib ? 'node-cron + Native Watchdog' : 'Zero-Dependency Native Timer Engine';
    console.log(`[Scheduler] Initializing In-Process Fleet Scheduler (${engineName})...`);

    this._loadAndRegisterAll();
    this._startNativeTickLoop();
    this.initialized = true;
  }

  /**
   * Stops existing tasks and re-registers from configuration files
   */
  reload() {
    console.log('[Scheduler] Reloading schedules from configuration...');
    this._stopAllTasks();
    this._loadAndRegisterAll();
    console.log(`[Scheduler] Reload complete. ${this.activeTasks.size} active jobs scheduled.`);
  }

  _loadAndRegisterAll() {
    // 1. Daily Radars (06:30 AM Global, 07:00 AM US)
    const dailyRadars = [
      {
        id: 'global-radar',
        serviceId: 'global-radar',
        name: 'New Indie Live 24 — Global Daily Radar',
        description: 'Daily multi-channel 24h open-web discovery briefing',
        hour: 6,
        minute: 30,
        days: null, // Every day
        cron: '30 6 * * *',
        humanSchedule: 'Daily at 06:30 AM'
      },
      {
        id: 'us-radar',
        serviceId: 'us-radar',
        name: 'New Indie Live 24 — US Edition Daily Radar',
        description: 'Daily US indie rock tastemaker briefing',
        hour: 7,
        minute: 0,
        days: null, // Every day
        cron: '0 7 * * *',
        humanSchedule: 'Daily at 07:00 AM'
      }
    ];

    const radarConfigPath = path.join(this.projectRoot, 'configs/radar_config.json');
    let radarConfig = {};
    if (fs.existsSync(radarConfigPath)) {
      try { radarConfig = JSON.parse(fs.readFileSync(radarConfigPath, 'utf8')); } catch (_) {}
    }

    for (const radar of dailyRadars) {
      if (radar.id === 'global-radar' && radarConfig.globalRadarEnabled === false) {
        console.log(`[Scheduler] ⏸️  Global Daily Radar is paused in configs/radar_config.json. Skipping schedule.`);
        continue;
      }
      if (radar.id === 'us-radar' && radarConfig.usRadarEnabled === false) {
        console.log(`[Scheduler] ⏸️  US Daily Radar is paused in configs/radar_config.json. Skipping schedule.`);
        continue;
      }
      this._registerJob(radar);
    }

    // 2. Weekly Crawlers from configs/schedules.json
    if (!fs.existsSync(this.schedulesConfigPath)) {
      console.warn(`[Scheduler] Warning: schedules.json not found at ${this.schedulesConfigPath}`);
      return;
    }

    try {
      const raw = fs.readFileSync(this.schedulesConfigPath, 'utf8');
      const crawlerSchedules = JSON.parse(raw);

      for (const item of crawlerSchedules) {
        const parsed = this.parseTime(item.time, item.days);
        if (!parsed) {
          console.warn(`[Scheduler] Could not parse schedule time for '${item.id}'. Skipping.`);
          continue;
        }

        const humanDays = Array.isArray(item.days) ? item.days.join(', ') : 'Weekly';
        const humanSchedule = `${humanDays} at ${item.time}`;

        this._registerJob({
          id: item.id,
          serviceId: item.id,
          name: item.name || item.id,
          description: item.description || '',
          hour: parsed.hour,
          minute: parsed.minute,
          days: parsed.days,
          cron: parsed.cron,
          humanSchedule
        });
      }
    } catch (err) {
      console.error(`[Scheduler] Failed to parse ${this.schedulesConfigPath}:`, err.message);
    }
  }

  _registerJob(job) {
    const jobEntry = {
      ...job,
      registeredAt: new Date().toISOString(),
      lastRunMinuteKey: null,
      lastTriggeredAt: null
    };

    // If node-cron is installed, also attach a cron task listener
    if (cronLib && cronLib.validate(job.cron)) {
      try {
        const task = cronLib.schedule(job.cron, () => {
          this._executeJob(jobEntry, 'node-cron');
        });
        this.cronTasks.set(job.id, task);
      } catch (_) {}
    }

    this.activeTasks.set(job.id, jobEntry);
    console.log(`  [+] Scheduled: ${job.name} -> [${job.cron}] (${job.humanSchedule})`);
  }

  /**
   * Internal execution handler with overlap and per-minute deduplication
   */
  _executeJob(job, triggerSource = 'timer') {
    const now = new Date();
    const minuteKey = `${now.toDateString()}_${now.getHours()}:${now.getMinutes()}`;

    // Prevent double-firing within the same minute
    if (job.lastRunMinuteKey === minuteKey) {
      return;
    }

    job.lastRunMinuteKey = minuteKey;
    job.lastTriggeredAt = now.toISOString();

    const nowStr = now.toLocaleTimeString();
    console.log(`\n[Scheduler] ⏰ [${nowStr}] Triggering scheduled job (${triggerSource}): ${job.name} (${job.id})...`);

    try {
      const result = fleetManager.triggerService(job.serviceId);
      if (!result.success) {
        console.warn(`[Scheduler] Note: Could not trigger ${job.id}: ${result.error}`);
      }
    } catch (err) {
      console.error(`[Scheduler] Error executing scheduled job ${job.id}:`, err.message);
    }
  }

  /**
   * Zero-dependency native tick loop: checks every 20 seconds
   * Guarantees accurate triggers even without any external packages installed.
   */
  _startNativeTickLoop() {
    if (this.timerInterval) clearInterval(this.timerInterval);

    this.timerInterval = setInterval(() => {
      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      const currentDay = now.getDay();

      for (const job of this.activeTasks.values()) {
        const dayMatch = !job.days || job.days.length === 0 || job.days.includes(currentDay);
        const timeMatch = job.hour === currentHour && job.minute === currentMinute;

        if (dayMatch && timeMatch) {
          this._executeJob(job, 'native-timer');
        }
      }
    }, 20000); // Check every 20 seconds
  }

  _stopAllTasks() {
    for (const task of this.cronTasks.values()) {
      try {
        task.stop();
      } catch (_) {}
    }
    this.cronTasks.clear();
    this.activeTasks.clear();
  }

  /**
   * Returns metadata and active state of all scheduled jobs
   */
  getScheduleStatus() {
    const list = [];
    for (const [id, job] of this.activeTasks.entries()) {
      const service = fleetManager._resolveService(job.serviceId);
      list.push({
        id,
        name: job.name,
        description: job.description,
        cronExpression: job.cron,
        humanSchedule: job.humanSchedule,
        serviceId: job.serviceId,
        currentState: service ? service.state : 'idle',
        lastTriggeredAt: job.lastTriggeredAt,
        lastRunStartedAt: service ? service.lastRunStartedAt : null,
        lastRunFinishedAt: service ? service.lastRunFinishedAt : null,
        lastExitCode: service ? service.lastExitCode : null
      });
    }
    return list;
  }

  /**
   * Stops all cron tasks and timers on server shutdown
   */
  stopAll() {
    console.log('[Scheduler] Stopping in-process scheduler timers...');
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this._stopAllTasks();
  }
}

module.exports = new FleetScheduler();

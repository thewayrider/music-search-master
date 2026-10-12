const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
const fleetManager = require('./fleetManager');

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
    this.activeTasks = new Map(); // id -> { task, meta }
    this.initialized = false;
  }

  /**
   * Translates human time ("09:00AM", "04:00PM", "14:00") and days array into cron syntax
   */
  parseToCron(timeStr, daysArray) {
    if (!timeStr) return null;
    const clean = String(timeStr).trim().toUpperCase();
    const match = clean.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);
    if (!match) return null;

    let hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    const period = match[3];

    if (period === 'PM' && hour < 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;

    let dayExpr = '*';
    if (Array.isArray(daysArray) && daysArray.length > 0) {
      const nums = daysArray
        .map(d => DAY_MAP[String(d).toLowerCase().trim()])
        .filter(n => n !== undefined);
      if (nums.length > 0) {
        dayExpr = [...new Set(nums)].sort().join(',');
      }
    }

    return `${minute} ${hour} * * ${dayExpr}`;
  }

  /**
   * Initializes all scheduled jobs
   */
  init() {
    if (this.initialized) {
      this.reload();
      return;
    }

    console.log('[Scheduler] Initializing Integrated In-Process Fleet Scheduler...');
    this._loadAndRegisterAll();
    this.initialized = true;
  }

  /**
   * Stops existing tasks and re-registers from configuration files
   */
  reload() {
    console.log('[Scheduler] Reloading schedules from configuration...');
    for (const [id, entry] of this.activeTasks.entries()) {
      try {
        entry.task.stop();
      } catch (e) {
        // ignore
      }
    }
    this.activeTasks.clear();
    this._loadAndRegisterAll();
    console.log(`[Scheduler] Reload complete. ${this.activeTasks.size} active cron jobs scheduled.`);
  }

  _loadAndRegisterAll() {
    // 1. Daily Radars (Always Scheduled)
    const dailyRadars = [
      {
        id: 'global-radar',
        serviceId: 'global-radar',
        name: 'New Indie Live 24 — Global Daily Radar',
        description: 'Daily multi-channel 24h open-web discovery briefing',
        cron: '30 6 * * *', // 06:30 AM every day
        humanSchedule: 'Daily at 06:30 AM'
      },
      {
        id: 'us-radar',
        serviceId: 'us-radar',
        name: 'New Indie Live 24 — US Edition Daily Radar',
        description: 'Daily US indie rock tastemaker briefing',
        cron: '0 7 * * *', // 07:00 AM every day
        humanSchedule: 'Daily at 07:00 AM'
      }
    ];

    for (const radar of dailyRadars) {
      this._registerCronJob(radar);
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
        const cronExpr = this.parseToCron(item.time, item.days);
        if (!cronExpr || !cron.validate(cronExpr)) {
          console.warn(`[Scheduler] Invalid cron expression '${cronExpr}' for crawler '${item.id}'. Skipping.`);
          continue;
        }

        const humanDays = Array.isArray(item.days) ? item.days.join(', ') : 'Weekly';
        const humanSchedule = `${humanDays} at ${item.time}`;

        this._registerCronJob({
          id: item.id,
          serviceId: item.id,
          name: item.name || item.id,
          description: item.description || '',
          cron: cronExpr,
          humanSchedule
        });
      }
    } catch (err) {
      console.error(`[Scheduler] Failed to parse ${this.schedulesConfigPath}:`, err.message);
    }
  }

  _registerCronJob(meta) {
    if (!cron.validate(meta.cron)) {
      console.warn(`[Scheduler] Validation error for cron '${meta.cron}' (${meta.id})`);
      return;
    }

    const task = cron.schedule(meta.cron, async () => {
      const nowStr = new Date().toLocaleTimeString();
      console.log(`\n[Scheduler] ⏰ [${nowStr}] Triggering scheduled job: ${meta.name} (${meta.id})...`);
      try {
        const result = fleetManager.triggerService(meta.serviceId);
        if (!result.success) {
          console.warn(`[Scheduler] Note: Could not trigger ${meta.id}: ${result.error}`);
        }
      } catch (err) {
        console.error(`[Scheduler] Error executing scheduled job ${meta.id}:`, err.message);
      }
    });

    this.activeTasks.set(meta.id, {
      task,
      meta: {
        ...meta,
        registeredAt: new Date().toISOString(),
        lastRunAt: null
      }
    });

    console.log(`  [+] Scheduled: ${meta.name} -> [${meta.cron}] (${meta.humanSchedule})`);
  }

  /**
   * Returns metadata and active state of all scheduled jobs
   */
  getScheduleStatus() {
    const list = [];
    for (const [id, entry] of this.activeTasks.entries()) {
      const service = fleetManager._resolveService(entry.meta.serviceId);
      list.push({
        id,
        name: entry.meta.name,
        description: entry.meta.description,
        cronExpression: entry.meta.cron,
        humanSchedule: entry.meta.humanSchedule,
        serviceId: entry.meta.serviceId,
        currentState: service ? service.state : 'idle',
        lastRunStartedAt: service ? service.lastRunStartedAt : null,
        lastRunFinishedAt: service ? service.lastRunFinishedAt : null,
        lastExitCode: service ? service.lastExitCode : null
      });
    }
    return list;
  }

  /**
   * Stops all cron tasks on server shutdown
   */
  stopAll() {
    console.log('[Scheduler] Stopping all in-process cron jobs...');
    for (const [id, entry] of this.activeTasks.entries()) {
      try {
        entry.task.stop();
      } catch (e) {
        // ignore
      }
    }
    this.activeTasks.clear();
  }
}

module.exports = new FleetScheduler();

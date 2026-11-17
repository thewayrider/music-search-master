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

const WEEKDAY_SHORT_MAP = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

const DEFAULT_TIMEZONE = 'Asia/Kuala_Lumpur';
const CATCHUP_LOOKBACK_DAYS = 7;

class FleetScheduler {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '../../');
    this.schedulesConfigPath = path.join(this.projectRoot, 'configs/schedules.json');
    this.radarConfigPath = path.join(this.projectRoot, 'configs/radar_config.json');
    this.stateFilePath = path.join(this.projectRoot, 'saved_searches/scheduler_state.json');
    this.timeZone = DEFAULT_TIMEZONE;
    this.activeTasks = new Map(); // id -> job definition
    this.cronTasks = new Map();   // id -> node-cron instance if used
    this.catchUpQueue = [];       // [{ job, slotMs }]
    this.timerInterval = null;
    this.initialized = false;
    this.state = null;
  }

  /**
   * Returns wall-clock date/time components in `timeZone`
   */
  getZonedParts(date, timeZone = this.timeZone) {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    });
    const raw = {};
    for (const part of fmt.formatToParts(date)) {
      if (part.type !== 'literal') raw[part.type] = part.value;
    }
    return {
      year: parseInt(raw.year, 10),
      month: parseInt(raw.month, 10),
      day: parseInt(raw.day, 10),
      weekdayNum: WEEKDAY_SHORT_MAP[raw.weekday],
      hour: parseInt(raw.hour, 10) % 24,
      minute: parseInt(raw.minute, 10),
      second: parseInt(raw.second, 10)
    };
  }

  /**
   * Converts wall-clock date/time in `timeZone` to exact UTC epoch ms
   */
  zonedTimeToUtcMs(year, month, day, hour, minute, timeZone = this.timeZone) {
    const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    const parts = this.getZonedParts(new Date(utcGuess), timeZone);
    const zonedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
    return utcGuess - (zonedAsUtc - utcGuess);
  }

  /**
   * Formats a timestamp cleanly in the active schedule timezone
   */
  formatZonedTimestamp(ms) {
    const p = this.getZonedParts(new Date(ms), this.timeZone);
    const pad = (n) => String(n).padStart(2, '0');
    return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)} (${this.timeZone})`;
  }

  /**
   * Finds the most recent scheduled epoch ms <= `nowMs` within the last 7 days
   */
  getLastScheduledSlotMs(job, nowMs = Date.now()) {
    for (let offsetDays = 0; offsetDays <= CATCHUP_LOOKBACK_DAYS; offsetDays++) {
      const probe = new Date(nowMs - offsetDays * 24 * 60 * 60 * 1000);
      const p = this.getZonedParts(probe, this.timeZone);
      const dayMatch = !job.days || job.days.length === 0 || job.days.includes(p.weekdayNum);
      if (!dayMatch) continue;

      const slotMs = this.zonedTimeToUtcMs(p.year, p.month, p.day, job.hour, job.minute, this.timeZone);
      if (slotMs <= nowMs) {
        return slotMs;
      }
    }
    return null;
  }

  _loadOrInitState(nowMs = Date.now()) {
    if (fs.existsSync(this.stateFilePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.stateFilePath, 'utf8'));
        if (parsed && typeof parsed === 'object' && parsed.jobs) {
          return parsed;
        }
      } catch (_) {}
    }

    // First-time init: anchor baseline to today's 00:00 in schedule timezone
    // so missed morning runs from today catch up immediately without flooding prior weeks.
    const p = this.getZonedParts(new Date(nowMs), this.timeZone);
    const todayMidnightMs = this.zonedTimeToUtcMs(p.year, p.month, p.day, 0, 0, this.timeZone);
    const initialState = {
      initializedAtMs: todayMidnightMs,
      initializedAt: new Date(todayMidnightMs).toISOString(),
      timezone: this.timeZone,
      jobs: {}
    };
    this._saveState(initialState);
    return initialState;
  }

  _saveState(stateObj = this.state) {
    if (!stateObj) return;
    try {
      fs.mkdirSync(path.dirname(this.stateFilePath), { recursive: true });
      fs.writeFileSync(this.stateFilePath, JSON.stringify(stateObj, null, 2));
    } catch (err) {
      console.warn('[Scheduler] Warning saving scheduler state:', err.message);
    }
  }

  _recordHandledSlot(jobId, slotMs, triggerSource) {
    if (!this.state) this.state = this._loadOrInitState();
    const prev = this.state.jobs[jobId]?.lastHandledSlotMs || 0;
    const effectiveSlot = Math.max(prev, slotMs || 0);
    this.state.jobs[jobId] = {
      lastHandledSlotMs: effectiveSlot,
      lastHandledSlotLocal: effectiveSlot ? this.formatZonedTimestamp(effectiveSlot) : null,
      lastTriggeredAt: new Date().toISOString(),
      triggerSource
    };
    this._saveState();
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
   * Initializes all scheduled jobs and triggers missed-run catch-up check
   */
  init() {
    if (this.initialized) {
      this.reload();
      return;
    }

    const engineName = cronLib ? 'node-cron + Native Watchdog' : 'Zero-Dependency Native Timer Engine';
    console.log(`[Scheduler] Initializing In-Process Fleet Scheduler (${engineName})...`);

    this._loadAndRegisterAll();
    this.state = this._loadOrInitState();
    this.checkMissedRuns();
    this._drainCatchUpQueue();
    this._startNativeTickLoop();
    this.initialized = true;
  }

  /**
   * Stops existing tasks and re-registers from configuration files
   */
  reload() {
    console.log('[Scheduler] Reloading schedules from configuration...');
    this._stopAllTasks();
    this.catchUpQueue = [];
    this._loadAndRegisterAll();
    this.state = this._loadOrInitState();
    this.checkMissedRuns();
    this._drainCatchUpQueue();
    console.log(`[Scheduler] Reload complete. ${this.activeTasks.size} active jobs scheduled (${this.timeZone}).`);
  }

  _loadAndRegisterAll() {
    let radarConfig = {};
    if (fs.existsSync(this.radarConfigPath)) {
      try { radarConfig = JSON.parse(fs.readFileSync(this.radarConfigPath, 'utf8')); } catch (_) {}
    }

    this.timeZone = radarConfig.scheduleTimezone || DEFAULT_TIMEZONE;
    console.log(`[Scheduler] Schedule Timezone: ${this.timeZone}`);

    // 1. Daily Radars (08:00 AM Global, 08:15 AM US in Malaysia Time)
    const dailyRadars = [
      {
        id: 'global-radar',
        serviceId: 'global-radar',
        name: 'New Indie Live 24 — Global Daily Radar',
        description: 'Daily multi-channel 24h open-web discovery briefing',
        hour: 8,
        minute: 0,
        days: null,
        cron: '0 8 * * *',
        humanSchedule: 'Daily at 08:00 AM MYT'
      },
      {
        id: 'us-radar',
        serviceId: 'us-radar',
        name: 'New Indie Live 24 — US Edition Daily Radar',
        description: 'Daily US indie rock tastemaker briefing',
        hour: 8,
        minute: 15,
        days: null,
        cron: '15 8 * * *',
        humanSchedule: 'Daily at 08:15 AM MYT'
      }
    ];

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
        const humanSchedule = `${humanDays} at ${item.time} MYT`;

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

    if (cronLib && cronLib.validate(job.cron)) {
      try {
        const task = cronLib.schedule(
          job.cron,
          () => {
            this._executeJob(jobEntry, 'node-cron');
          },
          { timezone: this.timeZone }
        );
        this.cronTasks.set(job.id, task);
      } catch (_) {}
    }

    this.activeTasks.set(job.id, jobEntry);
    console.log(`  [+] Scheduled: ${job.name} -> [${job.cron}] (${job.humanSchedule})`);
  }

  /**
   * Queues any jobs whose most recent scheduled slot passed while laptop/VM was off or asleep.
   */
  checkMissedRuns(nowMs = Date.now()) {
    if (!this.state) this.state = this._loadOrInitState(nowMs);
    const lookbackFloor = nowMs - CATCHUP_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
    const floorMs = Math.max(this.state.initializedAtMs || 0, lookbackFloor);

    let queuedNow = 0;
    for (const job of this.activeTasks.values()) {
      const lastSlotMs = this.getLastScheduledSlotMs(job, nowMs);
      if (!lastSlotMs || lastSlotMs < floorMs) continue;

      const handledMs = this.state.jobs[job.id]?.lastHandledSlotMs || 0;
      if (lastSlotMs <= handledMs) continue;

      const alreadyQueued = this.catchUpQueue.some(q => q.job.id === job.id);
      const service = fleetManager._resolveService(job.serviceId);
      const isRunning = service && service.state === 'running';
      if (alreadyQueued || isRunning) continue;

      this.catchUpQueue.push({ job, slotMs: lastSlotMs });
      queuedNow++;
      console.log(`[Scheduler] 🕒 Missed run queued for catch-up: ${job.name} (scheduled ${this.formatZonedTimestamp(lastSlotMs)})`);
    }

    if (queuedNow > 0) {
      // Oldest missed slot first
      this.catchUpQueue.sort((a, b) => a.slotMs - b.slotMs);
    }
    return queuedNow;
  }

  /**
   * Runs queued missed jobs one at a time so crawlers don't collide on boot/wake.
   */
  _drainCatchUpQueue() {
    if (this.catchUpQueue.length === 0) return;
    if (fleetManager.activeProcesses.size > 0) return;

    const next = this.catchUpQueue.shift();
    if (!next) return;

    const { job, slotMs } = next;
    console.log(`\n[Scheduler] 🔄 Catching up missed run: ${job.name} (${this.formatZonedTimestamp(slotMs)})...`);
    job.lastTriggeredAt = new Date().toISOString();
    this._recordHandledSlot(job.id, slotMs, 'catchup');

    try {
      const result = fleetManager.triggerService(job.serviceId);
      if (!result.success) {
        console.warn(`[Scheduler] Catch-up trigger note for ${job.id}: ${result.error}`);
      }
    } catch (err) {
      console.error(`[Scheduler] Error during catch-up for ${job.id}:`, err.message);
    }
  }

  /**
   * Internal execution handler with overlap and per-minute deduplication
   */
  _executeJob(job, triggerSource = 'timer') {
    const now = new Date();
    const p = this.getZonedParts(now, this.timeZone);
    const minuteKey = `${p.year}-${p.month}-${p.day}_${p.hour}:${p.minute}`;

    if (job.lastRunMinuteKey === minuteKey) {
      return;
    }

    job.lastRunMinuteKey = minuteKey;
    job.lastTriggeredAt = now.toISOString();

    // Remove from catch-up queue if it was waiting and mark slot handled
    this.catchUpQueue = this.catchUpQueue.filter(q => q.job.id !== job.id);
    const slotMs = this.getLastScheduledSlotMs(job, now.getTime());
    if (slotMs) {
      this._recordHandledSlot(job.id, slotMs, triggerSource);
    }

    console.log(`\n[Scheduler] ⏰ [${this.formatZonedTimestamp(now.getTime())}] Triggering scheduled job (${triggerSource}): ${job.name} (${job.id})...`);

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
   * Zero-dependency native tick loop: checks every 20 seconds in target timezone,
   * detects sleep/wake gaps, and drains the sequential catch-up queue.
   */
  _startNativeTickLoop() {
    if (this.timerInterval) clearInterval(this.timerInterval);

    this.timerInterval = setInterval(() => {
      const now = new Date();
      const p = this.getZonedParts(now, this.timeZone);

      for (const job of this.activeTasks.values()) {
        const dayMatch = !job.days || job.days.length === 0 || job.days.includes(p.weekdayNum);
        const timeMatch = job.hour === p.hour && job.minute === p.minute;

        if (dayMatch && timeMatch) {
          this._executeJob(job, 'native-timer');
        }
      }

      // Detect any missed runs after laptop sleep/wake and drain queue 1 at a time
      this.checkMissedRuns(now.getTime());
      this._drainCatchUpQueue();
    }, 20000);
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
      const handled = this.state?.jobs?.[id];
      list.push({
        id,
        name: job.name,
        description: job.description,
        cronExpression: job.cron,
        timezone: this.timeZone,
        humanSchedule: job.humanSchedule,
        serviceId: job.serviceId,
        currentState: service ? service.state : 'idle',
        queuedForCatchUp: this.catchUpQueue.some(q => q.job.id === id),
        lastHandledSlotLocal: handled?.lastHandledSlotLocal || null,
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

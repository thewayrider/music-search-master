# MUSIC SEARCH MASTER — UNIFIED FLEET ARCHITECTURE & OPERATING GUIDELINES

This document serves as the permanent system architecture reference, discovery rulebook, and operational guidelines for **`music-search-master`**.

---

## 1. Unified Project Mission & Structure

`music-search-master` is the unified single-repository codebase combining:
1. **The 24/7 Rapid Response Radars** (Global & US Edition) — daily 36-hour release detection at 06:30 and 07:00 AM (includes Under the Radar Magazine).
2. **The 12 Weekly Tastemaker Crawlers** (Bandcamp, AMRAP, Triple J Unearthed, ListenBrainz, MusicBrainz, Deezer, Futuremag, Roots Mag, Air Charts, Nialler9, New Releases Now).
3. **The Unified Fleet Command Center** — Express REST API daemon (Port 4000) and dedicated standalone App-Mode window.
4. **The Master SQLite Brain** (`data/master_catalog.sqlite`) — single shared database for all sightings and Tastemaker Heat consensus tracking.

### Project Layout
```text
music-search-master/
├── configs/                       # All crawler configurations, exclusions, and schedules
│   ├── schedules.json             # 14 automated tasks definitions
│   ├── exclusions.json            # Keyword exclusions
│   └── secrets.json               # Email & API credentials (ignored by git)
├── data/
│   └── master_catalog.sqlite      # Shared native SQLite catalog (ignored by git)
├── public/                        # Fleet Command Center dark-mode web dashboard
│   ├── index.html
│   ├── app.js
│   └── style.css
├── saved_searches/                # Historical run archives & JSON reports
├── src/
│   ├── index.js                   # Unified CLI entrypoint for all radars & crawlers
│   ├── server.js                  # Command Center Express server on port 4000
│   ├── crawlers/                  # The 11 weekly crawlers (AMRAP, Bandcamp, MusicBrainz, etc.)
│   ├── radars/                    # 24/7 Global & US radars
│   │   ├── radarEngine.js
│   │   └── usIndieChannel.js
│   ├── services/
│   │   └── fleetManager.js        # Child process manager & live streaming logs
│   └── utils/
│       ├── normalizer.js          # EveryNoise Purity Gate & Title-Casing engine
│       ├── masterDb.js            # Native Node 24 SQLite operations & heat calculation
│       ├── diffEngine.js          # Diff engine with EveryNoise quality gate
│       ├── mailer.js              # HTML editorial briefing mailer
│       ├── aiScraper.js           # Gemini AI extraction utility
│       └── gistSync.js            # Android app GitHub Gist telemetry sync
├── launch_command_center.bat      # Standalone Edge app window (--disable-extensions)
├── run_daily_radar.bat            # 06:30 AM Global Radar runner
├── run_us_radar.bat               # 07:00 AM US Radar runner
├── run_*.bat                      # Individual crawler runners
└── package.json                   # All dependencies in one place
```

---

## 2. EveryNoise "Pure Track" Mandate

All candidate releases across all 13 radars and crawlers must pass through `src/utils/normalizer.js`:
- **Title-Casing & Clean Capitalization**: First character must be capitalized. Rejects all-lowercase bedroom aesthetics (`black cockatoo`, `now youre mine`) and long all-caps screaming titles.
- **Clean Character Whitelist**: Strictly `A-Za-z0-9` and clean punctuation (`'`, `-`, `.`, `,`, `!`, `?`, `&`). Rejects ugly symbols (`_`, `/`, `\`, `|`, `@`, `#`, `~`, `+`, `$`, `%`, `^`, `*`, `{}`, `[]`).
- **Concise Word & Length Caps**: 1–6 words (max 45 chars) for titles; 1–5 words (max 40 chars) for artists.
- **Foreign Language & Stopword Shields**: Automatically blocks French, Spanish, Portuguese, Turkish, and Brazilian funk edits.
- **No Unresolved Parentheticals**: Discards titles with bracketed annotations like `(feat. ...)`, `[Official Video]`, `(Single)`.
- **Channel Quotas**: SoundCloud capped at max 5 tracks per daily run; other channels capped at 8 tracks.

---

## 3. Master SQLite Database (`data/master_catalog.sqlite`)

- Utilizes Node 24 native SQLite (`DatabaseSync`) with WAL mode enabled.
- **Recycled Single Shield**: Blocks tracks first seen $>7$ days ago reappearing on new albums.
- **Consensus Heat Scoring**: Tracks sighted by 2 or more independent channels earn elevated `heat_score` badges.
- **Multi-Device Isolation**: `data/` is strictly ignored by Git to prevent merge conflicts during `git pull`.

---

## 4. Multi-Device Operations (Desktop, Mini PC, Lenovo Googlebook)

- **Desktop PC**: Primary development and testing environment (`C:\Users\kimra\Desktop\Projects\music-search-master`).
- **Always-On Mini PC**: 24/7 host running scheduled tasks (`C:\Antigravity Projects\music-search-master`).
- **Lenovo Googlebook 15**: Mobile development station during travel.
- **Git Protocol**:
  - Author changes on Developer PC $\rightarrow$ `git push origin main`.
  - On Mini PC / Lenovo $\rightarrow$ `git pull origin main`.
  - Database file (`data/master_catalog.sqlite`) is synced between machines via LocalSend.

---

## 5. Execution Commands Quick Reference

```powershell
# CLI Runs
node src/index.js --radar-global           # Run Global 24h Radar
node src/index.js --radar-us               # Run US Edition Radar
node src/index.js --radar-global --dry-run # Global Dry-Run Sandbox
node src/index.js --radar-us --dry-run     # US Dry-Run Sandbox
node src/index.js configs/amrap_indie.json # Run specific weekly crawler
node src/index.js --stats                  # Show master database metrics

# Fleet Command Center
npm run command-center                     # Start API server on port 4000
.\launch_command_center.bat                # 1-click dedicated Edge app window
```

---

## 6. Mini PC Git Sync & Collision Resolution

Because the Always-On Mini PC runs crawlers continuously, local telemetry (`saved_searches/crawler_analytics.json`) and untracked lockfiles (`package-lock.json`) can block `git pull origin main`.

**Standard resolution on Mini PC:**
```powershell
git checkout -- saved_searches/crawler_analytics.json
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue
git pull origin main
```

---

## 7. Windows Task Scheduler Standard (PowerShell 5.1 Native)

Because paths contain spaces (`C:\Antigravity Projects\music-search-master`), `schtasks.exe` quote escaping breaks in Windows PowerShell 5.1. Always use pure PowerShell cmdlets to register tasks on Windows:

```powershell
$action = New-ScheduledTaskAction -Execute 'C:\Antigravity Projects\music-search-master\run_newreleasesnow.bat'
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Saturday -At 09:30AM
Register-ScheduledTask -TaskName 'MusicSearch_NewReleasesNow' -Action $action -Trigger $trigger -Force
```

---

## 8. Upcoming Architecture Roadmap

- **Integrated In-Process Node Scheduler**: Transition from Windows Task Scheduler to an embedded Node scheduler (`node-cron` in `src/server.js`) driven dynamically by `configs/schedules.json`. This will make scheduling 100% self-contained within Git and eliminate OS-level task registration.
- **US Indie Sources Onboarding**: Continue single-site technical audits and integrations.


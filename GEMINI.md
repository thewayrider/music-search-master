# MUSIC SEARCH MASTER — UNIFIED FLEET ARCHITECTURE & OPERATING GUIDELINES

This document serves as the permanent system architecture reference, discovery rulebook, and operational guidelines for **`music-search-master`**.

---

## 1. Unified Project Mission & Structure

`music-search-master` is the unified single-repository codebase combining:
1. **The 24/7 Rapid Response Radars** (Global & US Edition) — daily 36-hour release detection at 06:30 and 07:00 AM (includes Under the Radar Magazine). *Note: Global Radar is paused awaiting Googlebook Linux sandbox migration; US Radar remains active.*
2. **The 12 Weekly Tastemaker Crawlers** (Bandcamp, AMRAP, Triple J Unearthed, ListenBrainz, MusicBrainz, Deezer, Futuremag, Roots Mag, Air Charts, Nialler9, New Releases Now).
3. **The Unified Fleet Command Center** — Express REST API daemon (Port 4000) and dedicated standalone App-Mode window.
4. **The Master SQLite Brain** (`data/master_catalog.sqlite`) — single shared database for all sightings and Tastemaker Heat consensus tracking.

### Project Layout
```text
music-search-master/
├── configs/                       # All crawler configurations, exclusions, and schedules
│   ├── radar_config.json          # Radar master switches (Global paused / US active)
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
│   │   ├── fleetManager.js        # Child process manager & live streaming logs
│   │   ├── releaseVerifier.js     # Two-Stage Release Verifier engine (Ollama/Gemini)
│   │   └── verificationTools.js   # MusicBrainz, iTunes history & clue inspection tools
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
├── run_verifier.bat               # Interactive Two-Stage Verifier suite runner
├── testVerifier.js                # Standalone verifier test harness (5 test cases)
├── Two-Stage Release Verifier.txt # Plain text user manual
├── run_*.bat                      # Individual crawler runners
└── package.json                   # All dependencies in one place
```

---

## 2. EveryNoise "Pure Track" Mandate

All candidate releases across all 13 radars and crawlers must pass through `src/utils/normalizer.js`:
- **Title-Casing & Clean Capitalization**: First character must be capitalized. Rejects all-lowercase bedroom aesthetics (`black cockatoo`, `now youre mine`), long all-caps screaming titles, and all-caps screaming artist sentences (`I LOVE YOU MY LOVE`).
- **Promotional Spam Filter**: Automatically rejects promotional and aggregation channels ending in `hits` (`/^[a-z]+hits$/i` e.g., `RASELHITS`, `TopHits`).
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
- **Lenovo Googlebook 15**: Mobile development station during travel. Runs a Debian Linux container sandbox with residential IP routing to eliminate datacenter scraping blocks (see [`ARCHITECTURE_SANDBOX_REPORT.md`](ARCHITECTURE_SANDBOX_REPORT.md)).
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

Because the Always-On Mini PC runs crawlers continuously, runtime reports (`dashboard.html`, `saved_searches/dashboard_status.json`, cache files) and telemetry dynamically update on disk. A standard `git pull` will silently abort if these files diverge.

- **Master SQLite Database**: Resides in `data/master_catalog.sqlite` and is strictly ignored by Git. Local DB reads and writes are never affected by Git operations.
- **Secrets Protected**: `configs/secrets.json` is strictly ignored by Git.

**Standard 1-Click Sync Protocol on Mini PC:**
To pull updates without ever getting blocked by crawler-generated reports:
```powershell
git fetch origin main
git reset --hard origin/main
git clean -fd
```
*(This safely aligns the Mini PC to latest `origin/main` and discards ephemeral generated reports without touching `data/` or `configs/secrets.json`).*

---

## 7. Single Auto-Start Daemon on Mini PC (`MusicSearch_FleetCommandCenter_AutoStart`)

Individual crawler and radar tasks in Windows Task Scheduler are **fully obsolete and retired**. The Mini PC relies on a single background task created by `setup_minipc_autostart.ps1`:
- **Task Name**: `MusicSearch_FleetCommandCenter_AutoStart`
- **Action**: Launches `node src/server.js` on user logon.
- **In-Process Control**: All 13 discovery crawlers and daily radars are scheduled and executed entirely in-process by `src/services/scheduler.js`.
- **Operating Rule**: **Never** register, modify, or disable individual crawler tasks in Windows Task Scheduler. All pauses and schedule changes are managed 100% in Git via `configs/radar_config.json` and `configs/schedules.json`. A simple `git pull origin main` on the Mini PC is all that is ever required.

---

## 8. Anti-AI Music Defenses & Open Platform Safeguards

Open platforms (YouTube & SoundCloud search feeds) are heavily targeted by solo AI creators and content farms using Suno, Udio, and generative video tools.

### The "Double Fool You" Misdirection Dynamic
AI farms frequently pair synthetic audio with hyper-stylized female avatars or dramatic cinematic clips (via Sora, Kling, Runway, Flux, Midjourney, Pika) to drive high click-through rates and algorithm recommendations while visually distracting listeners from robotic audio artifacts.

### The DistroKid / `- Topic` / Verified Badge Loophole
- DistroKid, TuneCore, and RouteNote allow unlimited AI music uploads for cheap, automatically creating YouTube `- Topic` channels.
- DistroKid allows accounts with a single distributed song to claim an **Official Artist Channel badge** (`AUDIO_BADGE`). 
- **Rule**: Official Artist Channel badges and `- Topic` channels alone **cannot** be trusted as proof of human music. Auto-generated DistroKid copyright lines (`℗ Records DK`) must be quarantined.

### External Verification Benchmarks
- **Visual AI Artwork & Video Heuristics**: Generative AI releases almost invariably feature AI-generated cover art or video loops (Midjourney plastic sheen, anime/cyberpunk avatars, surreal impossible landscapes, or 3-second repetitive loops via Kling/Runway/Pika/Sora). Stage 2 verifiers evaluate artwork URLs via Gemini Flash Vision for ambiguous candidates.
- **SubmitHub AI Song Checker** (`submithub.com`): Premier free curator benchmark; supports direct SoundCloud/YouTube links and runs dual spectral (8–16 kHz vocoder sheen) and temporal dynamic analysis.
- **Authio / detect.music**: Forensic-grade label detection engine used across European DSPs.

---

## 9. Curated SoundCloud Indie Label Harvester (`src/radars/soundcloudChannel.js`)

To eliminate low-fidelity bedroom noise, raw loops, and AI search spam, the Global Radar no longer queries SoundCloud's public search feed. Instead, it directly monitors **22 premier indie record labels and tastemakers** via [`configs/soundcloud_channels.json`](configs/soundcloud_channels.json):
1. **Prestige Indie Labels**: Sub Pop Records, Domino Recording Co, Rough Trade Records, Merge Records, Captured Tracks, Partisan Records, Secretly Canadian, Jagjaguwar, Polyvinyl Records, Saddle Creek, Bella Union, Heavenly Recordings, Flying Nun Records (NZ), Spinning Top Music (AU), Fire Records, Fat Possum Records, Mute Records, Ghostly International, Mom + Pop Music.
2. **Tastemakers & Sessions**: BIRP! Indie, Gorilla vs. Bear, KEXP Live.
3. **Filtering & Duration Gates**:
   - Enforces strict track duration between **1m 30s and 7m 30s** (drops snippets, loops, and DJ sets).
   - Rejects podcasts, interviews, teasers, reissues, and remasters.
   - Preserves silence (yields 0) if no curated label dropped a release in the last 24–36h.

---

## 10. Curated YouTube Tastemakers & Label RSS Engine (`src/radars/youtubeTastemakers.js`)

To guarantee 100% human-curated releases without relying entirely on noisy open search, the Global Radar incorporates a dedicated, zero-quota RSS monitor reading 21 premier indie institutions ([`configs/youtube_channels.json`](configs/youtube_channels.json)):

- **Live Sessions & Radio**: KEXP Live, Audiotree Live, NPR Music (Tiny Desk), Paste Magazine Live, COLORS Studios.
- **Tastemakers & Curators**: David Dean Burkhart, BIRP! Indie, Nice Guys.
- **Indie Record Labels**: Sub Pop Records, Domino Recording Co, Rough Trade Records, Merge Records, Captured Tracks, Partisan Records, 4AD, Matador Records, Secretly Canadian, Flying Nun Records (NZ), Spinning Top Music (AU), Polyvinyl Records, Saddle Creek.
- **Filtering**: Automatically strips session/video suffixes (`(Live on KEXP)`, `(Official Video)`), parses `"Artist performs Song"` patterns, and drops full concerts, compilations, and playlists.

---

## 11. Western Latin Diacritic Support in Normalizer (`src/utils/normalizer.js`)

`isCleanTrack` allows standard Western Latin diacritics (`\u00C0-\u017F`) in its character whitelist:
- Permitted: Accented indie acts like **The Marías**, **Björk**, **Sigur Rós**.
- Blocked: Cyrillic, South Asian, Arabic, East Asian scripts, and emojis.

---

## 12. Integrated In-Process Node Scheduler (`src/services/scheduler.js`)

The fleet utilizes an embedded in-process scheduler (`node-cron`) initialized directly inside `src/server.js` (Port 4000) that completely eliminates OS-level Windows Task Scheduler dependencies:
- **100% Git-Versioned Schedules**: Driven dynamically by `configs/schedules.json` (weekly crawlers) and hardcoded daily radar rules (Global Radar at 06:30 AM, US Edition at 07:00 AM).
- **Hot-Reloading on API Edit**: When schedules are updated via the Command Center web dashboard (`POST /api/schedule`), `scheduler.reload()` dynamically reschedules in-memory cron timers without restarting the server.
- **Unified Telemetry**: Tasks run through `fleetManager.triggerService(id)` with execution status, durations, exit codes, and live logs streaming to the dashboard.
- **REST Endpoints**:
  - `GET /api/schedules`: Returns all 13 active cron schedules with status and execution metadata.
  - `POST /api/schedules/reload`: Triggers on-demand reload of all cron timers from disk.
- **Legacy Cleanup**: A one-time script `clean_windows_tasks.ps1` safely unregisters the old Windows Task Scheduler entries.

---

## 13. Two-Stage Release Verifier Architecture (`src/services/releaseVerifier.js`)

To prevent non-target acts, back-catalog album cuts, remasters, and anniversary reissues from cluttering the master catalog, the fleet incorporates a hybrid **Two-Stage Release Verifier**:

### Stage 1: Deterministic Fast Sieve (0 MB RAM / Sub-millisecond)
- **Known Regional Channels**: Automatically approves tracks from verified single-region channels (Triple J Unearthed, Triple J, AMRAP, Air Charts, Roots Mag NZ, Nialler9) if published within the release window (default: 14 days).
- **Explicit Catalog/Reissue Quarantine**: Immediately rejects tracks containing `"Remaster"`, `"Anniversary Edition"`, `"Reissue"`, `"Live at"`, or `"Demo 199*"`.
- **Ambiguous Pass-Through**: Routes unverified/open-web items to Stage 2.

### Stage 2: Dual-Safety Verification Loop
- **Primary Tier (Local Ollama)**: Queries `${OLLAMA_BASE_URL}/api/chat` with tool-calling (`qwen2.5:3b`, `num_ctx: 2048`, `keep_alive: -1`, capped at 3 turns).
- **Secondary Tier (Cloud Fallback)**: If Ollama is offline or uninstalled, seamlessly falls back to Gemini Flash (`gemini-flash-latest` via `configs/secrets.json`). Node.js runs tool lookups first, feeding verified ground truth to the model in ~1 second with 0 MB local RAM overhead.
- **Tool Suite (`src/services/verificationTools.js`)**:
  1. `check_musicbrainz_artist`: MusicBrainz API search with strict 1.1-second rate-limiting queue, custom User-Agent, and geographic resolution across AU, NZ, IE, US, and UK (including Indigenous place names: *Naarm, Meanjin, Gadigal, Tāmaki Makaurau*).
  2. `check_itunes_release_history`: iTunes Search API comparison to determine if track has older catalog release dates (>14 days).
  3. `inspect_source_clues`: Demonym scanner and reissue keyword detector.

### Operating & CLI Usage
- **Interactive Menu**: Double-click `run_verifier.bat` to launch the menu suite.
- **CLI Verification on Crawler**: `node src/index.js <config-file> --verify` verifies new candidates before archiving or emailing.
- **Standalone Report Verification**: `node src/index.js --verify <path-to-json-file>`.
- **Unit Test Suite**: `node testVerifier.js` tests 5 mock scenarios across AU, NZ, UK, reissues, and fresh releases.

---

## 14. New Releases Now Crawler Freshness & Reissue Gate (`src/crawlers/newReleasesNowAgent.js`)

New Releases Now (`newreleasesnow.com`) mixes current Friday album drops with historical backlog catalogs (dating back years) and deluxe reissues:
1. **Card-Level Date Parsing**: Always parse the `.release-date` element inside each release card. Never fall back to page-level headers which are absent on genre channels.
2. **Freshness Window Cap**: Enforce `releaseWindowDays: 14` (configured in `configs/newreleasesnow_indie.json`). Drops releases whose card date is $>14$ days old (e.g. dropping 2-year-old albums like Maxïmo Park *Stream Of Life*).
3. **Strict Reissue Quarantine**: Scans artist, title, genre tags, and URL slugs for:
   `\b(reissue|re-issue|remaster|remastered|deluxe|anniversary|expanded|edition|demo(s)?|live\s*at|live\s*from|best\s*of|greatest\s*hits|anthology|collection|box\s*set|soundtrack|ost)\b`
   Blocks catalog reissues (such as Flesh For Lulu *Plastic Fantastic (Deluxe Reissue)*) directly at the scraper stage.
4. **Compilation Filter**: Drops `Various Artists` compilations.

---

## 15. AI Music Farm Detection & The "Multi-Genre Omnivore" Signature

Open radar channels (such as open YouTube and SoundCloud feeds) are targeted by solo AI creators dumping high-volume Suno/Udio tracks. The fleet employs forensic heuristics to quarantine these channels:
1. **The "Multi-Genre Omnivore" Signature**: Channels advertising original music spanning wildly incompatible genres under a single artist alias (e.g., *"powerful rock, cinematic soundscapes, electronic ballads, ambient, pop, and everything in between"* like Northern Music Project). Real human bands do not operate with this sonic profile.
2. **The "Digital Ghost" Discrepancy**: A channel with 10–50 uploads but **0 presence** in MusicBrainz, Discogs, or registered publishing credits.
3. **Automated DistroKid / TuneCore Footprints**: Copyright lines marked `℗ Records DK` or automated `- Topic` accounts with zero human performance credits.

---

## 16. Workspace Triage Skill (`/scraper-check`)

To triage alert emails and audit suspicious discoveries in chat, the workspace includes an automated skill at `.agents/skills/scraper-check/`:
- **Summon in Chat**: Type `/scraper-check` or simply `"scraper check"` followed by pasted email text or track titles.
- **Integrated Audit Capabilities**:
  1. **AI Forensic Detector**: Probes YouTube channel descriptions and video metadata for multi-genre farms, AI keywords (`suno`, `udio`, `midjourney`), and digital ghost footprints.
  2. **Master SQLite Brain Query**: Cross-checks `data/master_catalog.sqlite` for prior sightings, historical channels, and Heat Scores (e.g. identifying prior Fontaines D.C. singles).
  3. **Reissue & Deluxe Filter**: Flags remasters, anniversary editions, and catalog re-releases.
  4. **Earliest Release Year Lookup**: Queries iTunes & MusicBrainz to detect true original release years.

---

## 17. Bandcamp Discover API WAF Bypass & Client Challenge Guard (`src/crawlers/bandcampAgent.js`, `src/radars/bandcampChannel.js`)

Bandcamp's CDN/WAF (Fastly) recently deployed active client challenge interception on `https://bandcamp.com/api/discover/1/discover_web`:
1. **The "Unexpected Token '<'" / "Token Invalid" Failure**: Node 18+ global `fetch` (powered by `undici`) combined with spoofed Chrome User-Agents triggers Fastly's TLS-to-UA fingerprint mismatch rules. Fastly serves a 200 OK interstitial HTML challenge (`<title>Client Challenge</title>`). Calling `.json()` on this response threw `SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON` on every location/genre query loop, causing the crawler to exit with 0 items.
2. **Native HTTPS Engine Solution**: Both `bandcampAgent.js` and `bandcampChannel.js` utilize Node's native `https.request` with client-aligned headers (`User-Agent: curl/8.4.0`). Fastly routes this as standard API client traffic, bypassing the browser challenge entirely and returning 100% valid JSON payloads.
3. **HTML Challenge Guard**: Explicitly inspects incoming payload chunks. If a response begins with `<` (HTML), it rejects immediately with a clear error rather than crashing JSON parsers.





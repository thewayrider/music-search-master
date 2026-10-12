# Two-Stage Release Verifier — User & Fleet Manual

The **Two-Stage Release Verifier** is an autonomous validation pipeline designed to ensure newly discovered tracks are:
1. Originating from target territories: **Australia (AU)**, **New Zealand (NZ)**, or **Ireland (IE)** (also supports **United States (US)** or **GLOBAL** discovery).
2. **Genuine new releases** first published within a 14-day window (filtering out remasters, reissues, anniversary editions, and older album tracks).

---

## How It Works

### Stage 1: Deterministic Fast Sieve (Sub-millisecond / 0 MB RAM)
- Immediately verifies items from single-region channels (**Triple J Unearthed**, **Triple J**, **AMRAP**, **Air Charts**, **Roots Mag NZ**, **Nialler9**) if published within the freshness window.
- Immediately rejects items containing reissue/catalog keywords in title or metadata (`"Remaster"`, `"Anniversary Edition"`, `"Reissue"`, `"Live at"`, `"Demo 199*"`).
- Passes ambiguous items to Stage 2.

### Stage 2: Dual-Safety Agent Verification
- **Priority 1 (Local Ollama):** If Ollama is running at `http://localhost:11434`, it executes a fast tool-calling agent loop (`qwen2.5:3b`, `num_ctx: 2048`, capped at 3 turns).
- **Priority 2 (Cloud Fallback):** If Ollama is offline or uninstalled, it seamlessly falls back to **Gemini Flash** using your existing `configs/secrets.json`. Tools (MusicBrainz & iTunes) run in Node.js first, sending ground truth to the API in ~1s with **0 MB local RAM consumed**.
- **Tool Helpers Used:**
  - **MusicBrainz:** Checks artist origin, including Indigenous places (*Naarm, Meanjin, Gadigal, Tāmaki Makaurau*, etc.) with a 1.1s rate-limiting queue.
  - **iTunes Search:** Checks historical release dates to catch older cuts.
  - **Clue Inspector:** Scans blurbs and URLs for city demonyms and reissue tags.

---

## Practical Ways to Run This

### Method 1: One-Click Interactive Menu (Easiest)
Double-click:
```text
run_verifier.bat
```
This opens an interactive menu that lets you:
1. Run the automated unit test suite (5 mock releases).
2. Verify an existing saved search JSON file.
3. Run the Bandcamp crawler with verification (`--verify`).
4. Run the AMRAP crawler with verification (`--verify`).
5. Run the Air Charts crawler with verification (`--verify`).

---

### Method 2: Command Line (PowerShell / Terminal)

#### 1. Run the Test Suite
```powershell
cd C:\Users\kimra\Desktop\Projects\music-search-master
node testVerifier.js
```

#### 2. Run Any Crawler with the `--verify` Flag
```powershell
node src/index.js configs/bandcamp_indie.json --verify
node src/index.js configs/amrap_indie.json --verify
```
*What happens:* Newly discovered songs are verified before being saved to JSON, HTML reports, the SQLite catalog, or email alerts. Reissues and non-target acts are automatically filtered out.

#### 3. Verify an Existing Saved Search File
```powershell
node src/index.js --verify saved_searches/amrap_indie_discovery/amrap_indie_discovery_base.json
```

---

### Method 3: Automated Scheduling (Mini PC / Task Scheduler)

To enable automatic verification on your scheduled crawlers on the Always-On Mini PC:
Add `--verify` to the crawler command in your batch file (e.g. `run_crawlers.bat`):
```batch
node src/index.js configs/bandcamp_indie.json --verify
```

Because of the dual-safety fallback, the Mini PC will run smoothly whether or not Ollama is running locally.

---

## Configuration & Environment Variables

All settings have sensible defaults and can be customized via environment variables:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Can point to a Tailscale IP (e.g. `http://100.x.y.z:11434`). |
| `OLLAMA_MODEL` | `qwen2.5:3b` | Local model name in Ollama. |
| `RELEASE_WINDOW_DAYS` | `14` | Max age in days for new releases. |

Target regions can be specified in crawler configs or script options:
- `['AU', 'NZ', 'IE']` *(Default: Australia, New Zealand, Ireland)*
- `['US']` *(United States tastemaker scope)*
- `['GLOBAL']` *(Bypasses origin filter; verifies genuine new release only)*

---

## File Map

- **Tool Helpers:** [`src/services/verificationTools.js`](file:///c:/Users/kimra/Desktop/Projects/music-search-master/src/services/verificationTools.js)
- **Verifier Engine:** [`src/services/releaseVerifier.js`](file:///c:/Users/kimra/Desktop/Projects/music-search-master/src/services/releaseVerifier.js)
- **Fleet CLI:** [`src/index.js`](file:///c:/Users/kimra/Desktop/Projects/music-search-master/src/index.js)
- **Interactive Batch File:** [`run_verifier.bat`](file:///c:/Users/kimra/Desktop/Projects/music-search-master/run_verifier.bat)
- **Test Suite:** [`testVerifier.js`](file:///c:/Users/kimra/Desktop/Projects/music-search-master/testVerifier.js)

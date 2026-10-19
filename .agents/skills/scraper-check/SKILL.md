---
name: scraper-check
description: >-
  Triage and inspect music crawler release alerts, detect synthetic / AI music farms (Suno, Udio, multi-genre bot channels),
  check master SQLite catalog sightings, and verify release dates or back-catalog reissues.
  Use whenever the user types "/scraper-check", asks for a "scraper check", pastes release alerts,
  or asks to verify candidate songs or artists.
---

# Scraper Check & AI Release Triage

This skill provides an automated audit suite for candidate tracks discovered by `music-search-master` crawlers and radars.
It performs:
1. **AI & Synthetic Music Detection**: Forensic YouTube channel analysis for multi-genre farms, prompt footprints, extreme upload velocity, and digital absence.
2. **Master SQLite Brain Cross-Check**: Queries `data/master_catalog.sqlite` for prior sightings, historical channels, and Heat Scores.
3. **Reissue & Deluxe Quarantine**: Scans for remasters, anniversary editions, and back-catalog re-releases.
4. **Historical Release Date Lookup**: Queries iTunes / MusicBrainz APIs to determine the true original release year.

## When to Run

* The user types `/scraper-check` or says `"scraper check"`.
* The user pastes an alert email (e.g., `[Music Release Alert...]` or `[New Indie Live 24...]`).
* The user asks to investigate specific artists, songs, or YouTube links.

## Execution Procedure

Run the triage engine via Node.js from the repository root:

```powershell
node .agents/skills/scraper-check/scripts/triage.js "<input-text-or-tracks>"
```

### Supported Input Formats

1. **Pasted Alert Block**:
   ```powershell
   node .agents/skills/scraper-check/scripts/triage.js @"
   Flesh For Lulu - Plastic Fantastic
   Source URL: https://www.newreleasesnow.com/album/flesh-for-lulu-plastic-fantastic-deluxe-reissue
   Maxïmo Park - Stream Of Life
   Source URL: https://www.newreleasesnow.com/album/maxïmo-park-stream-of-life
   "@
   ```

2. **Single Artist / Song / URL**:
   ```powershell
   node .agents/skills/scraper-check/scripts/triage.js "Northern Music Project - The Echo https://www.youtube.com/@NorthernMusicProject"
   ```

## Output Presentation

Present results to the user in a clean table or structured list with clear visual badges:

* ✅ **APPROVED**: Verified fresh release within 14-day window by legitimate human artist.
* ⚠️ **SIGHTED BEFORE**: Artist/track already registered in `master_catalog.sqlite`. Show channel and original sighting date.
* ❌ **REISSUE / DELUXE**: Back-catalog reissue, remaster, or anniversary edition.
* ❌ **STALE**: Original release date is older than 21 days.
* 🚨 **REJECTED - AI / SYNTHETIC**: Multi-genre farm or generative AI audio. Offer to add the artist to `configs/exclusions.json`.

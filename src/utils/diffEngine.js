const fs = require('fs');
const path = require('path');
const { processSongEntry, getMasterStats } = require('./masterDb');
const { parseArtistTitle, isCleanTrack, slugify } = require('./normalizer');

const EXCLUSIONS_FILE = path.join(__dirname, '../../configs/exclusions.json');
let cachedExclusions = { keywords: [] };
try {
    if (fs.existsSync(EXCLUSIONS_FILE)) {
        cachedExclusions = JSON.parse(fs.readFileSync(EXCLUSIONS_FILE, 'utf8'));
    }
} catch (e) {
    // fallback
}

/**
 * Reads all previous JSON files (including base and subsequent runs) 
 * for a specific crawler directory.
 */
function getPreviousReport(savedSearchesDir, currentFilename) {
    if (!fs.existsSync(savedSearchesDir)) return [];

    const files = fs.readdirSync(savedSearchesDir)
        .filter(f => f.endsWith('.json') && f !== currentFilename);

    let allSeenSongs = [];
    
    for (const f of files) {
        try {
            const data = fs.readFileSync(path.join(savedSearchesDir, f), 'utf8');
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed)) {
                allSeenSongs = allSeenSongs.concat(parsed);
            }
        } catch (e) {
            console.error(`Error reading report ${f}:`, e);
        }
    }

    return allSeenSongs;
}

/**
 * Compares current results with previous reports and the central SQLite database.
 * Deduplicates intra-run items, previous local runs, and cross-agent discoveries.
 * Tracks multi-source consensus Heat Scores in the central database without re-alerting duplicates.
 */
function getNewAdditions(currentResults, previousResults = []) {
    if (!Array.isArray(currentResults) || currentResults.length === 0) {
        return [];
    }

    // 1. Index previous local run history
    const urlCounts = new Map();
    previousResults.forEach(item => {
        if (item.url) {
            const cleanUrl = item.url.split('?')[0].replace(/\/$/, "");
            urlCounts.set(cleanUrl, (urlCounts.get(cleanUrl) || 0) + 1);
        }
    });

    const previousKeys = new Set();
    const previousTrackUrls = new Set();
    
    previousResults.forEach(item => {
        if (!item || !item.title) return;
        const slug = slugify(item.title);
        previousKeys.add(item.title.trim().toLowerCase());
        previousKeys.add(slug);
        if (item.channel) {
            previousKeys.add(`${item.channel}::${item.title}`);
            previousKeys.add(`${item.channel}::${slug}`);
        }
        
        if (item.url) {
            const cleanUrl = item.url.split('?')[0].replace(/\/$/, "");
            if (urlCounts.get(cleanUrl) === 1 && !cleanUrl.endsWith('/charts')) {
                previousTrackUrls.add(cleanUrl);
            }
        }
    });

    const newAdditions = [];
    const seenInCurrentRun = new Set();
    let consensusSightingsCount = 0;
    let droppedJunkCount = 0;

    for (const item of currentResults) {
        if (!item || !item.title) continue;

        // 1. EveryNoise Purity Gate: Parse and Validate (Artist - Title)
        const parsed = parseArtistTitle(item.title);
        const artist = item.artist || parsed.artist;
        const title = item.songTitle || parsed.title;

        // Enforce EveryNoise pure track validation
        if (!isCleanTrack(artist, title, cachedExclusions.keywords || [])) {
            droppedJunkCount++;
            continue;
        }

        // Standardize clean title on the item
        item.title = `${artist} - ${title}`;
        item.artist = artist;
        item.songTitle = title;

        const titleSlug = slugify(item.title);
        const exactTitle = item.title.trim().toLowerCase();
        const cleanUrl = item.url ? item.url.split('?')[0].replace(/\/$/, "") : '';

        // Intra-run deduplication: ensure no duplicates within the same batch
        const intraKey = `${titleSlug}|${cleanUrl}`;
        if (seenInCurrentRun.has(titleSlug) || (cleanUrl && seenInCurrentRun.has(cleanUrl))) {
            continue;
        }
        seenInCurrentRun.add(titleSlug);
        if (cleanUrl) seenInCurrentRun.add(cleanUrl);

        // Check local crawler run history
        const isLocalDuplicate = previousKeys.has(exactTitle) ||
                                previousKeys.has(titleSlug) ||
                                (item.channel && previousKeys.has(`${item.channel}::${exactTitle}`)) ||
                                (item.channel && previousKeys.has(`${item.channel}::${titleSlug}`)) ||
                                (cleanUrl && previousTrackUrls.has(cleanUrl));

        // Process against Central SQLite Database
        let dbOutcome = null;
        try {
            dbOutcome = processSongEntry(item, item.channel || "Unknown");
        } catch (dbErr) {
            console.warn(`[Diff Engine] Catalog DB warning:`, dbErr.message);
        }

        if (dbOutcome) {
            // Attach live consensus heat score to item description
            if (dbOutcome.heatScore > 1) {
                const heatTag = `[Heat: ${dbOutcome.heatScore} sources]`;
                if (!item.description.includes('[Heat:')) {
                    item.description = `${heatTag} ${item.description}`;
                }
            }

            if (!isLocalDuplicate && dbOutcome.isNewGlobal) {
                // Brand-new global discovery never seen by ANY agent
                newAdditions.push(item);
            } else if (dbOutcome.isNewSighting) {
                // Multi-source consensus logged in SQLite catalog (does not re-alert as a duplicate song)
                consensusSightingsCount++;
                console.log(`[Tastemaker Heat Logged] "${item.title}" confirmed by ${item.channel || 'new source'} (Heat: ${dbOutcome.heatScore} sources: ${dbOutcome.sources.join(', ')})`);
            }
        } else {
            // Fallback to local-only deduplication if SQLite is unavailable
            if (!isLocalDuplicate) {
                newAdditions.push(item);
            }
        }
    }

    if (droppedJunkCount > 0) {
        console.log(`[EveryNoise Purity Gate] Filtered out ${droppedJunkCount} unclean/bedroom/unresolved/foreign entries.`);
    }

    if (consensusSightingsCount > 0) {
        console.log(`[Diff Engine] Logged ${consensusSightingsCount} cross-agent consensus sighting(s) to SQLite catalog.`);
    }

    return newAdditions;
}

module.exports = {
    getPreviousReport,
    getNewAdditions,
    slugify
};

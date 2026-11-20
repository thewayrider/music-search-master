const fs = require('fs');
const path = require('path');
const { getDatabase } = require('./masterDb');
const { parseArtistTitle } = require('./normalizer');

const SAVED_SEARCHES_DIR = path.resolve(__dirname, '../../saved_searches');

function foldText(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\((?:feat\.?|ft\.?|featuring)[^)]*\)/gi, ' ')
    .replace(/\b(?:feat\.?|ft\.?|featuring)\s+[^-|/]+$/i, ' ')
    .replace(/['’‘"“”]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeArtist(artist) {
  let s = foldText(artist);
  s = s.replace(
    /^(?:(?:adelaide|melbourne|sydney|perth|brisbane|hobart|australian|aussie|local|uk|us|indie|psych)\s+)*(?:favourites?|favorites?|legends?|icons?|veterans?|duo|trio|quartet|band|group)\s+/i,
    ''
  );
  s = s.replace(/^the\s+/, '');
  return s.trim();
}

function normalizeTitle(title, artistHint = '') {
  let raw = String(title || '').trim();
  const parsed = parseArtistTitle(raw);
  if (parsed.artist !== 'Unknown Artist' && parsed.title) {
    if (!artistHint || normalizeArtist(parsed.artist) === normalizeArtist(artistHint)) {
      raw = parsed.title;
    }
  }
  return foldText(raw);
}

function extractArtistAndTitle(item) {
  let artist = item.artist || '';
  let title = item.songTitle || item.title || '';

  if (!artist || !item.songTitle) {
    const parsed = parseArtistTitle(item.title || '');
    if (!artist && parsed.artist !== 'Unknown Artist') artist = parsed.artist;
    if (!item.songTitle && parsed.artist !== 'Unknown Artist' && parsed.title) {
      title = parsed.title;
    }
  }

  return {
    artist: String(artist || '').trim(),
    title: String(title || '').trim(),
    normArtist: normalizeArtist(artist),
    normTitle: normalizeTitle(title, artist),
  };
}

function artistsMatch(a1, a2) {
  if (!a1 || !a2) return false;
  if (a1 === a2) return true;
  const shorter = a1.length <= a2.length ? a1 : a2;
  const longer = a1.length <= a2.length ? a2 : a1;
  if (shorter.length < 5) return false;
  const escaped = shorter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^| )${escaped}(?:$| )`).test(longer);
}

function cleanUrlForDedupe(url) {
  if (!url) return '';
  return String(url).trim().replace(/\/$/, '').toLowerCase();
}

/**
 * Loads previously alerted/cataloged tracks from both master_catalog.sqlite
 * and recent saved_searches JSON archives across all crawlers/radars.
 */
function loadHistoricalTrackIndex(sourceLabel, lookbackDays = 30) {
  const records = [];
  const cutoffMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

  // 1. Master SQLite songs + sightings
  try {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT s.id, s.artist, s.title, s.first_seen_at, s.first_channel, s.heat_score, s.created_at,
             GROUP_CONCAT(sg.channel_name, ' || ') AS channels
      FROM songs s
      LEFT JOIN sightings sg ON sg.song_id = s.id
      GROUP BY s.id
    `).all();

    for (const r of rows) {
      const channels = String(r.channels || r.first_channel || '')
        .split(' || ')
        .map(c => c.trim())
        .filter(Boolean);
      const { normArtist, normTitle } = extractArtistAndTitle({
        artist: r.artist,
        title: r.title,
      });
      if (!normArtist || !normTitle) continue;
      const createdMs = r.created_at ? Date.parse(String(r.created_at).replace(' ', 'T') + 'Z') : 0;
      records.push({
        origin: 'sqlite',
        songId: r.id,
        firstChannel: r.first_channel,
        firstSeenAt: r.first_seen_at,
        createdMs: Number.isFinite(createdMs) ? createdMs : 0,
        channels,
        normArtist,
        normTitle,
      });
    }
  } catch (err) {
    console.warn('[Pre-Email Dedupe] SQLite lookup warning:', err.message);
  }

  // 2. Recent saved_searches JSON files across all agents
  try {
    if (fs.existsSync(SAVED_SEARCHES_DIR)) {
      const entries = fs.readdirSync(SAVED_SEARCHES_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === 'cache') continue;
        const dirPath = path.join(SAVED_SEARCHES_DIR, entry.name);
        const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json'));
        for (const file of files) {
          const fullPath = path.join(dirPath, file);
          let stats;
          try {
            stats = fs.statSync(fullPath);
          } catch (_) {
            continue;
          }
          if (stats.mtimeMs < cutoffMs && !file.includes('_base.json')) continue;

          try {
            const list = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
            if (!Array.isArray(list)) continue;
            for (const item of list) {
              const { normArtist, normTitle } = extractArtistAndTitle(item);
              if (!normArtist || !normTitle) continue;
              records.push({
                origin: 'archive',
                archiveFile: `${entry.name}/${file}`,
                firstChannel: item.channel || entry.name,
                firstSeenAt: item.releaseDate || item.uploadedAt || stats.mtime.toISOString().slice(0, 10),
                channels: [item.channel || entry.name],
                cleanUrl: cleanUrlForDedupe(item.url),
                normArtist,
                normTitle,
              });
            }
          } catch (_) {}
        }
      }
    }
  } catch (err) {
    console.warn('[Pre-Email Dedupe] Archive scan warning:', err.message);
  }

  return records;
}

/**
 * Runs a final cross-crawler + intra-batch fuzzy duplicate check right before
 * emailing and saving a scrape report.
 */
function finalDeduplicateBeforeEmail(candidates = [], options = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { approved: [], dropped: [] };
  }

  const sourceLabel = options.sourceLabel || '';
  const lookbackDays = options.lookbackDays || 30;
  const todayIso = new Date().toISOString().slice(0, 10);
  const history = loadHistoricalTrackIndex(sourceLabel, lookbackDays);

  const approved = [];
  const dropped = [];

  for (const item of candidates) {
    const parsed = extractArtistAndTitle(item);
    const itemUrl = cleanUrlForDedupe(item.url);

    // 1. Check against tracks already approved in this outgoing email batch
    const intraMatch = approved.find(prev => {
      const prevParsed = prev._dedupeMeta;
      if (itemUrl && prevParsed.url && itemUrl === prevParsed.url) return true;
      return (
        parsed.normTitle &&
        parsed.normTitle === prevParsed.normTitle &&
        artistsMatch(parsed.normArtist, prevParsed.normArtist)
      );
    });

    if (intraMatch) {
      dropped.push({
        item,
        reason: `Duplicate within outgoing batch (matches "${intraMatch.artist || intraMatch.title}")`,
      });
      continue;
    }

    // 2. Check against SQLite history & recent saved JSON archives across other crawlers/prior runs
    const histMatch = history.find(rec => {
      const sameTitleAndArtist =
        parsed.normTitle &&
        parsed.normTitle === rec.normTitle &&
        artistsMatch(parsed.normArtist, rec.normArtist);
      const exactTrackUrl = itemUrl && rec.cleanUrl && itemUrl === rec.cleanUrl;
      if (!sameTitleAndArtist && !exactTrackUrl) return false;

      if (rec.origin === 'sqlite') {
        // Ignore only the brand-new single-source row inserted seconds ago in this same run
        const insertedInCurrentRun = rec.createdMs > 0 && (Date.now() - rec.createdMs) <= 120000;
        const onlyThisSourceJustCreated =
          insertedInCurrentRun &&
          rec.channels.length <= 1 &&
          (rec.channels.length === 0 || rec.channels[0] === (item.channel || sourceLabel));
        return !onlyThisSourceJustCreated;
      }

      return true;
    });

    if (histMatch) {
      dropped.push({
        item,
        reason: `Already alerted/cataloged by ${histMatch.firstChannel} (${histMatch.firstSeenAt || histMatch.archiveFile || histMatch.origin})`,
      });
      continue;
    }

    Object.defineProperty(item, '_dedupeMeta', {
      value: { ...parsed, url: itemUrl },
      enumerable: false,
      configurable: true,
    });
    approved.push(item);
  }

  if (dropped.length > 0) {
    console.log(`[Pre-Email Dedupe] Filtered ${dropped.length} duplicate(s) before finalising email:`);
    for (const d of dropped) {
      const label = d.item.title || `${d.item.artist} - ${d.item.songTitle}`;
      console.log(`  [-] Dropped: "${label}" -> ${d.reason}`);
    }
  } else {
    console.log(`[Pre-Email Dedupe] Checked ${approved.length} candidate(s) — 0 duplicates found.`);
  }

  return { approved, dropped };
}

module.exports = {
  finalDeduplicateBeforeEmail,
  normalizeArtist,
  normalizeTitle,
  artistsMatch,
};

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const cheerio = require('cheerio');
const { parseArtistTitle, isCleanTrack } = require('../../../../src/utils/normalizer');
const { check_musicbrainz_artist, check_itunes_release_history } = require('../../../../src/services/verificationTools');

const DB_PATH = path.resolve(__dirname, '../../../../data/master_catalog.sqlite');
const EXCLUSIONS_PATH = path.resolve(__dirname, '../../../../configs/exclusions.json');

const REISSUE_REGEX = /\b(reissue|re-issue|remaster|remastered|deluxe|anniversary|expanded|edition|demo(s)?|live\s*at|live\s*from|live\s*in|best\s*of|greatest\s*hits|anthology|collection|box\s*set|soundtrack|ost)\b/i;

const AI_FARM_GENRE_CLUES = [
  /multiple genres/i,
  /all genres/i,
  /many styles/i,
  /no borders.*no limits/i,
  /across (multiple|different) genres/i,
  /from .*rock.*to.*ballads.*electronic.*ambient/i
];

const AI_TOOL_KEYWORDS = [
  /\b(suno|udio|midjourney|runway|kling|flux|sora|pika|elevenlabs|minimax|mureka)\b/i,
  /\b(ai\s*generated|ai\s*music|virtual\s*band|virtual\s*artist|synthetic\s*vocals|prompt)\b/i
];

function getDb() {
  if (!fs.existsSync(DB_PATH)) return null;
  return new DatabaseSync(DB_PATH);
}

function extractItemsFromText(rawText) {
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const items = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check if line looks like "Artist - Title"
    if (line.includes(' - ') && !line.startsWith('http') && !line.startsWith('[') && !line.toLowerCase().startsWith('source:')) {
      const parts = line.split(' - ');
      const artist = parts[0].replace(/^[-*•\d.]+\s*/, '').trim();
      let title = parts.slice(1).join(' - ').trim();
      
      let url = '';
      const urlInTitle = title.match(/(https?:\/\/[^\s)]+)/);
      if (urlInTitle) {
        url = urlInTitle[1];
        title = title.replace(urlInTitle[0], '').trim();
      }

      // Look ahead for "Source URL:" or a url on next lines if not found
      if (!url) {
        for (let j = i + 1; j <= Math.min(i + 3, lines.length - 1); j++) {
          const nextLine = lines[j];
          if (nextLine.includes(' - ') && !nextLine.toLowerCase().startsWith('source:')) {
            break;
          }
          if (nextLine.includes('http://') || nextLine.includes('https://')) {
            const match = nextLine.match(/https?:\/\/[^\s)]+/);
            if (match) {
              url = match[0];
              break;
            }
          }
        }
      }

      items.push({ artist, title, url, rawLine: line });
    } else if (line.startsWith('http://') || line.startsWith('https://')) {
      // Standalone URL
      items.push({ artist: '', title: '', url: line.trim(), rawLine: line });
    }
  }

  return items;
}

async function probeYouTubeChannel(url) {
  if (!url || !url.includes('youtube.com') && !url.includes('youtu.be')) return null;

  try {
    let channelUrl = url;
    if (url.includes('/watch?v=')) {
      // Fetch video page first to find channel handle
      const vRes = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const vHtml = await vRes.text();
      const cMatch = vHtml.match(/https:\/\/www\.youtube\.com\/(@[a-zA-Z0-9_\-]+)/);
      if (cMatch) channelUrl = cMatch[0];
    }

    if (!channelUrl.includes('/about') && channelUrl.includes('/@')) {
      channelUrl = `${channelUrl.replace(/\/$/, '')}/about`;
    }

    const res = await fetch(channelUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await res.text();

    const descMatch = html.match(/"description":"(.*?)"/);
    const channelDesc = descMatch ? descMatch[1].replace(/\\n/g, ' ') : '';

    const flags = [];
    for (const clue of AI_FARM_GENRE_CLUES) {
      if (clue.test(channelDesc)) {
        flags.push(`Multi-Genre Omnivore description: "${channelDesc.slice(0, 100)}..."`);
        break;
      }
    }

    for (const tool of AI_TOOL_KEYWORDS) {
      if (tool.test(channelDesc)) {
        flags.push(`AI generator tool keyword detected in channel info`);
        break;
      }
    }

    // Check for DistroKid / topic pattern
    if (/℗ Records DK/i.test(html) || /℗.*DK/i.test(html)) {
      flags.push('DistroKid auto-generated release line (℗ Records DK)');
    }

    return {
      channelUrl,
      channelDesc,
      flags,
      isLikelyAi: flags.length > 0
    };
  } catch (err) {
    return { error: err.message, flags: [] };
  }
}

async function triageTrack(item) {
  const report = {
    artist: item.artist,
    title: item.title,
    url: item.url,
    verdict: 'APPROVED',
    statusBadge: '✅ APPROVED',
    reasons: [],
    catalogHistory: [],
    details: {}
  };

  const db = getDb();

  // 1. Database Check
  if (db && item.artist) {
    const songMatches = db.prepare(`SELECT * FROM songs WHERE artist LIKE ? OR title LIKE ?`).all(`%${item.artist}%`, `%${item.title}%`);
    if (songMatches.length > 0) {
      songMatches.forEach(m => {
        report.catalogHistory.push(`Found "${m.artist} - ${m.title}" (First seen: ${m.first_seen_at} on ${m.first_channel})`);
      });
      // Exact track match vs different song match
      const exact = songMatches.find(m => m.artist.toLowerCase() === item.artist.toLowerCase() && m.title.toLowerCase() === item.title.toLowerCase());
      if (exact) {
        report.verdict = 'ALREADY_SEEN';
        report.statusBadge = '⚠️ DUPLICATE IN DB';
        report.reasons.push(`Already registered in Master Catalog from channel: ${exact.first_channel} (${exact.first_seen_at})`);
      } else {
        report.reasons.push(`Artist exists in Master Catalog with ${songMatches.length} other sighted track(s).`);
      }
    }
  }

  // 2. Clean Track & EveryNoise Purity Gate Check
  let exclusions = { bannedArtists: [], negativeKeywords: [] };
  if (fs.existsSync(EXCLUSIONS_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(EXCLUSIONS_PATH, 'utf8'));
      exclusions = {
        bannedArtists: [...(raw.bannedArtists || []), ...(raw.artists || [])],
        negativeKeywords: [...(raw.negativeKeywords || []), ...(raw.keywords || [])]
      };
    } catch (_) {}
  }

  const isBanned = exclusions.bannedArtists.some(b => `${item.artist} ${item.title}`.toLowerCase().includes(b.toLowerCase()));
  if (isBanned) {
    report.verdict = 'BANNED_ARTIST';
    report.statusBadge = '⛔ BANNED ARTIST';
    report.reasons.push(`Artist or track is explicitly banned in configs/exclusions.json`);
  } else if (!isCleanTrack(item.artist, item.title, exclusions.negativeKeywords, exclusions.bannedArtists)) {
    report.verdict = 'REJECTED_UNCLEAN';
    report.statusBadge = '❌ REJECTED - FOREIGN / BOT / UNCLEAN';
    report.reasons.push(`Failed EveryNoise purity gate (foreign language stopword, bot username with appended digits, or AI prompt markers)`);
  }

  // 3. Reissue / Deluxe Detection
  const combinedText = `${item.artist} ${item.title} ${item.url}`;
  if (REISSUE_REGEX.test(combinedText)) {
    const match = combinedText.match(REISSUE_REGEX);
    report.verdict = 'REJECTED_REISSUE';
    report.statusBadge = '❌ REISSUE / DELUXE';
    report.reasons.push(`Detected catalog reissue marker: "${match[0]}"`);
  }

  // 4. SoundCloud Bot & AI Farm Probe
  if (item.url && item.url.includes('soundcloud.com')) {
    if (/-[0-9]{7,12}(?:\/|$)/.test(item.url)) {
      report.verdict = 'REJECTED_AI';
      report.statusBadge = '🚨 REJECTED - AI / SYNTHETIC';
      report.reasons.push(`SoundCloud Bot Footprint: Auto-generated 9-digit account permalink ID in URL (${item.url})`);
    }
    if (/\b(music\s*factory|song\s*factory|ai\s*records|studio\s*bot|beat\s*factory)\b/i.test(item.artist)) {
      report.verdict = 'REJECTED_AI';
      report.statusBadge = '🚨 REJECTED - AI / SYNTHETIC';
      report.reasons.push(`Content Farm Alias: "${item.artist}" identified as mass-upload factory`);
    }
  }

  // 3. AI Song Detection & YouTube Forensic Probe
  if (item.url && (item.url.includes('youtube.com') || item.url.includes('youtu.be'))) {
    const ytProbe = await probeYouTubeChannel(item.url);
    if (ytProbe && ytProbe.isLikelyAi) {
      report.verdict = 'REJECTED_AI';
      report.statusBadge = '🚨 REJECTED - AI / SYNTHETIC';
      ytProbe.flags.forEach(f => report.reasons.push(`AI Signal: ${f}`));
    }
  }

  // 4. Digital Ghost Check via MusicBrainz (if not already verified or if suspect)
  if (item.artist && report.verdict === 'APPROVED') {
    try {
      const mbArtist = await check_musicbrainz_artist(item.artist);
      if (!mbArtist || !mbArtist.found) {
        // Digital Ghost probe: If artist has zero footprint in MusicBrainz and suspicious generic name
        report.details.musicbrainz = 'Not Found (Digital Ghost)';
        if (/project|collective|records|productions|studio/i.test(item.artist)) {
          report.reasons.push(`Digital Ghost: Artist has 0 MusicBrainz records despite generic studio/project branding.`);
        }
      } else {
        report.details.musicbrainz = `Found (${mbArtist.country_code || 'Global'}) - ${mbArtist.type || 'Artist'}`;
      }
    } catch (_) {}
  }

  // 5. Release Date / Back-Catalog Age via iTunes
  if (item.artist && item.title) {
    try {
      const itunes = await check_itunes_release_history(item.artist, item.title);
      if (itunes && itunes.found && itunes.earliestReleaseDate) {
        report.details.earliestReleaseDate = itunes.earliestReleaseDate;
        const d = new Date(itunes.earliestReleaseDate);
        if (!Number.isNaN(d.getTime())) {
          const ageDays = Math.round((Date.now() - d.getTime()) / (24 * 3600 * 1000));
          if (ageDays > 21) {
            if (report.verdict !== 'REJECTED_AI' && report.verdict !== 'REJECTED_REISSUE') {
              report.verdict = 'REJECTED_STALE';
              report.statusBadge = '❌ REJECTED - STALE';
            }
            report.reasons.push(`Earliest catalog release date was ${itunes.earliestReleaseDate} (${ageDays} days old)`);
          }
        }
      }
    } catch (_) {}
  }

  return report;
}

async function main() {
  const args = process.argv.slice(2);
  let inputText = args.join(' ');

  if (!inputText && !process.stdin.isTTY) {
    // Read from pipe
    inputText = fs.readFileSync(0, 'utf8');
  }

  if (!inputText) {
    console.log(`
Usage:
  node triage.js "<artist> - <title>" ["<url>"]
  node triage.js --text "<pasted alert block>"
  node triage.js "https://www.youtube.com/@ChannelOrVideo"
`);
    return;
  }

  // If input contains multiple lines or alert text
  const items = extractItemsFromText(inputText);

  if (items.length === 0) {
    // Fallback: Treat input as single title or URL
    if (inputText.startsWith('http')) {
      items.push({ artist: '', title: '', url: inputText.trim() });
    } else if (inputText.includes(' - ')) {
      const parts = inputText.split(' - ');
      items.push({ artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim(), url: '' });
    } else {
      items.push({ artist: inputText.trim(), title: '', url: '' });
    }
  }

  console.log(`\n======================================================`);
  console.log(`🔍 TRIAGE & AI AUDIT RUNNER (${items.length} item(s) detected)`);
  console.log(`======================================================\n`);

  for (const item of items) {
    const res = await triageTrack(item);
    console.log(`------------------------------------------------------`);
    console.log(`🎵 ${res.artist ? `${res.artist} - ${res.title}` : res.url}`);
    console.log(`Verdict: ${res.statusBadge}`);
    if (res.reasons.length > 0) {
      console.log(`Notes / Flags:`);
      res.reasons.forEach(r => console.log(`  • ${r}`));
    }
    if (res.catalogHistory.length > 0) {
      console.log(`Master Catalog Sightings:`);
      res.catalogHistory.forEach(h => console.log(`  🔍 ${h}`));
    }
    if (res.details.earliestReleaseDate) {
      console.log(`Earliest Release Date: ${res.details.earliestReleaseDate}`);
    }
    if (res.details.musicbrainz) {
      console.log(`MusicBrainz Registry: ${res.details.musicbrainz}`);
    }
    console.log(``);
  }
}

main().catch(console.error);

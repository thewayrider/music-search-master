const path = require('path');

// 1. MusicBrainz Rate-Limiter (Queue guaranteeing >= 1100ms between calls)
let lastMbCallTime = 0;
async function rateLimitMusicBrainz() {
  const now = Date.now();
  const elapsed = now - lastMbCallTime;
  if (elapsed < 1100) {
    await new Promise((resolve) => setTimeout(resolve, 1100 - elapsed));
  }
  lastMbCallTime = Date.now();
}

// 2. Geographic & Demonym Dictionaries for Target Region Mapping
const REGION_MAP = {
  AU: {
    countryNames: ['australia', 'commonwealth of australia'],
    isoCodes: ['AU', 'AUS'],
    states: [
      'new south wales', 'nsw', 'victoria', 'vic', 'queensland', 'qld',
      'western australia', 'wa', 'south australia', 'sa', 'tasmania', 'tas',
      'australian capital territory', 'act', 'northern territory', 'nt'
    ],
    cities: [
      'melbourne', 'sydney', 'brisbane', 'perth', 'adelaide', 'hobart', 'darwin',
      'canberra', 'geelong', 'gold coast', 'sunshine coast', 'wollongong',
      'newcastle', 'byron bay', 'ballarat', 'bendigo', 'fremantle', 'freo',
      'cairns', 'toowoomba', 'townsville', 'albury', 'launceston'
    ],
    indigenousPlaces: [
      'naarm', 'meanjin', 'gadigal', 'eora', 'boorloo', 'kaurna', 'ngunnawal',
      'lutruwita', 'larrakia', 'whadjuk', 'turrbal', 'yuggera', 'dharawal',
      'bundjalung', 'wadawurrung', 'wurundjeri'
    ],
    demonyms: ['australian', 'aussie']
  },
  NZ: {
    countryNames: ['new zealand', 'aotearoa'],
    isoCodes: ['NZ', 'NZL'],
    regions: [
      'auckland region', 'wellington region', 'canterbury', 'otago', 'waikato',
      'bay of plenty', 'hawke\'s bay', 'taranaki', 'manawatū', 'northland',
      'southland', 'tasman', 'nelson', 'marlborough', 'west coast', 'gisborne'
    ],
    cities: [
      'auckland', 'wellington', 'christchurch', 'dunedin', 'hamilton',
      'tauranga', 'napier', 'hastings', 'nelson', 'palmerston north',
      'rotorua', 'whangārei', 'new plymouth', 'invercargill', 'whanganui', 'gisborne'
    ],
    indigenousPlaces: [
      'tāmaki makaurau', 'tamaki makaurau', 'te whanganui-a-tara', 'ōtautahi',
      'otautahi', 'ōtepoti', 'otepoti', 'kirikiriroa', 'ahuriri', 'whakatū'
    ],
    demonyms: ['new zealand', 'kiwi']
  },
  IE: {
    countryNames: ['ireland', 'republic of ireland', 'northern ireland'],
    isoCodes: ['IE', 'IRL'],
    provinces: ['leinster', 'munster', 'connacht', 'ulster'],
    cities: [
      'dublin', 'cork', 'galway', 'limerick', 'waterford', 'drogheda',
      'dundalk', 'swords', 'bray', 'navan', 'kilkenny', 'ennis', 'carlow',
      'tralee', 'sligo', 'belfast', 'derry', 'londonderry', 'lisburn',
      'newry', 'bangor', 'armagh', 'coleraine', 'antrim', 'omagh', 'enniskillen'
    ],
    demonyms: ['irish']
  },
  US: {
    countryNames: ['united states', 'united states of america', 'usa', 'u.s.', 'u.s.a.'],
    isoCodes: ['US', 'USA'],
    states: [
      'california', 'new york', 'texas', 'florida', 'illinois', 'pennsylvania',
      'ohio', 'georgia', 'north carolina', 'michigan', 'new jersey', 'virginia',
      'washington', 'arizona', 'massachusetts', 'tennessee', 'indiana', 'missouri',
      'maryland', 'wisconsin', 'colorado', 'minnesota', 'south carolina', 'alabama',
      'louisiana', 'kentucky', 'oregon', 'oklahoma', 'connecticut', 'utah'
    ],
    cities: [
      'brooklyn', 'manhattan', 'queens', 'los angeles', 'chicago', 'houston',
      'phoenix', 'philadelphia', 'san antonio', 'san diego', 'dallas', 'austin',
      'seattle', 'portland', 'nashville', 'san francisco', 'denver', 'boston',
      'atlanta', 'minneapolis', 'detroit', 'miami', 'pittsburgh'
    ],
    demonyms: ['american']
  },
  GB: {
    countryNames: ['united kingdom', 'uk', 'great britain', 'britain', 'england', 'scotland', 'wales'],
    isoCodes: ['GB', 'GBR'],
    cities: [
      'london', 'manchester', 'birmingham', 'leeds', 'glasgow', 'liverpool',
      'newcastle upon tyne', 'sheffield', 'bristol', 'edinburgh', 'nottingham',
      'cardiff', 'brighton', 'sheffield', 'leicester'
    ],
    demonyms: ['british', 'english', 'scottish', 'welsh']
  }
};

/**
 * Normalizes text to lowercase without accents
 */
function cleanText(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Checks if a given text / location string matches a country code
 */
function matchCountryCode(text) {
  if (!text) return null;
  const lower = cleanText(text);

  // Check AU
  for (const list of [REGION_MAP.AU.isoCodes, REGION_MAP.AU.countryNames, REGION_MAP.AU.indigenousPlaces, REGION_MAP.AU.cities, REGION_MAP.AU.states, REGION_MAP.AU.demonyms]) {
    for (const val of list) {
      const reg = new RegExp(`\\b${cleanText(val)}\\b`, 'i');
      if (reg.test(lower)) return 'AU';
    }
  }

  // Check NZ
  for (const list of [REGION_MAP.NZ.isoCodes, REGION_MAP.NZ.countryNames, REGION_MAP.NZ.indigenousPlaces, REGION_MAP.NZ.cities, REGION_MAP.NZ.regions, REGION_MAP.NZ.demonyms]) {
    for (const val of list) {
      const reg = new RegExp(`\\b${cleanText(val)}\\b`, 'i');
      if (reg.test(lower)) return 'NZ';
    }
  }

  // Check IE
  for (const list of [REGION_MAP.IE.isoCodes, REGION_MAP.IE.countryNames, REGION_MAP.IE.cities, REGION_MAP.IE.provinces, REGION_MAP.IE.demonyms]) {
    for (const val of list) {
      const reg = new RegExp(`\\b${cleanText(val)}\\b`, 'i');
      if (reg.test(lower)) return 'IE';
    }
  }

  // Check US
  for (const list of [REGION_MAP.US.isoCodes, REGION_MAP.US.countryNames, REGION_MAP.US.cities, REGION_MAP.US.states, REGION_MAP.US.demonyms]) {
    for (const val of list) {
      const reg = new RegExp(`\\b${cleanText(val)}\\b`, 'i');
      if (reg.test(lower)) return 'US';
    }
  }

  // Check GB / UK (excluding Northern Ireland which belongs to IE/NI scope)
  for (const list of [REGION_MAP.GB.isoCodes, REGION_MAP.GB.countryNames, REGION_MAP.GB.cities, REGION_MAP.GB.demonyms]) {
    for (const val of list) {
      const reg = new RegExp(`\\b${cleanText(val)}\\b`, 'i');
      if (reg.test(lower)) return 'GB';
    }
  }

  return null;
}

/**
 * Tool 1: check_musicbrainz_artist
 * Queries MusicBrainz with strict rate-limiting, custom User-Agent, and geographic resolution.
 */
async function check_musicbrainz_artist(artistName) {
  if (!artistName || !artistName.trim()) {
    return { found: false, error: 'Artist name required' };
  }

  const cleanArtist = artistName.trim();
  const escapedQuery = cleanArtist.replace(/[/\\?%*:|"<>]/g, ' ');
  const url = `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(escapedQuery)}&fmt=json&limit=5`;

  try {
    await rateLimitMusicBrainz();

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'MusicReleaseVerifier/1.0 (https://streamusique.com; music-search-master)',
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!res.ok) {
      return { found: false, error: `MusicBrainz HTTP ${res.status}` };
    }

    const data = await res.json();
    const artists = data.artists || [];

    if (artists.length === 0) {
      return {
        found: false,
        artist: cleanArtist,
        confidenceNote: `No artist match found on MusicBrainz for "${cleanArtist}"`
      };
    }

    // Select the best match based on score & exact/close name
    let best = artists[0];
    for (const a of artists) {
      if (a.name && a.name.toLowerCase() === cleanArtist.toLowerCase()) {
        best = a;
        break;
      }
    }

    const countryRaw = best.country || null;
    const areaName = best.area?.name || null;
    const beginAreaName = best['begin-area']?.name || null;
    const disambiguation = best.disambiguation || null;

    // Resolve geographic origin from country, area, beginArea, or disambiguation
    let detectedCountry = null;
    if (countryRaw) {
      detectedCountry = matchCountryCode(countryRaw);
    }
    if (!detectedCountry && areaName) {
      detectedCountry = matchCountryCode(areaName);
    }
    if (!detectedCountry && beginAreaName) {
      detectedCountry = matchCountryCode(beginAreaName);
    }
    if (!detectedCountry && disambiguation) {
      detectedCountry = matchCountryCode(disambiguation);
    }

    return {
      found: true,
      artist: best.name,
      mbid: best.id,
      score: best.score,
      rawCountry: countryRaw,
      area: areaName,
      beginArea: beginAreaName,
      disambiguation,
      detectedCountryCode: detectedCountry || (countryRaw ? countryRaw : 'UNKNOWN'),
      confidenceNote: `MusicBrainz: ${best.name} [score: ${best.score}] area: ${areaName || 'N/A'}, begin-area: ${beginAreaName || 'N/A'}, country: ${countryRaw || 'N/A'}`
    };
  } catch (err) {
    return { found: false, error: err.message };
  }
}

/**
 * Tool 2: check_itunes_release_history
 * Queries iTunes Search API to detect if this song or recording was released earlier
 */
async function check_itunes_release_history(artistName, trackOrAlbumTitle) {
  if (!artistName || !trackOrAlbumTitle) {
    return { found: false, error: 'Artist and title required' };
  }

  const query = `${artistName.trim()} ${trackOrAlbumTitle.trim()}`;
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=15`;

  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });

    if (!res.ok) {
      return { found: false, error: `iTunes HTTP ${res.status}` };
    }

    const data = await res.json();
    const results = data.results || [];

    if (results.length === 0) {
      return {
        found: false,
        artist: artistName,
        title: trackOrAlbumTitle,
        confidenceNote: `No iTunes entries found for "${query}"`
      };
    }

    const cleanTitle = cleanText(trackOrAlbumTitle);
    const cleanArt = cleanText(artistName);

    // Filter relevant song entries where artist and track roughly align
    const matches = results.filter((r) => {
      const rArt = cleanText(r.artistName);
      const rTrack = cleanText(r.trackName);
      const artAlign = rArt.includes(cleanArt) || cleanArt.includes(rArt);
      const trackAlign = rTrack.includes(cleanTitle) || cleanTitle.includes(rTrack);
      return artAlign && trackAlign;
    });

    const candidates = matches.length > 0 ? matches : results.slice(0, 5);

    const dates = candidates
      .map((r) => (r.releaseDate ? r.releaseDate.slice(0, 10) : null))
      .filter(Boolean)
      .sort();

    const earliestDate = dates[0] || null;
    const latestDate = dates[dates.length - 1] || null;

    let ageDays = null;
    if (earliestDate) {
      const parsedEarliest = new Date(earliestDate).getTime();
      ageDays = Math.round((Date.now() - parsedEarliest) / (24 * 60 * 60 * 1000));
    }

    return {
      found: true,
      matchCount: candidates.length,
      earliestReleaseDate: earliestDate,
      latestReleaseDate: latestDate,
      ageDays,
      sampleMatches: candidates.slice(0, 3).map((r) => ({
        track: r.trackName,
        collection: r.collectionName,
        releaseDate: r.releaseDate ? r.releaseDate.slice(0, 10) : null,
        country: r.country
      })),
      confidenceNote: earliestDate
        ? `iTunes: Earliest release date found is ${earliestDate} (${ageDays} days ago across ${candidates.length} versions)`
        : 'iTunes: Matches found but lacked parseable releaseDate'
    };
  } catch (err) {
    return { found: false, error: err.message };
  }
}

/**
 * Tool 3: inspect_source_clues
 * Scans attached bio text, article blurbs, or URLs for Indigenous place names,
 * city mentions, demonyms, or reissue indicators.
 */
function inspect_source_clues(rawTextOrUrl) {
  if (!rawTextOrUrl) {
    return { detectedCountry: null, clues: [], isReissueSuspect: false, reissueClues: [] };
  }

  const text = String(rawTextOrUrl);
  const detectedCountry = matchCountryCode(text);

  const clues = [];
  const lower = cleanText(text);

  // Check specific notable tags
  const notablePlaces = [
    'naarm', 'meanjin', 'gadigal', 'eora', 'boorloo', 'kaurna',
    'tāmaki makaurau', 'tamaki makaurau', 'te whanganui-a-tara', 'ōtautahi',
    'dublin', 'belfast', 'melbourne', 'sydney', 'brisbane', 'auckland', 'wellington'
  ];

  for (const place of notablePlaces) {
    if (lower.includes(place)) {
      clues.push(place);
    }
  }

  // Check reissue patterns
  const reissuePatterns = [
    /\bremaster(ed)?\b/i,
    /\banniversary(\s+edition)?\b/i,
    /\breissue(d)?\b/i,
    /\bre-issue\b/i,
    /\bdeluxe\s+edition\b/i,
    /\bexpanded\s+edition\b/i,
    /\blive\s+at\b/i,
    /\blive\s+from\b/i,
    /\bdemo\s+\d{4}\b/i,
    /\brecorded\s+in\s+\d{4}\b/i,
    /\b(197\d|198\d|199\d|200\d|201\d)\b/
  ];

  const reissueClues = [];
  for (const pat of reissuePatterns) {
    const match = text.match(pat);
    if (match) {
      reissueClues.push(match[0]);
    }
  }

  return {
    detectedCountry,
    clues,
    isReissueSuspect: reissueClues.length > 0,
    reissueClues
  };
}

module.exports = {
  check_musicbrainz_artist,
  check_itunes_release_history,
  inspect_source_clues,
  matchCountryCode
};

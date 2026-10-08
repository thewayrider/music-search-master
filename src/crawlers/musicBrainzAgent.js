const fs = require("fs/promises");
const path = require("path");

const DEFAULTS = {
  sourceService: "MusicBrainz",
  musicbrainzBase: "https://musicbrainz.org/ws/2",
  runWindowDays: 7,
  targetGenres: ["indie", "indie rock", "alternative pop/rock"],
  maxResultsPerGenre: 20,
  mbDelayMs: 2000,      
  timeoutMs: 25000,
  userAgent: "NewIndieFriday/0.1 ( https://kimrampling.com )"
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runMusicBrainzAgent(config = {}, exclusions = {}) {
  const options = { ...DEFAULTS, ...config };
  const http = fetch;
  const releases = [];
  const runWindowDays = options.runWindowDays;
  const cutoffDate = new Date(Date.now() - runWindowDays * 24 * 60 * 60 * 1000);
  const startDateStr = cutoffDate.toISOString().slice(0, 10);
  const endDateStr = new Date().toISOString().slice(0, 10);

  console.log(`[MusicBrainz Agent] Starting Lucene search from ${startDateStr} to ${endDateStr} (Max ${options.maxResultsPerGenre} per genre)`);

  for (const genre of options.targetGenres) {
    // Quote and escape genre if it has spaces or special chars
    const queryGenre = genre.replace(/\//g, "\\/"); 
    const quotedGenre = queryGenre.includes(" ") ? `"${queryGenre}"` : queryGenre;
    const query = `date:[${startDateStr} TO ${endDateStr}] AND tag:${quotedGenre}`;
    const url = `${options.musicbrainzBase}/release/?query=${encodeURIComponent(query)}&limit=${options.maxResultsPerGenre}&fmt=json`;
    
    console.log(`[MusicBrainz Agent] Fetching genre: ${genre}...`);
    try {
      const res = await http(url, {
        headers: { accept: "application/json", "user-agent": options.userAgent },
        signal: AbortSignal.timeout ? AbortSignal.timeout(options.timeoutMs) : undefined,
      });

      if (!res.ok) {
        console.error(`[MusicBrainz Agent] Request failed for genre ${genre}: ${res.status}`);
        await sleep(options.mbDelayMs);
        continue;
      }

      const data = await res.json();
      const releasesList = data["releases"] || [];
      console.log(`[MusicBrainz Agent] Found ${releasesList.length} results for genre: ${genre}`);

      for (const rel of releasesList) {
        const artist = rel["artist-credit"] && rel["artist-credit"].length > 0 ? rel["artist-credit"][0].name : "Unknown Artist";
        
        // When searching /release/, the release-group is nested
        const rg = rel["release-group"] || {};
        const title = rel.title;
        const rgType = mapReleaseType(rg["primary-type"]);
        const releaseDate = normalizeDate(rel.date) || "unknown";
        const rgMbid = rg.id; // use release-group ID for the link if available, fallback to release
        const sourceUrl = rgMbid ? `https://musicbrainz.org/release-group/${rgMbid}` : `https://musicbrainz.org/release/${rel.id}`;
        
        const score = scoreRelease({ releaseType: rgType, genre });

        releases.push({
          artist: String(artist).trim(),
          title: String(title).trim(),
          releaseType: rgType,
          releaseDate: releaseDate,
          articleDate: releaseDate,
          sourceService: options.sourceService,
          sourceUrl: sourceUrl,
          marketsAvailable: [],
          genresMapped: [genre],
          artistCountryMapped: null, // Zero-play doesn't do deep country enrichment yet to save API calls
          score,
          bucket: bucketFromScore(score),
          originConfidence: 1.0,
          originSource: "musicbrainz:lucene",
        });
      }
    } catch (e) {
      console.error(`[MusicBrainz Agent] Error fetching genre ${genre}: ${e.message}`);
    }
    
    // Respect MusicBrainz rate limits between queries
    await sleep(options.mbDelayMs);
  }

  const deduped = dedupeAndSort(releases, exclusions);

  // MAPPING TO UNIFIED AGENT FORMAT
  const unifiedResults = deduped.map(r => {
      let description = `Score: ${r.score} | Type: ${r.releaseType}`;
      if (r.genresMapped && r.genresMapped.length) description += ` | Genres: ${r.genresMapped.join(', ')}`;
      description += ` | Origin: ${r.originSource}`;

      return {
          title: `${r.artist} - ${r.title}`,
          channel: "MusicBrainz Lucene API",
          url: r.sourceUrl,
          views: r.bucket,
          uploadedAt: r.releaseDate,
          description: description
      };
  });

  console.log(`[MusicBrainz Agent] Finished. Returning ${unifiedResults.length} unified results.`);
  return unifiedResults;
}

// ---------------------------------------------------------------------------
// Shared inference + scoring
// ---------------------------------------------------------------------------

function scoreRelease({ releaseType, genre }) {
  let score = 5; // Base score
  if (genre.includes("indie")) score += 2;
  
  if (releaseType === "album") score += 2;
  else if (releaseType === "ep") score += 2;
  else if (releaseType === "single") score += 2;
  else if (releaseType === "unknown") score -= 1;
  
  return Math.round(score * 10) / 10;
}

function bucketFromScore(score) {
  if (score >= 9) return "Best matches";
  if (score >= 7) return "Worth checking";
  return "Manual review";
}

function mapReleaseType(rgType) {
  const t = String(rgType || "").toLowerCase();
  if (t === "album") return "album";
  if (t === "ep") return "ep";
  if (t === "single") return "single";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Dedupe + sort
// ---------------------------------------------------------------------------

function dedupeAndSort(items, exclusions) {
  const map = new Map();
  for (const item of items) {
    const key = `${slugify(item.artist)}::${slugify(item.title)}`;
    const existing = map.get(key);
    if (!existing || item.score > existing.score) {
      // Basic exclusion check
      if (exclusions && exclusions.artists) {
        if (exclusions.artists.includes(item.artist.toLowerCase())) continue;
      }
      map.set(key, item);
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => b.score - a.score || a.artist.localeCompare(b.artist)
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

module.exports = {
  runMusicBrainzAgent
};

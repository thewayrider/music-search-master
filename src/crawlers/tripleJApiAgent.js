const DEFAULTS = {
  sourceService: 'Triple J',
  defaultCountry: 'Australia',
};

async function getRecentPlays(limit = 100) {
    const url = `https://music.abcradio.net.au/api/v1/plays/search.json?station=triplej&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ABC API Error: ${res.statusText}`);
    return await res.json();
}

function scoreRelease(release) {
    let score = 5; // Base score for Triple J rotation
    if (release.format === 'single' || release.format === 'ep') score += 2;
    if (release.artists && release.artists.some(a => a.is_australian)) score += 3;
    return score;
}

function bucketFromScore(score) {
    if (score >= 7) return "Best matches";
    if (score >= 5) return "Worth checking";
    return "Manual review";
}

async function runTripleJApiAgent(config = {}, exclusions = {}) {
    const options = { ...DEFAULTS, ...config };
    console.log(`[Triple J Agent] Fetching recently played tracks from ABC API...`);
    
    const data = await getRecentPlays(100);
    const currentYear = new Date().getFullYear().toString();
    
    const unifiedResults = [];
    const seenSongs = new Set();
    
    for (const item of data.items) {
        if (!item.recording || !item.release) continue;
        
        const releaseYear = item.release.release_year;
        
        // ONLY include songs released this year
        if (releaseYear !== currentYear) continue;
        
        const artist = item.recording.artists ? item.recording.artists.map(a => a.name).join(', ') : 'Unknown';
        const title = item.recording.title || 'Unknown';
        const songKey = `${artist}-${title}`.toLowerCase();
        
        if (seenSongs.has(songKey)) continue; // Deduplicate
        seenSongs.add(songKey);
        
        const score = scoreRelease(item.release);
        const bucket = bucketFromScore(score);
        
        const artworkUrl = item.release.artwork && item.release.artwork.length > 0 ? item.release.artwork[0].url : '';
        const imgTag = artworkUrl ? `<img src="${artworkUrl}" style="height:50px">` : '';
        
        let description = `Score: ${score} | Release Year: ${releaseYear} | Played: ${item.played_time.slice(0,10)}`;
        if (imgTag) description += ` | Cover: ${imgTag}`;
        
        unifiedResults.push({
            title: `${artist} - ${title}`,
            channel: options.sourceService,
            url: `https://www.abc.net.au/triplej/`, // ABC doesn't always provide direct links to the songs
            views: bucket,
            uploadedAt: item.played_time.slice(0,10),
            description: description
        });
    }
    
    console.log(`[Triple J Agent] Found ${unifiedResults.length} new ${currentYear} releases in the last 100 plays.`);
    return unifiedResults;
}

module.exports = { runTripleJApiAgent };

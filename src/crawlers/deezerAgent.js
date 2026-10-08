const fs = require('fs');
const path = require('path');
const { verifyArtistOriginWithAI } = require('../utils/aiScraper');

// rate-limiter.js
const delay = ms => new Promise(res => setTimeout(res, ms));

async function findPlaylistId(playlistName) {
    const url = `https://api.deezer.com/search/playlist?q=${encodeURIComponent(playlistName)}`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        
        if (data.data && data.data.length > 0) {
            // Find best match: exact name match (case insensitive), prioritize highest track count
            const exactMatches = data.data.filter(p => p.title.toLowerCase() === playlistName.toLowerCase());
            if (exactMatches.length > 0) {
                exactMatches.sort((a, b) => b.nb_tracks - a.nb_tracks);
                return exactMatches[0].id;
            }
            return data.data[0].id; // Fallback to first result
        }
    } catch (error) {
        console.error(`[Deezer Agent] Error finding playlist ${playlistName}:`, error.message);
    }
    return null;
}

async function fetchPlaylistTracks(playlistId) {
    let url = `https://api.deezer.com/playlist/${playlistId}/tracks`;
    const tracks = new Map();

    while (url) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            
            if (data.data) {
                for (const item of data.data) {
                    if (!tracks.has(item.id)) {
                        tracks.set(item.id, item);
                    }
                }
            }
            
            url = data.next || null;
            await delay(120); // Strict throttle
        } catch (error) {
            console.error('[Deezer Agent] Pagination error on playlist tracks:', error.message);
            break;
        }
    }
    return Array.from(tracks.values());
}

async function verifyOrigin(track) {
    let isrc = track.isrc;
    
    // Deezer playlist track objects sometimes omit the ISRC, so fetch track details if missing
    if (!isrc) {
        await delay(120);
        const trackRes = await fetch(`https://api.deezer.com/track/${track.id}`);
        const trackData = await trackRes.json();
        isrc = trackData.isrc || "";
    }
    
    if (isrc) {
        const countryCode = isrc.substring(0, 2);
        // Immediate geographical match
        if (['IE', 'AU', 'NZ'].includes(countryCode)) {
            return { match: true, reason: `Local ISRC: ${countryCode}` };
        }
    }
    
    // Fallback to label check for global ISRCs
    if (track.album && track.album.id) {
        await delay(120);
        const albumRes = await fetch(`https://api.deezer.com/album/${track.album.id}`);
        const albumData = await albumRes.json();
        return { match: 'REQUIRES_LLM', label: albumData.label, isrc: isrc };
    }
    
    return { match: 'REQUIRES_LLM', label: 'Unknown', isrc: isrc };
}

async function runDeezerAgent(config, exclusions) {
    console.log(`[Deezer Agent] Starting extraction from Deezer Playlists...`);
    const results = [];
    // Target the "Fresh picks of the week" playlists specified by user
    const playlistNames = config.playlistNames || ["New Alternative", "Hot New Rock", "Hard Rock Now"];
    
    // State management for time_add cutoff
    const statePath = path.join(__dirname, '../../configs/deezer_state.json');
    let cutoffTimeAdd = config.minTimeAdd || 0; // Default to Sept 1 2026 if set in config
    if (fs.existsSync(statePath)) {
        try {
            const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
            if (state.lastTimeAdd) {
                cutoffTimeAdd = state.lastTimeAdd;
                console.log(`[Deezer Agent] Loaded previous state. Only fetching tracks added after: ${new Date(cutoffTimeAdd * 1000).toISOString()}`);
            }
        } catch (e) {
            console.error('[Deezer Agent] Error reading state file, using config default.', e);
        }
    } else {
        console.log(`[Deezer Agent] No previous state found. Using initial cutoff: ${new Date(cutoffTimeAdd * 1000).toISOString()}`);
    }

    let highestTimeAddSeen = cutoffTimeAdd;
    const allTracks = new Map();
    
    for (const name of playlistNames) {
        console.log(`[Deezer Agent] Searching for playlist: ${name}`);
        const playlistId = await findPlaylistId(name);
        await delay(120);
        
        if (playlistId) {
            console.log(`[Deezer Agent] Found playlist ID ${playlistId} for "${name}". Fetching tracks...`);
            const tracks = await fetchPlaylistTracks(playlistId);
            for (const item of tracks) {
                // Keep track of the highest time_add we've ever seen
                if (item.time_add && item.time_add > highestTimeAddSeen) {
                    highestTimeAddSeen = item.time_add;
                }
                
                // Only process tracks that were added strictly after our cutoff
                if (item.time_add && item.time_add <= cutoffTimeAdd) {
                    continue;
                }
                
                if (!allTracks.has(item.id)) {
                    allTracks.set(item.id, { track: item, sourcePlaylist: name });
                }
            }
        } else {
            console.log(`[Deezer Agent] Could not find playlist: ${name}`);
        }
    }
    
    console.log(`[Deezer Agent] Found ${allTracks.size} unique tracks across playlists.`);
    
    for (const { track, sourcePlaylist } of allTracks.values()) {
        const artistName = track.artist ? track.artist.name : 'Unknown Artist';
        const title = track.title;
        const formattedTitle = `${artistName} - ${title}`;
        
        console.log(`[Deezer Agent] Checking origin for: ${formattedTitle}`);
        try {
            const originData = await verifyOrigin(track);
            if (!originData) continue;
            
            let isMatch = false;
            let reason = '';
            
            if (originData.match === true) {
                isMatch = true;
                reason = originData.reason;
            } else if (originData.match === 'REQUIRES_LLM') {
                const label = originData.label || 'Unknown';
                // Use LLM Validation Step for unrecognized or generic labels
                const aiResult = await verifyArtistOriginWithAI(artistName, label);
                if (aiResult && aiResult.is_target_region) {
                    isMatch = true;
                    reason = `AI Matched: ${aiResult.reasoning}`;
                }
            }
            
            if (isMatch) {
                console.log(`[Deezer Agent] Match Found: ${formattedTitle} (${reason})`);
                results.push({
                    title: formattedTitle,
                    channel: `Deezer: ${sourcePlaylist}`,
                    url: track.link || `https://www.deezer.com/track/${track.id}`,
                    views: "New Addition",
                    uploadedAt: "Recent", 
                    description: `Discovered in Deezer playlist "${sourcePlaylist}". ${reason}`
                });
            }
        } catch (error) {
            console.error(`[Deezer Agent] Error processing ${formattedTitle}:`, error.message);
        }
    }
    
    // Save the new highest time_add for the next run
    try {
        fs.writeFileSync(statePath, JSON.stringify({ lastTimeAdd: highestTimeAddSeen }, null, 2));
        console.log(`[Deezer Agent] Updated state file with new cutoff: ${new Date(highestTimeAddSeen * 1000).toISOString()}`);
    } catch (e) {
        console.error('[Deezer Agent] Failed to save state file.', e);
    }
    
    return results;
}

module.exports = { runDeezerAgent };

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  playlistId: '',
  sourceService: 'Spotify Playlist',
  defaultCountry: 'Unknown'
};

async function getAccessToken(clientId, clientSecret, refreshToken) {
    const authStr = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    
    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${authStr}`
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        })
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Spotify Auth Error: ${response.status} - ${text}`);
    }

    const data = await response.json();
    return data.access_token;
}

function scoreRelease(trackTitle, artistName) {
    return 5; // Base score
}

function bucketFromScore(score) {
    if (score >= 7) return "Best matches";
    if (score >= 5) return "Worth checking";
    return "Manual review";
}

async function runSpotifyOAuthAgent(config = {}, exclusions = {}) {
    const options = { ...DEFAULTS, ...config };
    if (!options.playlistId) {
        console.error("[Spotify OAuth Agent] No playlistId provided in config.");
        return [];
    }

    // Load credentials
    const secretsPath = path.join(__dirname, '..', '..', 'configs', 'secrets.json');
    let secrets;
    try {
        secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf-8'));
    } catch (e) {
        throw new Error("[Spotify OAuth Agent] Could not load secrets.json");
    }

    if (!secrets.spotifyClientId || !secrets.spotifyClientSecret || !secrets.spotifyRefreshToken) {
        throw new Error("[Spotify OAuth Agent] Missing Spotify credentials. Run setup_spotify_oauth.js first.");
    }

    console.log(`[Spotify OAuth Agent] Authenticating with Spotify...`);
    const accessToken = await getAccessToken(secrets.spotifyClientId, secrets.spotifyClientSecret, secrets.spotifyRefreshToken);

    console.log(`[Spotify OAuth Agent] Fetching playlist tracks for: ${options.playlistId}...`);
    // Fetch up to 100 tracks from the playlist
    const url = `https://api.spotify.com/v1/playlists/${options.playlistId}/tracks?limit=100`;
    const res = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${accessToken}`
        }
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`[Spotify OAuth Agent] API Error: ${res.status} - ${errText}`);
    }

    const data = await res.json();
    const unifiedResults = [];
    
    for (const item of data.items) {
        if (!item || !item.track) continue;
        const track = item.track;
        
        // Sometimes local tracks don't have all metadata
        if (!track.id) continue;

        const title = track.name;
        const artist = track.artists ? track.artists.map(a => a.name).join(', ') : 'Unknown Artist';
        const trackUrl = track.external_urls ? track.external_urls.spotify : '';
        const previewUrl = track.preview_url || '';
        
        const score = scoreRelease(title, artist);
        const bucket = bucketFromScore(score);
        
        let description = `Score: ${score}`;
        if (previewUrl) description += ` | Preview: <audio controls src="${previewUrl}" style="height:20px"></audio>`;
        
        // We use the added_at timestamp if available, else fallback to today
        const uploadedAt = item.added_at ? item.added_at.slice(0, 10) : new Date().toISOString().slice(0, 10);

        unifiedResults.push({
            title: `${artist} - ${title}`,
            channel: options.sourceService,
            url: trackUrl,
            views: bucket,
            uploadedAt: uploadedAt, 
            description: description
        });
    }
    
    console.log(`[Spotify OAuth Agent] Extracted ${unifiedResults.length} tracks.`);
    return unifiedResults;
}

module.exports = { runSpotifyOAuthAgent };

const fs = require('fs');
const path = require('path');
const {
  check_musicbrainz_artist,
  check_itunes_release_history,
  inspect_source_clues,
  matchCountryCode
} = require('./verificationTools');
const { parseArtistTitle } = require('../utils/normalizer');

// Load Gemini credentials if available for seamless fallback
function getGeminiToken() {
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }
  try {
    const secretsPath = path.resolve(__dirname, '../../configs/secrets.json');
    if (fs.existsSync(secretsPath)) {
      const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
      return secrets.geminiToken || null;
    }
  } catch {
    // ignore
  }
  return null;
}

const DEFAULTS = {
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'qwen2.5:3b',
  releaseWindowDays: parseInt(process.env.RELEASE_WINDOW_DAYS || '14', 10),
  targetRegions: ['AU', 'NZ', 'IE'], // Default regional scope; can be ['US'] or ['GLOBAL']
  maxAgentTurns: 3
};

/**
 * Stage 1: Purely Deterministic Fast Sieve (Zero LLM cost / Sub-millisecond)
 */
function runDeterministicSieve(item, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const targetRegions = opts.targetRegions || ['AU', 'NZ', 'IE'];
  const isGlobal = targetRegions.includes('GLOBAL') || targetRegions.includes('ANY');

  const rawTitle = item.title || item.songTitle || '';
  const parsed = parseArtistTitle(rawTitle);
  const artist = item.artist || parsed.artist || '';
  const title = item.songTitle || parsed.title || '';
  const fullText = `${artist} - ${title} ${item.description || ''} ${item.channel || ''}`;

  // 1. Explicit Reissue / Catalog Reject Rules
  const reissueRegex = /\b(remaster(ed)?|anniversary(\s+edition)?|reissue(d)?|re-issue|deluxe\s+edition|expanded\s+edition|live\s+at\b|live\s+from\b|demo\s+\d{4}|recorded\s+in\s+\d{4})\b/i;
  if (reissueRegex.test(rawTitle) || reissueRegex.test(item.description || '')) {
    return {
      passed: false,
      verified_origin: null,
      country_code: 'UNKNOWN',
      verified_new_release: false,
      earliest_release_date: null,
      verification_stage: 'deterministic',
      confidence_note: 'Rejected: Reissue, remaster, or catalog anniversary keywords in metadata'
    };
  }

  // 2. Known Single-Region Sources Check
  const channel = (item.channel || item.sourceService || '').toLowerCase();
  let sourceCountry = null;

  if (channel.includes('unearthed') || channel.includes('triple j') || channel.includes('amrap') || channel.includes('air chart')) {
    sourceCountry = 'AU';
  } else if (channel.includes('roots mag') || channel.includes('roots_online_nz')) {
    sourceCountry = 'NZ';
  } else if (channel.includes('nialler9')) {
    sourceCountry = 'IE';
  }

  // Check if source matches target regional scope
  const sourceMatchesScope = isGlobal || (sourceCountry && targetRegions.includes(sourceCountry));

  if (sourceMatchesScope && sourceCountry) {
    // Check publication date freshness
    const pubDateStr = item.uploadedAt || item.releaseDate;
    if (pubDateStr) {
      const parsedDate = new Date(pubDateStr);
      if (!Number.isNaN(parsedDate.getTime())) {
        const ageDays = (Date.now() - parsedDate.getTime()) / (24 * 60 * 60 * 1000);
        if (ageDays <= opts.releaseWindowDays && ageDays >= -2) { // up to 2 days in future for timezone shifts
          return {
            passed: true,
            verified_origin: true,
            country_code: sourceCountry,
            verified_new_release: true,
            earliest_release_date: pubDateStr.slice(0, 10),
            verification_stage: 'deterministic',
            confidence_note: `Verified single-region source (${item.channel}) published within ${opts.releaseWindowDays}d window (${Math.round(ageDays)}d old)`
          };
        }
      }
    }
  }

  // 3. Ambiguous pass-through: needs Stage 2 verification
  return {
    passed: null,
    needsAgentVerification: true,
    artist,
    title
  };
}

/**
 * Checks if local Ollama endpoint is reachable
 */
async function isOllamaAvailable(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(1500)
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Stage 2: Ollama Tool-Calling Agent Loop
 */
async function runOllamaAgentLoop(artist, title, item, opts) {
  const toolsSpec = [
    {
      type: 'function',
      function: {
        name: 'check_musicbrainz_artist',
        description: 'Looks up artist country, city, and Indigenous place names on MusicBrainz.',
        parameters: {
          type: 'object',
          properties: {
            artistName: { type: 'string', description: 'Name of the artist or band' }
          },
          required: ['artistName']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'check_itunes_release_history',
        description: 'Checks iTunes to find the earliest historical release date of a song or recording.',
        parameters: {
          type: 'object',
          properties: {
            artistName: { type: 'string', description: 'Name of the artist' },
            trackOrAlbumTitle: { type: 'string', description: 'Title of the track' }
          },
          required: ['artistName', 'trackOrAlbumTitle']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'inspect_source_clues',
        description: 'Scans article blurbs, bio text, or URL for regional clues (e.g. Naarm, Meanjin, Dublin) or reissue tags.',
        parameters: {
          type: 'object',
          properties: {
            rawTextOrUrl: { type: 'string', description: 'Text or URL to scan' }
          },
          required: ['rawTextOrUrl']
        }
      }
    }
  ];

  const targetScopeDesc = opts.targetRegions.includes('GLOBAL') || opts.targetRegions.includes('ANY')
    ? 'GLOBAL (any country of origin is acceptable)'
    : opts.targetRegions.join(', ');

  const systemPrompt = `You are an autonomous music release verifier.
Target Origin Scope: ${targetScopeDesc}.
Release Freshness Window: Within the last ${opts.releaseWindowDays} days.

Your goal:
1. Verify if artist "${artist}" originates from or is primarily based in ${targetScopeDesc}.
2. Verify if track "${title}" is a genuine new release (first released within the last ${opts.releaseWindowDays} days) and NOT an older catalog cut or reissue.
   (Note: If iTunes returns no older historical records and the track was recently uploaded/published, consider it a genuine new release unless older dates or reissue clues prove otherwise).

Use your tools to inspect MusicBrainz, iTunes, and text clues.
When done, output ONLY a valid JSON object matching this schema:
{
  "verified_origin": true | false,
  "country_code": "AU" | "NZ" | "IE" | "US" | "GB" | "OTHER" | "UNKNOWN",
  "verified_new_release": true | false,
  "earliest_release_date": "YYYY-MM-DD" | null,
  "confidence_note": "Brief 1-sentence reason"
}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Please verify this release: Artist: "${artist}", Track: "${title}". Description/URL: "${item.description || ''} ${item.url || ''}"` }
  ];

  let turns = 0;
  while (turns < opts.maxAgentTurns) {
    turns++;
    const res = await fetch(`${opts.ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.ollamaModel,
        messages,
        tools: toolsSpec,
        stream: false,
        keep_alive: -1,
        options: {
          temperature: 0.1,
          num_ctx: 2048
        }
      }),
      signal: AbortSignal.timeout(20000)
    });

    if (!res.ok) {
      throw new Error(`Ollama HTTP ${res.status}`);
    }

    const data = await res.json();
    const msg = data.message;
    messages.push(msg);

    // If model made tool calls, execute them
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        const fnName = tc.function.name;
        const fnArgs = tc.function.arguments || {};
        let toolResult = null;

        if (fnName === 'check_musicbrainz_artist') {
          toolResult = await check_musicbrainz_artist(fnArgs.artistName || artist);
        } else if (fnName === 'check_itunes_release_history') {
          toolResult = await check_itunes_release_history(fnArgs.artistName || artist, fnArgs.trackOrAlbumTitle || title);
        } else if (fnName === 'inspect_source_clues') {
          toolResult = inspect_source_clues(fnArgs.rawTextOrUrl || `${item.description || ''} ${item.url || ''}`);
        }

        messages.push({
          role: 'tool',
          content: JSON.stringify(toolResult || { error: 'Unknown tool' })
        });
      }
      continue;
    }

    // Model finished and returned response content
    const text = msg.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsedRes = JSON.parse(jsonMatch[0]);
      return {
        passed: parsedRes.verified_origin && parsedRes.verified_new_release,
        verified_origin: parsedRes.verified_origin ?? false,
        country_code: parsedRes.country_code || 'UNKNOWN',
        verified_new_release: parsedRes.verified_new_release ?? false,
        earliest_release_date: parsedRes.earliest_release_date || null,
        verification_stage: 'agent',
        confidence_note: parsedRes.confidence_note || 'Verified via local Ollama agent loop'
      };
    }
  }

  throw new Error('Ollama agent loop exceeded turn limit without returning JSON');
}

/**
 * Dual-Safety Cloud Fallback: Gemini Flash (uses verified ground-truth tool data)
 */
async function runGeminiFallback(artist, title, item, opts) {
  const token = getGeminiToken();
  if (!token) {
    throw new Error('No Gemini API token available in configs/secrets.json or environment');
  }

  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(token);
  const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

  // Gather concrete ground truth from tools in Node.js first
  const [mbData, itunesData, clueData] = await Promise.all([
    check_musicbrainz_artist(artist).catch(e => ({ error: e.message })),
    check_itunes_release_history(artist, title).catch(e => ({ error: e.message })),
    Promise.resolve(inspect_source_clues(`${item.description || ''} ${item.url || ''}`))
  ]);

  const targetScopeDesc = opts.targetRegions.includes('GLOBAL') || opts.targetRegions.includes('ANY')
    ? 'GLOBAL (any country allowed)'
    : opts.targetRegions.join(', ');

  const prompt = `You are a music release verification classifier.
Target Origin Scope: ${targetScopeDesc}.
Release Freshness Window: Within the last ${opts.releaseWindowDays} days.

Examine this track and the factual data collected from MusicBrainz and iTunes:
Track: "${artist} - ${title}"
Attached Clues: ${JSON.stringify(clueData)}
MusicBrainz Artist Data: ${JSON.stringify(mbData)}
iTunes Release History: ${JSON.stringify(itunesData)}

Determine:
1. Is artist originating from or based in ${targetScopeDesc}?
2. Is this track a genuine new release (first released within the last ${opts.releaseWindowDays} days) and NOT a reissue or older catalog track?
   (Note: If iTunes returns no older historical records and the track was recently uploaded/published, consider it a genuine new release unless older dates or reissue clues prove otherwise).

Return ONLY a JSON object:
{
  "verified_origin": true | false,
  "country_code": "AU" | "NZ" | "IE" | "US" | "GB" | "OTHER" | "UNKNOWN",
  "verified_new_release": true | false,
  "earliest_release_date": "YYYY-MM-DD" | null,
  "confidence_note": "1-sentence summary"
}`;

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json'
    }
  });

  const text = result.response.text().trim();
  const parsedRes = JSON.parse(text);

  return {
    passed: parsedRes.verified_origin && parsedRes.verified_new_release,
    verified_origin: parsedRes.verified_origin ?? false,
    country_code: parsedRes.country_code || 'UNKNOWN',
    verified_new_release: parsedRes.verified_new_release ?? false,
    earliest_release_date: parsedRes.earliest_release_date || null,
    verification_stage: 'cloud_fallback',
    confidence_note: parsedRes.confidence_note || 'Verified via Gemini Flash ground-truth fallback'
  };
}

/**
 * Pure heuristic fallback when neither LLM is reachable
 */
async function runToolHeuristicFallback(artist, title, item, opts) {
  const [mbData, itunesData, clueData] = await Promise.all([
    check_musicbrainz_artist(artist).catch(() => null),
    check_itunes_release_history(artist, title).catch(() => null),
    Promise.resolve(inspect_source_clues(`${item.description || ''} ${item.url || ''}`))
  ]);

  const targetRegions = opts.targetRegions || ['AU', 'NZ', 'IE'];
  const isGlobal = targetRegions.includes('GLOBAL') || targetRegions.includes('ANY');

  // Detect Country
  let detectedCountry = mbData?.detectedCountryCode || clueData.detectedCountry || null;
  const originOk = isGlobal || (detectedCountry && targetRegions.includes(detectedCountry));

  // Detect Freshness
  let newReleaseOk = true;
  let earliestDate = itunesData?.earliestReleaseDate || null;
  if (itunesData && itunesData.ageDays !== null && itunesData.ageDays > opts.releaseWindowDays) {
    newReleaseOk = false;
  }

  if (clueData.isReissueSuspect) {
    newReleaseOk = false;
  }

  return {
    passed: originOk && newReleaseOk,
    verified_origin: originOk ? true : (detectedCountry ? false : null),
    country_code: detectedCountry || 'UNKNOWN',
    verified_new_release: newReleaseOk,
    earliest_release_date: earliestDate,
    verification_stage: 'unverified_fallback',
    confidence_note: `Deterministic tool fallback: Country=${detectedCountry || 'Unresolved'}, iTunes earliest=${earliestDate || 'N/A'}`
  };
}

/**
 * Main Entry Point: verifyRelease(item, options)
 * Enriches the release item with a standardized verification stamp.
 */
async function verifyRelease(item, options = {}) {
  const opts = { ...DEFAULTS, ...options };

  // 1. Run Stage 1 Fast Sieve
  const sieveResult = runDeterministicSieve(item, opts);
  if (!sieveResult.needsAgentVerification) {
    return {
      ...item,
      verification: sieveResult,
      isVerified: sieveResult.passed === true
    };
  }

  const artist = sieveResult.artist;
  const title = sieveResult.title;

  // 2. Stage 2: Try Local Ollama if online
  const hasOllama = await isOllamaAvailable(opts.ollamaBaseUrl);
  if (hasOllama) {
    try {
      const ollamaRes = await runOllamaAgentLoop(artist, title, item, opts);
      return {
        ...item,
        verification: ollamaRes,
        isVerified: ollamaRes.passed === true
      };
    } catch (err) {
      console.warn(`[Verifier] Ollama loop failed (${err.message}). Falling back...`);
    }
  }

  // 3. Stage 2: Dual-Safety Gemini Fallback
  try {
    const geminiRes = await runGeminiFallback(artist, title, item, opts);
    return {
      ...item,
      verification: geminiRes,
      isVerified: geminiRes.passed === true
    };
  } catch (err) {
    console.warn(`[Verifier] Cloud fallback failed (${err.message}). Falling back to heuristic tools...`);
  }

  // 4. Fallback when both AI layers are unreachable
  const fallbackRes = await runToolHeuristicFallback(artist, title, item, opts);
  return {
    ...item,
    verification: fallbackRes,
    isVerified: fallbackRes.passed === true
  };
}

/**
 * Batch processor for lists of releases
 */
async function verifyReleasesBatch(items, options = {}) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const results = [];
  for (const item of items) {
    const verified = await verifyRelease(item, options);
    results.push(verified);
  }
  return results;
}

module.exports = {
  verifyRelease,
  verifyReleasesBatch,
  runDeterministicSieve
};

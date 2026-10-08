const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

function getGeminiToken() {
    try {
        const secretsPath = path.join(__dirname, '../../configs/secrets.json');
        const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
        return secrets.geminiToken;
    } catch (e) {
        console.error("Could not read geminiToken from configs/secrets.json");
        return null;
    }
}

async function extractReleasesWithAI(articleText) {
    const token = getGeminiToken();
    if (!token) return [];

    // Gemini Free Tier in 2026 has a limit of 5 requests per minute.
    // We add a 12.5 second delay before every request to perfectly respect this limit.
    await new Promise(r => setTimeout(r, 12500));

    const prompt = `You are a music data extraction bot.
Extract all the new music releases mentioned in the following article text.
Return ONLY a valid JSON array of objects. Do not include any other text, markdown formatting, or explanations.
Each object must have these exact keys:
- "artist": The name of the artist/band (string)
- "title": The name of the song/album/EP (string)
- "releaseType": Either "single", "ep", or "album" (string)
- "genres": A comma-separated list of genres explicitly mentioned for the track (string, or null if none)

Article Text:
${articleText.substring(0, 15000)}`;

    const genAI = new GoogleGenerativeAI(token);
    const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });

    let attempts = 0;
    while (attempts < 3) {
        try {
            const result = await model.generateContent({
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.1,
                    responseMimeType: "application/json",
                }
            });

            let generatedText = result.response.text().trim();
            const jsonMatch = generatedText.match(/\[\s*\{[\s\S]*\}\s*\]/);
            
            if (jsonMatch) {
                const parsedData = JSON.parse(jsonMatch[0]);
                return Array.isArray(parsedData) ? parsedData : [];
            } else {
                try {
                    const parsedData = JSON.parse(generatedText);
                    return Array.isArray(parsedData) ? parsedData : [parsedData];
                } catch (e) {
                    console.warn("AI did not return a valid JSON array. RAW AI OUTPUT:", generatedText.substring(0, 500));
                    return [];
                }
            }
        } catch (e) {
            attempts++;
            if (e.message.includes("503") || e.message.includes("429")) {
                console.log(`[Gemini API] Error: ${e.message}. Retrying in 35s...`);
                await new Promise(r => setTimeout(r, 35000));
            } else {
                console.error("Failed to extract releases with Gemini (SDK Error):", e.message);
                return [];
            }
        }
    }
    console.error("Failed to extract releases with Gemini after 3 attempts.");
    return [];
}

async function verifyArtistOriginWithAI(artistName, label) {
    const token = getGeminiToken();
    if (!token) return { is_target_region: false, origin_country: null, confidence: "low", reasoning: "No Gemini token found" };

    // Gemini Free Tier in 2026 has a limit of 5 requests per minute.
    await new Promise(r => setTimeout(r, 12500));

    const prompt = `You are a music industry data validation agent. 
I will provide an Artist Name and a Record Label.
Your job is to determine if this artist is primarily based in or originating from Ireland, Australia, or New Zealand.
You must return your response as a strict JSON object matching this schema:
{
  "is_target_region": boolean,
  "origin_country": "string (or null)",
  "confidence": "high/medium/low",
  "reasoning": "brief 1-sentence explanation"
}

Input:
Artist: ${artistName}
Label: ${label}`;

    const genAI = new GoogleGenerativeAI(token);
    const model = genAI.getGenerativeModel({ model: "gemini-3.5-flash" });

    let attempts = 0;
    while (attempts < 3) {
        try {
            const result = await model.generateContent({
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.1,
                    responseMimeType: "application/json",
                }
            });

            let generatedText = result.response.text().trim();
            const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
            
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            } else {
                return JSON.parse(generatedText);
            }
        } catch (e) {
            attempts++;
            if (e.message.includes("503") || e.message.includes("429")) {
                console.log(`[Gemini API] Error: ${e.message}. Retrying in 35s...`);
                await new Promise(r => setTimeout(r, 35000));
            } else {
                console.error("Failed to verify artist origin with Gemini (SDK Error):", e.message);
                return { is_target_region: false, origin_country: null, confidence: "low", reasoning: "SDK Error" };
            }
        }
    }
    console.error("Failed to verify artist origin after 3 attempts.");
    return { is_target_region: false, origin_country: null, confidence: "low", reasoning: "API limit exceeded" };
}

module.exports = { extractReleasesWithAI, verifyArtistOriginWithAI };

/**
 * Parses YouTube's relative time string (e.g., "2 weeks ago") 
 * and checks if it falls within maxDays.
 */
function isRecentText(uploadedAt, maxDays) {
    if (!uploadedAt) return false;
    const lower = uploadedAt.toLowerCase();
    
    if (lower.includes('second') || lower.includes('minute') || lower.includes('hour')) {
        return true;
    }
    
    if (lower.includes('day')) {
        const match = lower.match(/(\d+)\s+day/);
        if (match) {
            return parseInt(match[1], 10) <= maxDays;
        }
        return true; // e.g. "a day ago"
    }
    
    if (lower.includes('week')) {
        const match = lower.match(/(\d+)\s+week/);
        if (match) {
            return (parseInt(match[1], 10) * 7) <= maxDays;
        }
        return 7 <= maxDays;
    }
    
    if (lower.includes('month')) {
        const match = lower.match(/(\d+)\s+month/);
        if (match) {
            return (parseInt(match[1], 10) * 30) <= maxDays;
        }
        return 30 <= maxDays;
    }
    
    if (lower.includes('year')) {
        return false;
    }
    
    return false;
}

/**
 * Checks if the given text contains any excluded keywords or banned artists.
 */
function isExcluded(text, exclusions = {}) {
    const lowerText = (text || "").toLowerCase();
    const allKeywords = [
        ...(exclusions.keywords || []),
        ...(exclusions.negativeKeywords || []),
        ...(exclusions.bannedArtists || []),
        ...(exclusions.artists || [])
    ];
    return allKeywords.some(kw => {
        const k = (kw || "").toLowerCase().trim();
        if (!k) return false;
        if (k.length <= 3) {
            const reg = new RegExp(`\\b${k.replace('.', '\\.')}\\b`, 'i');
            return reg.test(lowerText);
        }
        return lowerText.includes(k);
    });
}

module.exports = {
    isRecentText,
    isExcluded
};

const puppeteer = require('puppeteer');
const { LINUX_CHROME_UA } = require('../utils/browserHeaders');
const { checkReleaseFreshnessITunes } = require('../services/verificationTools');

async function runAirChartAgent(config = {}, exclusions = {}) {
    const freshWindowDays = config.freshWindowDays || 7;
    const filterStale = config.filterStale !== false;
    const filterUnverified = config.filterUnverified === true;
    console.log(`[AIR Chart Agent] Starting extraction from AIR Charts (window: ${freshWindowDays}d)...`);
    
    let browser;
    const rawDebuts = [];
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--single-process'
            ]
        });
        const page = await browser.newPage();
        await page.setUserAgent(LINUX_CHROME_UA);
        
        console.log(`[AIR Chart Agent] Navigating to https://air.org.au/charts`);
        await page.goto('https://air.org.au/charts', { waitUntil: 'networkidle2' });
        
        // Find chart category links
        const categoryLinks = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            return links
                .map(a => a.href)
                .filter(href => href.includes('/charts/') && 
                    (href.includes('100-independent-albums') || 
                     href.includes('100-independent-singles') || 
                     href.includes('independent-label-albums') || 
                     href.includes('independent-label-singles')));
        });
        
        // Deduplicate links
        const uniqueLinks = [...new Set(categoryLinks)];
        console.log(`[AIR Chart Agent] Found ${uniqueLinks.length} category links.`);
        
        for (const link of uniqueLinks) {
            console.log(`[AIR Chart Agent] Scraping category: ${link}`);
            await page.goto(link, { waitUntil: 'networkidle2' });
            
            const categoryResults = await page.evaluate(() => {
                const items = [];
                const h3s = document.querySelectorAll('h3[title="Title"]');
                for (let h3 of h3s) {
                    let container = h3.parentElement;
                    while (container && container.innerText.indexOf('Last Week') === -1) {
                        container = container.parentElement;
                    }
                    if (container) {
                        const text = container.innerText;
                        // Match "Last Week \n New" and "Time In The Charts \n 1"
                        if (/Last Week\s*New/i.test(text) && /Time In The Charts\s*1\b/i.test(text)) {
                            const artist = container.querySelector('h4[title="Artist"]')?.innerText || 'Unknown Artist';
                            items.push({
                                title: h3.innerText,
                                artist: artist,
                                url: window.location.href
                            });
                        }
                    }
                }
                return items;
            });
            
            for (const item of categoryResults) {
                let categoryName = "AIR Chart";
                if (link.includes('100-independent-albums')) categoryName = "100% Independent Albums";
                else if (link.includes('100-independent-singles')) categoryName = "100% Independent Singles";
                else if (link.includes('independent-label-albums')) categoryName = "Independent Label Albums";
                else if (link.includes('independent-label-singles')) categoryName = "Independent Label Singles";

                const formattedTitle = `${item.artist} - ${item.title}`;
                const isDuplicate = rawDebuts.some(r => r.formattedTitle === formattedTitle);
                
                if (!isDuplicate) {
                    rawDebuts.push({
                        artist: item.artist,
                        title: item.title,
                        formattedTitle,
                        categoryName,
                        url: item.url
                    });
                } else {
                    console.log(`[AIR Chart Agent] Skipping duplicate entry: ${formattedTitle}`);
                }
            }
        }
        
    } catch (error) {
        console.error('[AIR Chart Agent] Error during scraping:', error);
    } finally {
        if (browser) {
            await browser.close();
        }
    }

    // Verify true release dates against iTunes so old chart debuts & reissues are filtered
    const results = [];
    let droppedStale = 0;
    let droppedUnverified = 0;

    for (const item of rawDebuts) {
        const freshness = await checkReleaseFreshnessITunes(item.artist, item.title, freshWindowDays);
        if (filterStale && freshness.status === 'stale') {
            droppedStale++;
            continue;
        }
        if (filterUnverified && freshness.status === 'unverified') {
            droppedUnverified++;
            continue;
        }

        const releaseDate = freshness.earliestReleaseDate || null;
        results.push({
            title: item.formattedTitle,
            channel: item.categoryName,
            url: item.url,
            views: "New Entry",
            uploadedAt: releaseDate,
            releaseDate,
            description: `New to ${item.categoryName} (Time in Charts: 1)${releaseDate ? ` | Released: ${releaseDate}` : ''}.`
        });
    }

    console.log(
        `[AIR Chart Agent] Freshness Gate: kept ${results.length}/${rawDebuts.length} debuts ` +
        `(filtered ${droppedStale} stale > ${freshWindowDays}d` +
        (filterUnverified ? `, ${droppedUnverified} unverified` : '') + ').'
    );
    
    return results;
}

module.exports = {
    runAirChartAgent
};

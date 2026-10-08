const puppeteer = require('puppeteer');

async function runAirChartAgent(config, exclusions) {
    console.log(`[AIR Chart Agent] Starting extraction from AIR Charts...`);
    
    let browser;
    const results = [];
    try {
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
        const page = await browser.newPage();
        
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
            
            // Format to match old agent structure
            for (const item of categoryResults) {
                // Determine category from URL
                let categoryName = "AIR Chart";
                if (link.includes('100-independent-albums')) categoryName = "100% Independent Albums";
                else if (link.includes('100-independent-singles')) categoryName = "100% Independent Singles";
                else if (link.includes('independent-label-albums')) categoryName = "Independent Label Albums";
                else if (link.includes('independent-label-singles')) categoryName = "Independent Label Singles";

                const formattedTitle = `${item.artist} - ${item.title}`;

                // Check if this song is already in the results
                const isDuplicate = results.some(r => r.title === formattedTitle);
                
                if (!isDuplicate) {
                    results.push({
                        title: formattedTitle,
                        channel: categoryName,
                        url: item.url,
                        views: "New Entry",
                        uploadedAt: "This Week",
                        description: `New to ${categoryName} this week (Time in Charts: 1).`
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
    
    return results;
}

module.exports = {
    runAirChartAgent
};

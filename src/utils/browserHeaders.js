/**
 * Standard authentic browser headers utility for Linux residential scrapers.
 * Replaces obsolete 'music-release-agent/1.0' bot headers that trigger Cloudflare / WAF 403s.
 */

const LINUX_CHROME_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const LINUX_FIREFOX_UA = "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0";

const DEFAULT_HEADERS = {
  "User-Agent": LINUX_CHROME_UA,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Sec-Ch-Ua": '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Linux"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1"
};

function getBrowserHeaders(overrides = {}) {
  return {
    ...DEFAULT_HEADERS,
    ...overrides
  };
}

function getJsonHeaders(overrides = {}) {
  return {
    "User-Agent": LINUX_CHROME_UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Ch-Ua": '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Linux"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    ...overrides
  };
}

function getRssHeaders(overrides = {}) {
  return {
    "User-Agent": LINUX_CHROME_UA,
    "Accept": "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    ...overrides
  };
}

module.exports = {
  LINUX_CHROME_UA,
  LINUX_FIREFOX_UA,
  DEFAULT_HEADERS,
  getBrowserHeaders,
  getJsonHeaders,
  getRssHeaders
};

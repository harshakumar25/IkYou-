/**
 * Edge Anti-Detection & Stealth Request Engine
 * Provides authentic browser header emulation, client-hint synchronization,
 * and adaptive rate-limiting mitigation for edge scraping workers.
 */

const MODERN_PROFILES = [
  {
    name: "Chrome Desktop macOS",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    secChUa: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    secChUaPlatform: '"macOS"',
    secChUaMobile: "?0"
  },
  {
    name: "Chrome Desktop Windows",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    secChUa: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    secChUaPlatform: '"Windows"',
    secChUaMobile: "?0"
  },
  {
    name: "Safari Desktop macOS",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1.1 Safari/605.1.15",
    secChUa: null,
    secChUaPlatform: null,
    secChUaMobile: null
  }
];

/**
 * Build authentic headers matching a real browser profile
 * @param {object} [customHeaders] - Additional headers to overlay
 * @param {number} [profileIndex] - Index of profile to use
 * @returns {Headers} Standard web Headers object
 */
export function buildStealthHeaders(customHeaders = {}, profileIndex = 0) {
  const profile = MODERN_PROFILES[profileIndex % MODERN_PROFILES.length];
  const h = new Headers();

  // 1. Client Hints (Chrome)
  if (profile.secChUa) {
    h.set("sec-ch-ua", profile.secChUa);
    h.set("sec-ch-ua-mobile", profile.secChUaMobile);
    h.set("sec-ch-ua-platform", profile.secChUaPlatform);
  }

  // 2. Standard Browser Navigation & Content Headers
  h.set("Upgrade-Insecure-Requests", "1");
  h.set("User-Agent", profile.userAgent);
  h.set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7");
  h.set("Sec-Fetch-Site", "none");
  h.set("Sec-Fetch-Mode", "navigate");
  h.set("Sec-Fetch-User", "?1");
  h.set("Sec-Fetch-Dest", "document");
  h.set("Accept-Language", "en-US,en;q=0.9");
  h.set("Accept-Encoding", "gzip, deflate, br, zstd");
  h.set("Connection", "keep-alive");

  // Overlay custom headers
  for (const [k, v] of Object.entries(customHeaders)) {
    if (v !== undefined && v !== null) {
      h.set(k, v);
    }
  }

  return h;
}

/**
 * Execute an edge stealth fetch with exponential backoff and jitter.
 * @param {string} url - Target URL
 * @param {object} options - Fetch options
 * @param {number} maxRetries - Maximum retry count (default 2)
 * @returns {Promise<Response>}
 */
export async function stealthFetch(url, options = {}, maxRetries = 2) {
  let attempt = 0;
  const timeoutMs = options.timeoutMs || 7000;

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const mergedSignal = options.signal
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal;

      const headers = options.headers instanceof Headers
        ? options.headers
        : buildStealthHeaders(options.headers || {}, attempt);

      const res = await fetch(url, {
        method: options.method || "GET",
        headers,
        signal: mergedSignal,
        redirect: options.redirect || "follow"
      });

      clearTimeout(timeoutId);

      // Handle Rate Limiting (429) or Temporary Service Unavailable (503)
      if ((res.status === 429 || res.status === 503) && attempt < maxRetries) {
        const retryAfterHeader = res.headers.get("retry-after");
        const retryDelay = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : 0;
        // Exponential backoff: 500ms, 1200ms + random jitter
        const delay = Math.max(retryDelay, Math.pow(2, attempt) * 500 + Math.random() * 300);
        await new Promise(r => setTimeout(r, delay));
        attempt++;
        continue;
      }

      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      if (attempt >= maxRetries || options.signal?.aborted) {
        throw err;
      }
      attempt++;
      await new Promise(r => setTimeout(r, 400 + Math.random() * 200));
    }
  }

  throw new Error(`Stealth fetch exceeded ${maxRetries} retries for ${url}`);
}

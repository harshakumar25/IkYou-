import crypto from "node:crypto";

const DEFAULT_SECRET = "local_fingerprint_edge_master_secret_key_2026";

/**
 * Base64URL encode buffer
 */
function toBase64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

/**
 * Base64URL decode string
 */
function fromBase64Url(str) {
  return Buffer.from(str, "base64url");
}

/**
 * Mint a cryptographically signed fp_did Edge Cookie Token
 * Exact reverse-engineered format: v1.<16_bytes_did>.<timestamp>.<32_bytes_hmac_sha256>
 * @param {string} [deviceId] - Optional existing 16-byte hex device ID
 * @param {string} [secret] - HMAC secret key
 * @returns {string} Signed fp_did cookie value
 */
export function mintDeviceToken(deviceId = null, secret = DEFAULT_SECRET) {
  const didBytes = deviceId ? Buffer.from(deviceId, "hex") : crypto.randomBytes(16);
  const didB64 = toBase64Url(didBytes);
  const timestamp = Math.floor(Date.now() / 1000);

  const payload = `v1.${didB64}.${timestamp}`;
  const hmac = crypto.createHmac("sha256", secret).update(payload).digest();
  const sigB64 = toBase64Url(hmac);

  return `${payload}.${sigB64}`;
}

/**
 * Verify and parse an incoming fp_did Edge Cookie Token
 * @param {string} token - The fp_did cookie string
 * @param {string} [secret] - HMAC secret key
 * @returns {{ valid: boolean, version: string, deviceId: string, timestamp: number, ageSeconds: number }}
 */
export function verifyDeviceToken(token, secret = DEFAULT_SECRET) {
  if (!token || typeof token !== "string") {
    return { valid: false, error: "Missing token" };
  }

  const parts = token.split(".");
  if (parts.length !== 4) {
    return { valid: false, error: "Invalid token structure" };
  }

  const [version, didB64, timestampStr, sigB64] = parts;
  if (version !== "v1") {
    return { valid: false, error: "Unsupported token version" };
  }

  const payload = `${version}.${didB64}.${timestampStr}`;
  const expectedHmac = crypto.createHmac("sha256", secret).update(payload).digest();
  const actualHmac = fromBase64Url(sigB64);

  if (actualHmac.length !== 32 || !crypto.timingSafeEqual(expectedHmac, actualHmac)) {
    return { valid: false, error: "HMAC signature mismatch (tampering detected)" };
  }

  const didBytes = fromBase64Url(didB64);
  const timestamp = parseInt(timestampStr, 10);
  const now = Math.floor(Date.now() / 1000);

  return {
    valid: true,
    version,
    deviceId: didBytes.toString("hex"),
    timestamp,
    ageSeconds: Math.max(0, now - timestamp)
  };
}

/**
 * Analyze passive HTTP edge signals:
 * - Header ordering fingerprint (Chrome vs Firefox vs Safari vs Bot/Curl)
 * - Client Hints consistency
 * - Bot / Automation indicators
 * @param {Headers|object} headers - Incoming HTTP headers
 * @param {string} [clientIp] - Client remote IP address
 */
export function analyzePassiveEdgeSignals(headers, clientIp = "127.0.0.1") {
  const getHeader = (name) => {
    if (headers instanceof Headers) return headers.get(name) || "";
    return headers[name.toLowerCase()] || headers[name] || "";
  };

  const userAgent = getHeader("user-agent");
  const secChUa = getHeader("sec-ch-ua");
  const secChUaPlatform = getHeader("sec-ch-ua-platform");
  const secFetchDest = getHeader("sec-fetch-dest");
  const secFetchMode = getHeader("sec-fetch-mode");
  const secFetchSite = getHeader("sec-fetch-site");
  const acceptLanguage = getHeader("accept-language");
  const acceptEncoding = getHeader("accept-encoding");

  // Header order hash (extract raw keys)
  const headerKeys = headers instanceof Headers
    ? Array.from(headers.keys())
    : Object.keys(headers).map(k => k.toLowerCase());
  const headerOrderFingerprint = crypto.createHash("md5").update(headerKeys.join(":")).digest("hex");

  // Bot & Automation Heuristics
  let botScore = 0;
  const detectionFlags = [];

  // Check 1: Known bot or automation User-Agents
  if (/HeadlessChrome|PhantomJS|curl|wget|python|aiohttp|go-http-client|axios|undici/i.test(userAgent)) {
    botScore += 0.8;
    detectionFlags.push("Automated scraper or headless User-Agent detected");
  }

  // Check 2: Chrome claims in User-Agent but missing sec-ch-ua client hints
  if (userAgent.includes("Chrome/") && !userAgent.includes("Mobile") && !secChUa) {
    botScore += 0.4;
    detectionFlags.push("User-Agent claims Chrome desktop but lacks Sec-CH-UA client hints");
  }

  // Check 3: Missing standard browser Accept-Language
  if (!acceptLanguage) {
    botScore += 0.3;
    detectionFlags.push("Missing Accept-Language header typical of automated CLI clients");
  }

  // Check 4: Missing Sec-Fetch-* metadata in modern browser user agent
  if (userAgent.includes("Mozilla/5.0") && !secFetchDest && !secFetchMode) {
    botScore += 0.25;
    detectionFlags.push("Missing modern Sec-Fetch-* lifecycle headers");
  }

  const isBot = botScore >= 0.5;

  return {
    clientIp,
    userAgent,
    secChUa,
    secChUaPlatform,
    headerOrderFingerprint,
    headerCount: headerKeys.length,
    botScore: Number(botScore.toFixed(2)),
    isBot,
    detectionFlags,
    tlsVersion: getHeader("cf-tls-version") || getHeader("x-forwarded-tls-version") || "TLS 1.3",
    tlsCipher: getHeader("cf-tls-cipher") || getHeader("x-forwarded-tls-cipher") || "TLS_AES_128_GCM_SHA256",
    ja3Hash: getHeader("cf-ja3-hash") || getHeader("x-forwarded-ja3") || "00000000000000000000000000000000"
  };
}

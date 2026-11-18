/**
 * Advanced Recursive Dig Engine
 * Extracts social media handles, emails, phone numbers, personal websites,
 * cryptocurrency addresses, PGP keys, and federated identities from profile metadata.
 */

// Social platform regexes
const SOCIAL_URL_PATTERNS = [
  { platform: "Twitter", regex: /(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,15})\b/i, type: "username" },
  { platform: "GitHub", regex: /github\.com\/([a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38})\b/i, type: "username" },
  { platform: "Instagram", regex: /instagram\.com\/([a-zA-Z0-9_.]+)\b/i, type: "username" },
  { platform: "Reddit", regex: /reddit\.com\/(?:user|u)\/([a-zA-Z0-9_-]+)\b/i, type: "username" },
  { platform: "YouTube", regex: /youtube\.com\/@([a-zA-Z0-9_.-]+)\b/i, type: "username" },
  { platform: "Telegram", regex: /t\.me\/([a-zA-Z0-9_]{5,32})\b/i, type: "username" },
  { platform: "Twitch", regex: /twitch\.tv\/([a-zA-Z0-9_]{4,25})\b/i, type: "username" },
  { platform: "LinkedIn", regex: /linkedin\.com\/in\/([a-zA-Z0-9_-]+)\b/i, type: "username" },
  { platform: "Medium", regex: /medium\.com\/@([a-zA-Z0-9_.-]+)\b/i, type: "username" },
  { platform: "Steam", regex: /steamcommunity\.com\/id\/([a-zA-Z0-9_]+)\b/i, type: "username" },
  { platform: "SoundCloud", regex: /soundcloud\.com\/([a-zA-Z0-9_-]+)\b/i, type: "username" },
  { platform: "Pinterest", regex: /pinterest\.com\/([a-zA-Z0-9_]+)\b/i, type: "username" },
  { platform: "Substack", regex: /([a-zA-Z0-9_-]+)\.substack\.com\b/i, type: "username" },
  { platform: "Bluesky", regex: /(?:bsky\.app\/profile\/|@)?([a-zA-Z0-9_.-]+\.bsky\.social)\b/i, type: "username" },
  { platform: "Linktree", regex: /linktr\.ee\/([a-zA-Z0-9_.-]+)\b/i, type: "username" },
  { platform: "TikTok", regex: /tiktok\.com\/@([a-zA-Z0-9_.-]+)\b/i, type: "username" }
];

// Cryptocurrency regexes
const CRYPTO_PATTERNS = [
  { currency: "Bitcoin (BTC)", regex: /\b(bc1[a-zA-HJ-NP-Z0-9]{25,39}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g },
  { currency: "Ethereum (ETH/EVM)", regex: /\b(0x[a-fA-F0-9]{40})\b/g },
  { currency: "Solana (SOL)", regex: /\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/g },
  { currency: "Monero (XMR)", regex: /\b(4[0-9AB][1-9A-HJ-NP-Za-km-z]{93})\b/g }
];

// PGP Key fingerprints
const PGP_KEY_REGEX = /\b([0-9a-fA-F]{8,40})\b/g;

const IGNORE_HANDLES = new Set([
  "gmail", "yahoo", "hotmail", "outlook", "icloud", "proton", "protonmail",
  "support", "admin", "contact", "info", "help", "security", "team", "sales",
  "home", "about", "blog", "dev", "app", "api", "status", "legal", "terms", "privacy",
  "null", "undefined", "true", "false", "none", "here", "everyone", "channel",
  "official", "newsletter", "feedback", "careers", "jobs", "press"
]);

function unescapeHtmlEntities(str) {
  if (!str || typeof str !== "string") return "";
  return str
    .replace(/&#064;/g, "@")
    .replace(/&#64;/g, "@")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * Extract discovered handles, emails, crypto addresses, and correlated leads from a platform result.
 * @param {object} result - Fingerprint result object
 * @param {string} [digType="both"] - "username" | "email" | "both"
 * @returns {Array<{username: string, foundOn: string, from: string, queryType: string, confidence: number, entityType: string}>}
 */
export function extractDigLeads(result, digType = "both") {
  const discovered = [];
  const seen = new Set();
  const currentUsername = (result.username || "").toLowerCase();

  const addLead = (identifier, foundOn, queryType = "username", confidence = 0.95, entityType = "handle") => {
    const clean = identifier.replace(/^@+/, "").trim();
    const lower = clean.toLowerCase();
    if (!clean || IGNORE_HANDLES.has(lower) || clean.length < 3) return;

    // Suppress self-mentions on the same platform, but preserve verified cross-platform proofs & social links
    if (lower === currentUsername && (entityType === "handle" || entityType === "bio_mention")) return;

    // Filter by requested digType
    if (digType === "username" && queryType !== "username") return;
    if (digType === "email" && queryType !== "email") return;

    const key = `${queryType}:${lower}`;
    if (seen.has(key)) return;
    seen.add(key);

    discovered.push({
      username: clean,
      foundOn,
      from: result.username,
      queryType,
      confidence,
      entityType
    });
  };

  // 1. Existing verified proofs (e.g. Keybase, DevTo, GitHub)
  if (Array.isArray(result.discoveredUsernames)) {
    for (const item of result.discoveredUsernames) {
      if (item.username) {
        addLead(item.username, item.foundOn || result.platform, item.queryType || "username", 0.99, item.entityType || "verified_proof");
      }
    }
  }

  // 2. Build text corpus for entity scanning with unescaped HTML entities
  const rawCorpus = [
    result.bio || "",
    result.website || "",
    result.location || "",
    result.displayName || "",
    JSON.stringify(result.extras || {})
  ].join(" ");

  const textCorpus = unescapeHtmlEntities(rawCorpus);

  // 3. Scan for explicit Social Media URLs using global matching
  for (const { platform, regex, type } of SOCIAL_URL_PATTERNS) {
    const globalRegex = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
    const matches = textCorpus.matchAll(globalRegex);
    for (const match of matches) {
      if (match && match[1]) {
        addLead(match[1], `${platform} (via ${result.platform})`, type, 0.95, "social_link");
      }
    }
  }

  // 4. Scan for @mentions in biography: @handle (negative lookbehind avoids email domain matching)
  const mentionMatches = textCorpus.matchAll(/(?<![a-zA-Z0-9._%+-])@([a-zA-Z0-9_]{3,30})\b/g);
  for (const m of mentionMatches) {
    addLead(m[1], `${result.platform} Bio @mention`, "username", 0.85, "bio_mention");
  }

  // 5. Scan for email addresses
  const emailMatches = textCorpus.matchAll(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g);
  for (const em of emailMatches) {
    addLead(em[1], `${result.platform} Bio Email`, "email", 0.98, "email");
  }

  // 6. Scan for Cryptocurrency Wallets
  for (const { currency, regex } of CRYPTO_PATTERNS) {
    const cryptoMatches = textCorpus.matchAll(regex);
    for (const cm of cryptoMatches) {
      const address = cm[1];
      if (!seen.has(address) && address.length >= 26) {
        seen.add(address);
        discovered.push({
          username: address,
          foundOn: `${result.platform} (${currency})`,
          from: result.username,
          queryType: "crypto",
          confidence: 0.99,
          entityType: "crypto_wallet"
        });
      }
    }
  }

  // 7. Generic Outlink & Outlink Array Extraction
  const urlMatches = textCorpus.matchAll(/(https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?::\d+)?(?:\/[^\s"<>]*)?)/gi);
  if (!result.extras) result.extras = {};
  if (!Array.isArray(result.extras.outlinks)) result.extras.outlinks = [];

  for (const um of urlMatches) {
    const url = (um[1] || "").replace(/[.,;:!?)]+$/, "");
    if (url && !result.extras.outlinks.includes(url)) {
      result.extras.outlinks.push(url);
    }
  }

  // Also scan all outlinks with SOCIAL_URL_PATTERNS
  for (const outlink of result.extras.outlinks) {
    for (const { platform, regex, type } of SOCIAL_URL_PATTERNS) {
      const match = outlink.match(regex);
      if (match && match[1]) {
        addLead(match[1], `${platform} (via Outlink)`, type, 0.95, "social_link");
      }
    }
  }

  return discovered;
}

/**
 * Calculate correlation confidence score between two identities
 * @param {object} profileA
 * @param {object} profileB
 * @returns {number} Float 0.0 - 1.0
 */
export function calculateIdentityConfidence(profileA, profileB) {
  let score = 0;

  // Exact username match
  if (profileA.username.toLowerCase() === profileB.username.toLowerCase()) {
    score += 0.5;
  }

  // Display name similarity
  if (profileA.displayName && profileB.displayName) {
    if (profileA.displayName.toLowerCase() === profileB.displayName.toLowerCase()) {
      score += 0.25;
    }
  }

  // Shared location
  if (profileA.location && profileB.location) {
    if (profileA.location.toLowerCase().includes(profileB.location.toLowerCase()) ||
        profileB.location.toLowerCase().includes(profileA.location.toLowerCase())) {
      score += 0.15;
    }
  }

  // Shared website or bio keywords
  if (profileA.website && profileB.website && profileA.website === profileB.website) {
    score += 0.3;
  }

  return Math.min(1.0, Number(score.toFixed(2)));
}

/**
 * Forensic Email, Phone & Domain Intelligence Resolver
 * Performs deep infrastructure reconnaissance:
 * 1. DNS MX Mail Server Resolution & Mail Provider Fingerprinting (Google Workspace, M365, Proton, etc.)
 * 2. Gravatar Profile & Universal Avatar Hash Discovery (MD5 of email)
 * 3. Linguistic & Token Deconstruction (e.g. jhah1225 -> Surname: jha, Initial: h, Date/Number: 1225)
 * 4. Dynamic Feedback Loop: Expands target identity seeds with newly recovered forensic leads.
 */

import dns from "node:dns";
import crypto from "node:crypto";

const dnsPromises = dns.promises;

/**
 * Resolve MX records and fingerprint the mail provider
 * @param {string} domain
 * @returns {Promise<{provider: string, mxRecords: Array<{exchange: string, priority: number}>}>}
 */
export async function resolveMailProvider(domain) {
  try {
    const mx = await dnsPromises.resolveMx(domain);
    mx.sort((a, b) => a.priority - b.priority);

    let provider = "Custom Mail Server";
    const exchanges = mx.map(m => m.exchange.toLowerCase()).join(" ");

    if (exchanges.includes("google") || exchanges.includes("gmail") || exchanges.includes("aspmx")) {
      provider = "Google Workspace / Gmail";
    } else if (exchanges.includes("outlook") || exchanges.includes("microsoft") || exchanges.includes("hotmail")) {
      provider = "Microsoft 365 / Outlook";
    } else if (exchanges.includes("protonmail") || exchanges.includes("proton")) {
      provider = "ProtonMail (End-to-End Encrypted)";
    } else if (exchanges.includes("icloud") || exchanges.includes("apple")) {
      provider = "Apple iCloud Mail";
    } else if (exchanges.includes("zoho")) {
      provider = "Zoho Mail";
    }

    return { provider, mxRecords: mx };
  } catch (err) {
    return { provider: "No MX Records / Invalid Domain", mxRecords: [], error: err.message };
  }
}

/**
 * Perform forensic email reconnaissance (MX provider, Gravatar, Token decomposition)
 * @param {string} email
 * @returns {Promise<object>}
 */
export async function analyzeEmailForensics(email) {
  const cleanEmail = email.trim().toLowerCase();
  const parts = cleanEmail.split("@");
  if (parts.length !== 2) {
    return { email: cleanEmail, valid: false };
  }

  const [localPart, domain] = parts;

  // 1. Compute MD5 Gravatar Hash
  const gravatarHash = crypto.createHash("md5").update(cleanEmail).digest("hex");
  const gravatarUrl = `https://en.gravatar.com/${gravatarHash}.json`;

  let gravatarData = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const gRes = await fetch(gravatarUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    clearTimeout(timer);

    if (gRes.ok) {
      const gJson = await gRes.json();
      if (gJson.entry && gJson.entry[0]) {
        const entry = gJson.entry[0];
        gravatarData = {
          displayName: entry.displayName || null,
          preferredUsername: entry.preferredUsername || null,
          profileUrl: entry.profileUrl || null,
          aboutMe: entry.aboutMe || null,
          currentLocation: entry.currentLocation || null,
          photos: (entry.photos || []).map(p => p.value),
          verifiedAccounts: (entry.accounts || []).map(a => ({
            domain: a.domain,
            display: a.display,
            url: a.url,
            username: a.username
          }))
        };
      }
    }
  } catch {}

  // 2. DNS MX Provider Inspection
  const mailProviderInfo = await resolveMailProvider(domain);

  // 3. Deconstruct Localpart into Linguistic & Semantic Tokens
  const tokens = [];
  const numbers = [];

  // Extract trailing or embedded numbers (e.g. 1225, 25, 1998)
  const numMatches = localPart.match(/\d+/g);
  if (numMatches) {
    for (const n of numMatches) {
      numbers.push(n);
    }
  }

  // Extract alphabetical components
  const alphaPart = localPart.replace(/\d+/g, "");
  if (alphaPart.length >= 3) {
    tokens.push(alphaPart);
  }

  return {
    email: cleanEmail,
    localPart,
    domain,
    mailProvider: mailProviderInfo.provider,
    mxRecords: mailProviderInfo.mxRecords,
    gravatarHash,
    gravatar: gravatarData,
    extractedTokens: {
      alpha: tokens,
      numbers
    }
  };
}

/**
 * Feeds newly recovered forensic tokens back into an existing seed profile to expand pivoting scope.
 * @param {object} baseSeeds
 * @param {object[]} recoveredLeads
 * @returns {object} Updated seed profile
 */
export function expandSeedsWithForensics(baseSeeds, recoveredLeads) {
  const updated = {
    firstName: baseSeeds.firstName,
    lastName: baseSeeds.lastName,
    nicknames: [...(baseSeeds.nicknames || [])],
    numbers: [...(baseSeeds.numbers || [])],
    keywords: [...(baseSeeds.keywords || [])],
    location: baseSeeds.location || ""
  };

  const nickSet = new Set(updated.nicknames.map(n => n.toLowerCase()));
  const numSet = new Set(updated.numbers.map(String));

  for (const lead of recoveredLeads) {
    if (lead.queryType === "email" && lead.username.includes("@")) {
      const local = lead.username.split("@")[0].toLowerCase();
      // Add local part as nickname lead
      if (!nickSet.has(local) && local.length >= 3) {
        updated.nicknames.push(local);
        nickSet.add(local);
      }

      // Extract numbers
      const nums = local.match(/\d+/g);
      if (nums) {
        for (const n of nums) {
          if (!numSet.has(n)) {
            updated.numbers.push(n);
            numSet.add(n);
          }
        }
      }
    } else if (lead.queryType === "username") {
      const u = lead.username.toLowerCase();
      if (!nickSet.has(u) && u.length >= 3) {
        updated.nicknames.push(u);
        nickSet.add(u);
      }
    }
  }

  return updated;
}

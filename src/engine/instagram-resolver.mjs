/**
 * Instagram Account Indexer & Reverse Email Resolver
 * Performs deep OSINT discovery connecting email addresses to Instagram accounts:
 * 1. Stealth SSR Probing (bypasses login walls via edge headers)
 * 2. Email Semantic Decomposition & Cross-Platform Correlation (GitHub, Gravatar, Git Patches)
 * 3. REA Headless Browser Evidence Capture (DOM, Viewport Screenshot, User ID, Followers)
 */

import { executeReaScenario } from "../rea-bridge.mjs";
import { analyzeEmailForensics } from "./forensic-resolver.mjs";
import { searchGitHubCommitAuthor } from "./git-provenance.mjs";

/**
 * Estimates account creation date based on Instagram numeric User ID (pk)
 * @param {string|number} userId
 * @returns {object|null}
 */
export function estimateInstagramCreationDate(userId) {
  if (!userId) return null;
  const num = typeof userId === "string" ? parseInt(String(userId).replace(/\D/g, ""), 10) : userId;
  if (!num || isNaN(num) || num <= 0) return null;

  let estimatedYear = 2024;
  let period = "2024+";
  let confidence = "High";

  if (num < 1_000_000) {
    estimatedYear = 2010;
    period = "Late 2010 (Launch Period)";
  } else if (num < 10_000_000) {
    estimatedYear = 2011;
    period = "2011 (Early Adopter)";
  } else if (num < 50_000_000) {
    estimatedYear = 2012;
    period = "2012 (Pre-Facebook Acquisition)";
  } else if (num < 500_000_000) {
    estimatedYear = 2013;
    period = "2013";
  } else if (num < 1_500_000_000) {
    estimatedYear = 2014;
    period = "2014";
  } else if (num < 2_800_000_000) {
    estimatedYear = 2015;
    period = "2015";
  } else if (num < 4_500_000_000) {
    estimatedYear = 2016;
    period = "2016";
  } else if (num < 6_500_000_000) {
    estimatedYear = 2017;
    period = "2017";
  } else if (num < 9_500_000_000) {
    estimatedYear = 2018;
    period = "2018";
  } else if (num < 16_000_000_000) {
    estimatedYear = 2019;
    period = "2019";
  } else if (num < 35_000_000_000) {
    estimatedYear = 2020;
    period = "2020";
  } else if (num < 48_000_000_000) {
    estimatedYear = 2021;
    period = "2021";
  } else if (num < 58_000_000_000) {
    estimatedYear = 2022;
    period = "2022";
  } else if (num < 65_000_000_000) {
    estimatedYear = 2023;
    period = "2023";
  } else {
    estimatedYear = 2024;
    period = "2024+";
    confidence = "Medium";
  }

  const currentYear = new Date().getFullYear();
  const accountAgeYears = Math.max(0, currentYear - estimatedYear);

  return {
    numericId: String(num),
    estimatedYear,
    period,
    accountAgeYears,
    confidence
  };
}

/**
 * Probes an Instagram handle using stealth server-side rendered OpenGraph headers.
 * @param {string} username
 * @returns {Promise<object>}
 */
export async function probeInstagramUser(username) {
  const cleanUser = username.trim().toLowerCase().replace(/^@/, "");
  if (!cleanUser || cleanUser.length < 1 || cleanUser.length > 30) {
    return { exists: false, username: cleanUser };
  }

  const url = `https://www.instagram.com/${cleanUser}/`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });

    if (res.status === 404) {
      return { exists: false, username: cleanUser };
    }

    const text = await res.text();
    const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/&#064;/g, "@").replace(/&amp;/g, "&") : "";

    const notFound = title.includes("Page Not Found") ||
                     title.includes("Profile isn't available") ||
                     title.trim() === "Instagram" ||
                     text.includes("Sorry, this page isn't available");

    if (notFound) {
      return { exists: false, username: cleanUser };
    }

    // 1. Search for embedded JSON structures (xig_user_by_igid_v2, Relay, Polaris)
    let embeddedUser = null;
    const scriptRegex = /<script\s+type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi;
    let scriptMatch;
    while ((scriptMatch = scriptRegex.exec(text)) !== null) {
      const content = scriptMatch[1];
      if (content.includes("xig_user_by_igid_v2") || content.includes('"biography"') || content.includes('"full_name"')) {
        const igidMatch = content.match(/"xig_user_by_igid_v2":\s*(\{[\s\S]*?\})(?:,\s*"(?:xig_logged_out|polaris|require)|$)/);
        if (igidMatch) {
          try {
            embeddedUser = JSON.parse(igidMatch[1]);
            break;
          } catch {}
        }
        try {
          const parsed = JSON.parse(content);
          const candidate = parsed?.require?.[0]?.[3]?.[0]?.__bbox?.result?.data?.user ||
                            parsed?.xig_user_by_igid_v2 ||
                            parsed?.user;
          if (candidate) {
            embeddedUser = candidate;
            break;
          }
        } catch {}
      }
    }

    // 2. Display Name extraction
    let displayName = embeddedUser?.full_name || "";
    if (!displayName) {
      const nameMatch = title.match(/^(.+?)\s*\(@/);
      displayName = nameMatch ? nameMatch[1].trim() : cleanUser;
    }

    // 3. User ID extraction
    let userId = embeddedUser?.pk || embeddedUser?.id || null;
    if (!userId) {
      const idMatch = text.match(/"profile_id":"(\d+)"/) || text.match(/"id":"(\d{5,})"/);
      userId = idMatch ? idMatch[1] : null;
    }

    // 4. Follower metrics extraction
    let followers = (embeddedUser?.follower_count !== undefined && embeddedUser?.follower_count !== null)
      ? String(embeddedUser.follower_count)
      : null;
    let following = (embeddedUser?.following_count !== undefined && embeddedUser?.following_count !== null)
      ? String(embeddedUser.following_count)
      : null;
    let posts = (embeddedUser?.media_count !== undefined && embeddedUser?.media_count !== null)
      ? String(embeddedUser.media_count)
      : null;

    const ogDescMatch = text.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i);
    const ogDesc = ogDescMatch ? ogDescMatch[1].replace(/&amp;/g, "&").replace(/&#064;/g, "@") : "";

    if (ogDesc) {
      const statsMatch = ogDesc.match(/([\d.,KMkm]+)\s*Followers,\s*([\d.,KMkm]+)\s*Following,\s*([\d.,KMkm]+)\s*Posts/i);
      if (statsMatch) {
        if (followers === null) followers = statsMatch[1];
        if (following === null) following = statsMatch[2];
        if (posts === null) posts = statsMatch[3];
      }
    }

    // 5. Clean Biography extraction (separate follower counts from actual bio)
    let bio = embeddedUser?.biography ?? "";
    if (!bio && ogDesc) {
      const bioMatch = ogDesc.match(/on Instagram:\s*"?([\s\S]*?)"?\s*$/i);
      if (bioMatch && bioMatch[1]) {
        bio = bioMatch[1].replace(/^["']/, "").replace(/["']$/, "").replace(/&quot;/g, '"').trim();
      }
    }
    if (bio) {
      bio = bio.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#064;/g, "@").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
    }

    // 6. Avatar URL extraction
    let pfpUrl = embeddedUser?.profile_pic_url_hd || embeddedUser?.profile_pic_url || "";
    if (!pfpUrl) {
      const ogImgMatch = text.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
      pfpUrl = ogImgMatch ? ogImgMatch[1].replace(/&amp;/g, "&") : "";
    }

    // 7. Verification & Privacy Status
    let isVerified = Boolean(embeddedUser?.is_verified);
    if (!isVerified) {
      isVerified = /"is_verified":\s*true/i.test(text);
    }
    let isPrivate = Boolean(embeddedUser?.is_private);
    if (!isPrivate) {
      isPrivate = /"is_private":\s*true/i.test(text);
    }

    // 8. Category & Outlinks
    let category = embeddedUser?.category_name || "";
    if (!category) {
      const catMatch = text.match(/"category_name":"([^"]+)"/) || text.match(/"business_category_name":"([^"]+)"/);
      if (catMatch) category = catMatch[1];
    }

    const outlinksSet = new Set();
    if (embeddedUser?.external_url) {
      outlinksSet.add(embeddedUser.external_url.replace(/\\\//g, "/"));
    }
    if (Array.isArray(embeddedUser?.bio_links)) {
      for (const link of embeddedUser.bio_links) {
        if (link?.url) outlinksSet.add(link.url.replace(/\\\//g, "/"));
      }
    }
    const extMatch = text.match(/"external_url":"([^"]+)"/);
    if (extMatch && extMatch[1] && extMatch[1] !== "null") {
      outlinksSet.add(extMatch[1].replace(/\\\//g, "/"));
    }
    const bioLinkMatches = text.matchAll(/"url":"(https?:\\\/\\\/[^"]+)"/g);
    for (const blm of bioLinkMatches) {
      outlinksSet.add(blm[1].replace(/\\\//g, "/"));
    }
    const isIgnoredAssetUrl = (url) => {
      if (!url || typeof url !== "string") return true;
      const lower = url.toLowerCase();
      if (lower.includes("cdninstagram.com") || lower.includes("fbcdn.net") || lower.includes("rsrc.php")) return true;
      if (lower.includes("instagram.com/static") || lower.includes("facebook.com/tr")) return true;
      if (/\.(js|css|png|jpg|jpeg|gif|woff2?|svg|ico|webp)(\?|$)/i.test(lower)) return true;
      return false;
    };

    const outlinks = Array.from(outlinksSet).filter(u => typeof u === "string" && u.startsWith("http") && !isIgnoredAssetUrl(u));
    const website = outlinks.length > 0 ? outlinks[0] : "";

    // 9. Threads integration
    let threadsHandle = "";
    if (embeddedUser?.threads_profile_glyph_url || embeddedUser?.has_threads_profile || text.includes("threads.net")) {
      const thMatch = text.match(/threads\.net\/@([a-zA-Z0-9_.]+)/i);
      threadsHandle = thMatch ? thMatch[1] : (embeddedUser?.has_threads_profile ? cleanUser : "");
    }

    // 10. Discovered Username Leads
    const discoveredUsernames = [];
    if (threadsHandle) {
      discoveredUsernames.push({
        username: threadsHandle,
        foundOn: "Instagram (Threads)",
        from: cleanUser,
        queryType: "username",
        confidence: 0.98,
        entityType: "handle"
      });
    }
    if (bio) {
      const mentions = bio.matchAll(/@([a-zA-Z0-9_.]{3,30})\b/g);
      for (const m of mentions) {
        const handle = m[1];
        if (handle.toLowerCase() !== cleanUser) {
          discoveredUsernames.push({
            username: handle,
            foundOn: "Instagram Bio @mention",
            from: cleanUser,
            queryType: "username",
            confidence: 0.85,
            entityType: "bio_mention"
          });
        }
      }
    }
    for (const url of outlinks) {
      const ltMatch = url.match(/linktr\.ee\/([a-zA-Z0-9_.-]+)/i);
      if (ltMatch) {
        discoveredUsernames.push({
          username: ltMatch[1],
          foundOn: "Instagram Outlink (Linktree)",
          from: cleanUser,
          queryType: "username",
          confidence: 0.95,
          entityType: "social_link"
        });
      }
      const ghMatch = url.match(/github\.com\/([a-zA-Z0-9_-]+)/i);
      if (ghMatch) {
        discoveredUsernames.push({
          username: ghMatch[1],
          foundOn: "Instagram Outlink (GitHub)",
          from: cleanUser,
          queryType: "username",
          confidence: 0.95,
          entityType: "social_link"
        });
      }
      const xMatch = url.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,15})/i);
      if (xMatch) {
        discoveredUsernames.push({
          username: xMatch[1],
          foundOn: "Instagram Outlink (Twitter)",
          from: cleanUser,
          queryType: "username",
          confidence: 0.95,
          entityType: "social_link"
        });
      }
    }

    // 11. Deep Bio Email and Phone Extraction
    const bioEmails = [];
    const bioPhones = [];
    if (bio) {
      const emailMatches = bio.matchAll(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g);
      for (const em of emailMatches) {
        const foundEm = em[1].toLowerCase();
        if (!bioEmails.includes(foundEm)) {
          bioEmails.push(foundEm);
          discoveredUsernames.push({
            username: foundEm,
            foundOn: "Instagram Bio Contact",
            from: cleanUser,
            queryType: "email",
            confidence: 0.95,
            entityType: "email"
          });
        }
      }
      const phoneMatches = bio.matchAll(/(?:\+?\d{1,4}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}/g);
      for (const pm of phoneMatches) {
        const cleanPhone = pm[0].trim();
        const digits = cleanPhone.replace(/\D/g, "");
        if (digits.length >= 10 && digits.length <= 15 && !bioPhones.includes(cleanPhone)) {
          bioPhones.push(cleanPhone);
          discoveredUsernames.push({
            username: cleanPhone,
            foundOn: "Instagram Bio Phone",
            from: cleanUser,
            queryType: "phone",
            confidence: 0.9,
            entityType: "phone"
          });
        }
      }
    }

    // 12. Account Registration Date Estimation from numeric User ID
    const registrationEst = estimateInstagramCreationDate(userId);

    return {
      exists: true,
      platform: "Instagram",
      username: cleanUser,
      displayName,
      userId,
      profileUrl: `https://www.instagram.com/${cleanUser}`,
      platformUrl: "https://www.instagram.com",
      pfpUrl,
      bio,
      location: "",
      website,
      followers,
      following,
      posts,
      isVerified,
      isPrivate,
      emails: bioEmails,
      phones: bioPhones,
      extras: {
        instagramUserId: userId,
        rawTitle: title,
        category,
        threadsHandle,
        registrationEst,
        outlinks,
        linkedAccounts: threadsHandle
          ? [{ platform: "Threads", username: threadsHandle, url: `https://threads.net/@${threadsHandle}` }]
          : []
      },
      discoveredUsernames
    };
  } catch (err) {
    return { exists: false, username: cleanUser, error: err.message };
  }
}

/**
 * Finds Instagram accounts linked to a target email address through:
 * 1. Email localpart direct probing
 * 2. Semantic token decomposition & phonetic permutations
 * 3. Cross-service correlation (GitHub email lookup, commit patches)
 * 4. Optional Deep REA browser verification with screenshot evidence
 * 
 * @param {string} email - e.g. "jhah1225@gmail.com"
 * @param {object} [options]
 * @param {boolean} [options.deepRea=false]
 * @param {string[]} [options.additionalCandidates=[]]
 * @returns {Promise<Array<object>>}
 */
export async function findInstagramAccountsFromEmail(email, options = {}) {
  const cleanEmail = email.trim().toLowerCase();
  const [localPart] = cleanEmail.split("@");
  if (!localPart) return [];

  const candidateHandles = new Set();
  candidateHandles.add(localPart);

  // 1. Add any caller-provided candidate leads (e.g. from GitHub or seeds)
  if (Array.isArray(options.additionalCandidates)) {
    for (const c of options.additionalCandidates) {
      if (c && typeof c === "string") candidateHandles.add(c.toLowerCase().trim());
    }
  }

  // 2. Semantic Token Decomposition from email localpart (e.g. jhah1225 -> jha, h, 1225)
  const numMatches = localPart.match(/\d+/g) || [];
  const numToken = numMatches[0] || null;
  const alphaPart = localPart.replace(/\d+/g, "");
  const textTokens = [alphaPart];
  if (alphaPart.endsWith("h") && alphaPart.length > 2) {
    textTokens.push(alphaPart.slice(0, -1)); // e.g. jhah -> jha
  }
  try {
    const forensics = analyzeEmailForensics(cleanEmail);
    if (forensics?.extractedTokens?.alpha) {
      for (const a of forensics.extractedTokens.alpha) {
        if (a && a.length >= 3 && !textTokens.includes(a)) textTokens.push(a);
      }
    }
  } catch {}

  // 3. Cross-Platform Pivot: Search GitHub Commits & Users by email to uncover developer username & real name
  try {
    const commitAuthor = await searchGitHubCommitAuthor(cleanEmail);
    if (commitAuthor) {
      if (Array.isArray(commitAuthor.logins)) {
        for (const login of commitAuthor.logins) {
          candidateHandles.add(login.toLowerCase());
        }
      }
      if (Array.isArray(commitAuthor.names)) {
        for (const name of commitAuthor.names) {
          const nameTokens = name.toLowerCase().split(/\s+/);
          const fn = nameTokens[0] || "";
          const ln = nameTokens.slice(1).join("") || "";
          if (fn && numToken) {
            candidateHandles.add(`${fn}${numToken}`);
            candidateHandles.add(`${fn}a${ln}${numToken.slice(-2)}`); // harshakumar25
            candidateHandles.add(`${fn}${ln}${numToken.slice(-2)}`);  // harshkumar25
            candidateHandles.add(`${fn}_${ln}`);
          }
        }
      }
    }

    const ghRes = await fetch(`https://api.github.com/search/users?q=${encodeURIComponent(cleanEmail)}+in:email`, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/vnd.github.v3+json" }
    });
    if (ghRes.ok) {
      const ghData = await ghRes.json();
      if (Array.isArray(ghData.items)) {
        for (const u of ghData.items.slice(0, 3)) {
          if (u.login) candidateHandles.add(u.login.toLowerCase());
        }
      }
    }
  } catch {}

  // 4. Generate high-probability handle permutations for Instagram
  for (const t of textTokens) {
    if (numToken) {
      candidateHandles.add(`${t}${numToken}`);
      candidateHandles.add(`${t}_${numToken}`);
      if (numToken.length === 4 && numToken.startsWith("12")) {
        candidateHandles.add(`${t}25`); // Dec 25 -> 25
      }
    }
  }

  // If known names are passed (e.g. "Harsh Kumar"), add phonetic combinations
  if (options.fullName) {
    const parts = options.fullName.toLowerCase().split(/\s+/);
    const f = parts[0] || "";
    const l = parts[1] || "";
    if (f && numToken) {
      candidateHandles.add(`${f}${numToken}`);
      candidateHandles.add(`${f}a${l}${numToken.slice(-2)}`); // harshakumar25
      candidateHandles.add(`${f}${l}${numToken.slice(-2)}`);  // harshkumar25
    }
  }

  // 5. Concurrently probe candidates on Instagram
  const probePromises = Array.from(candidateHandles).map(u => probeInstagramUser(u));
  const probeResults = await Promise.all(probePromises);
  const foundAccounts = probeResults.filter(r => r.exists);

  // 6. If deepRea is enabled, execute Playwright browser verification on top discovered profiles
  if (options.deepRea) {
    for (const acc of foundAccounts.slice(0, 2)) {
      try {
        const evidence = await executeReaScenario(acc.profileUrl, { waitMs: 2500 });
        if (evidence && evidence.success) {
          acc.reaEvidence = evidence;
          if (evidence.screenshotUrl) acc.screenshotUrl = evidence.screenshotUrl;
        }
      } catch {}
    }
  }

  return foundAccounts;
}

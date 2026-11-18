import crypto from "node:crypto";
import dns from "node:dns/promises";
import { findInstagramAccountsFromEmail } from "./instagram-resolver.mjs";
import { searchGitHubCommitAuthor } from "./git-provenance.mjs";

/**
 * Validate email string format
 */
export function validateEmail(email) {
  if (!email || typeof email !== "string" || email.length > 254) return false;
  const parts = email.trim().toLowerCase().split("@");
  if (parts.length !== 2) return false;
  const [user, domain] = parts;
  if (!user || !domain || user.length > 64) return false;
  const domainParts = domain.split(".");
  if (domainParts.length < 2) return false;
  const tld = domainParts[domainParts.length - 1];
  if (!/^[a-z]{2,63}$/i.test(tld)) return false;
  return /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/i.test(user) && domainParts.every(p => /^[a-z0-9-]+$/i.test(p));
}

/**
 * Identify email provider from MX hostname
 */
function identifyProvider(mxRecords) {
  const mxStr = mxRecords.map(r => r.exchange.toLowerCase()).join(" ");
  if (mxStr.includes("google") || mxStr.includes("aspmx")) return "Google Workspace / Gmail";
  if (mxStr.includes("outlook") || mxStr.includes("microsoft") || mxStr.includes("hotmail")) return "Microsoft 365 / Outlook";
  if (mxStr.includes("protonmail") || mxStr.includes("proton")) return "Proton Mail";
  if (mxStr.includes("icloud") || mxStr.includes("apple")) return "Apple iCloud Mail";
  if (mxStr.includes("zoho")) return "Zoho Mail";
  if (mxStr.includes("yahoodns") || mxStr.includes("yahoo")) return "Yahoo Mail";
  if (mxStr.includes("fastmail")) return "Fastmail";
  if (mxStr.includes("mailgun")) return "Mailgun";
  if (mxStr.includes("sendgrid")) return "SendGrid";
  return "Custom / Self-hosted MX";
}

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
  "trashmail.com", "yopmail.com", "sharklasers.com", "getairmail.com",
  "dispostable.com", "throwawaymail.com", "maildrop.cc", "fakemailgenerator.com"
]);

/**
 * Search and verify an email address across online services and metadata registries.
 * @param {string} email
 * @param {function} onResult - Callback when a platform footprint is discovered
 * @param {function} onChecked - Callback on platform inspection progress
 * @param {object} [options]
 */
export async function checkEmail(email, onResult, onChecked, options = {}) {
  const cleanEmail = email.trim().toLowerCase();
  const [localPart, domain] = cleanEmail.split("@");
  const emailMd5 = crypto.createHash("md5").update(cleanEmail).digest("hex");
  const emailSha256 = crypto.createHash("sha256").update(cleanEmail).digest("hex");
  const discoveredHandles = [];

  // Emit baseline localpart lead
  const localpartLead = {
    username: localPart,
    foundOn: "Email Localpart",
    from: cleanEmail,
    queryType: "username",
    confidence: 0.95,
    entityType: "localpart"
  };
  discoveredHandles.push(localPart);
  options.onDig?.(localpartLead);

  const mailServerLeads = [localpartLead];
  const alphaPart = localPart.replace(/\d+/g, "");
  if (alphaPart && alphaPart.length >= 3 && alphaPart !== localPart) {
    const alphaLead = {
      username: alphaPart,
      foundOn: "Email Semantic Token",
      from: cleanEmail,
      queryType: "username",
      confidence: 0.85,
      entityType: "localpart"
    };
    discoveredHandles.push(alphaPart);
    mailServerLeads.push(alphaLead);
    options.onDig?.(alphaLead);
  }

  // 1. DNS & Mail Server Verification
  try {
    const mx = await dns.resolveMx(domain).catch(() => []);
    const isDisposable = DISPOSABLE_DOMAINS.has(domain);
    const provider = mx.length > 0 ? identifyProvider(mx) : "No MX records found";

    await onResult({
      platform: "Mail Server",
      username: cleanEmail,
      displayName: `${localPart} (${domain})`,
      userId: domain,
      sourceQuery: cleanEmail,
      profileUrl: `https://${domain}`,
      platformUrl: `https://${domain}`,
      pfpUrl: "",
      bannerUrl: "",
      isVerified: mx.length > 0,
      isPrivate: false,
      followers: 0,
      following: 0,
      posts: 0,
      likes: 0,
      location: "",
      emails: [cleanEmail],
      phones: [],
      website: `https://${domain}`,
      createdAt: "",
      lastActive: "",
      bio: `Domain Mail Provider: ${provider}. ${mx.length} active MX servers detected. Disposable: ${isDisposable ? "YES (High Risk)" : "No"}.`,
      extras: {
        mxRecords: mx.map(r => `${r.priority} ${r.exchange}`),
        provider,
        isDisposable,
        emailMd5,
        emailSha256
      },
      discoveredUsernames: mailServerLeads
    });
  } catch {}
  onChecked?.({ total: 1, counts: { "Mail Server": 1 } });

  // 2. Gravatar Profile Lookup
  try {
    const gravRes = await fetch(`https://en.gravatar.com/${emailMd5}.json`, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (gravRes.status === 200) {
      const json = await gravRes.json();
      if (json.entry && json.entry.length > 0) {
        const e = json.entry[0];
        const discovered = [];
        const linkedAccounts = [];
        const outlinks = [];

        // Parse linked verified accounts
        if (Array.isArray(e.accounts)) {
          for (const acc of e.accounts) {
            if (acc.username) {
              if (!discoveredHandles.includes(acc.username)) discoveredHandles.push(acc.username);
              const accLead = {
                username: acc.username,
                foundOn: acc.shortname || acc.domain || "Gravatar",
                from: cleanEmail,
                queryType: "username",
                confidence: 0.98,
                entityType: "verified_proof"
              };
              discovered.push(accLead);
              options.onDig?.(accLead);
            }
            linkedAccounts.push({
              platform: acc.shortname || acc.domain || "account",
              username: acc.username || "",
              url: acc.url || "",
              verified: Boolean(acc.verified)
            });
          }
        }

        // Parse profile URLs and outlinks
        if (Array.isArray(e.urls)) {
          for (const u of e.urls) {
            if (u?.value && typeof u.value === "string" && u.value.startsWith("http")) {
              outlinks.push(u.value);
              // Check if URL points to known social profile
              const xMatch = u.value.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,15})/i);
              if (xMatch && !discoveredHandles.includes(xMatch[1])) {
                discoveredHandles.push(xMatch[1]);
                const lead = { username: xMatch[1], foundOn: "Gravatar URL (Twitter)", from: cleanEmail, queryType: "username" };
                discovered.push(lead);
                options.onDig?.(lead);
              }
              const ghMatch = u.value.match(/github\.com\/([a-zA-Z0-9_-]+)/i);
              if (ghMatch && !discoveredHandles.includes(ghMatch[1])) {
                discoveredHandles.push(ghMatch[1]);
                const lead = { username: ghMatch[1], foundOn: "Gravatar URL (GitHub)", from: cleanEmail, queryType: "username" };
                discovered.push(lead);
                options.onDig?.(lead);
              }
            }
          }
        }

        // Include preferredUsername if present
        if (e.preferredUsername && !discoveredHandles.includes(e.preferredUsername)) {
          discoveredHandles.push(e.preferredUsername);
          const lead = { username: e.preferredUsername, foundOn: "Gravatar", from: cleanEmail, queryType: "username", confidence: 0.95 };
          discovered.push(lead);
          options.onDig?.(lead);
        }

        await onResult({
          platform: "Gravatar",
          username: e.preferredUsername || localPart,
          displayName: e.displayName || e.preferredUsername || localPart,
          userId: e.id || emailMd5,
          sourceQuery: cleanEmail,
          profileUrl: e.profileUrl || `https://gravatar.com/${e.preferredUsername || emailMd5}`,
          platformUrl: "https://gravatar.com",
          pfpUrl: e.thumbnailUrl || `https://gravatar.com/avatar/${emailMd5}?s=400`,
          bannerUrl: "",
          isVerified: true,
          isPrivate: false,
          followers: 0,
          following: 0,
          posts: 0,
          likes: 0,
          location: e.currentLocation || "",
          emails: (e.emails || []).map(m => m.value),
          phones: [],
          website: outlinks[0] || (e.urls && e.urls[0]?.value) || "",
          createdAt: "",
          lastActive: "",
          bio: e.aboutMe || "Registered Gravatar Identity Profile",
          extras: {
            preferredUsername: e.preferredUsername,
            linkedAccounts,
            outlinks
          },
          discoveredUsernames: discovered
        });
      }
    }
  } catch {}
  onChecked?.({ total: 1, counts: { "Gravatar": 1 } });

  // 3. GitHub User & Commit Provenance Lookup by Email
  try {
    const commitData = await searchGitHubCommitAuthor(cleanEmail);
    if (commitData) {
      if (Array.isArray(commitData.logins)) {
        for (const login of commitData.logins) {
          if (!discoveredHandles.includes(login)) {
            discoveredHandles.push(login);
            options.onDig?.({
              username: login,
              foundOn: "GitHub Commit Author",
              from: cleanEmail,
              queryType: "username",
              confidence: 0.98,
              entityType: "handle"
            });
          }
        }
      }
    }

    const ghRes = await fetch(`https://api.github.com/search/users?q=${encodeURIComponent(cleanEmail)}+in:email`, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/vnd.github.v3+json"
      }
    });
    if (ghRes.status === 200) {
      const ghData = await ghRes.json();
      if (ghData.items && ghData.items.length > 0) {
        for (const user of ghData.items.slice(0, 3)) {
          discoveredHandles.push(user.login);
          const ghLead = { username: user.login, foundOn: "GitHub", from: cleanEmail, queryType: "username", confidence: 0.98, entityType: "handle" };
          options.onDig?.(ghLead);
          await onResult({
            platform: "GitHub",
            username: user.login,
            displayName: user.login,
            userId: String(user.id),
            sourceQuery: cleanEmail,
            profileUrl: user.html_url,
            platformUrl: "https://github.com",
            pfpUrl: user.avatar_url,
            bannerUrl: "",
            isVerified: false,
            isPrivate: false,
            followers: 0,
            following: 0,
            posts: 0,
            likes: 0,
            location: "",
            emails: [cleanEmail],
            phones: [],
            website: "",
            createdAt: "",
            lastActive: "",
            bio: `Discovered GitHub account associated with ${cleanEmail}`,
            extras: { githubId: user.id, score: user.score },
            discoveredUsernames: [ghLead]
          });
        }
      }
    }
  } catch {}
  onChecked?.({ total: 1, counts: { "GitHub": 1 } });

  // 4. Autonomous Instagram Account Discovery from Email & Correlated Handles
  try {
    const igAccounts = await findInstagramAccountsFromEmail(cleanEmail, {
      deepRea: options.deepRea || false,
      additionalCandidates: discoveredHandles,
      fullName: options.fullName || ""
    });

    for (const ig of igAccounts) {
      const igLead = {
        username: ig.username,
        foundOn: "Instagram",
        from: cleanEmail,
        queryType: "username",
        confidence: 0.95,
        entityType: "handle"
      };
      options.onDig?.(igLead);

      const allIgLeads = [igLead, ...(ig.discoveredUsernames || [])];
      if (Array.isArray(ig.discoveredUsernames)) {
        for (const extraLead of ig.discoveredUsernames) {
          options.onDig?.(extraLead);
        }
      }

      await onResult({
        ...ig,
        sourceQuery: cleanEmail,
        emails: [cleanEmail],
        phones: [],
        createdAt: "",
        lastActive: "",
        likes: 0,
        discoveredUsernames: allIgLeads
      });
    }
  } catch {}
  onChecked?.({ total: 1, counts: { "Instagram": 1 } });

  // 5. Breach & Public Leak OSINT Vectors
  try {
    const breachDorks = [
      {
        title: "Public Pastebin & Code Repository Leaks",
        query: `"${cleanEmail}" (site:pastebin.com OR site:github.com OR site:gitlab.com)`,
        googleUrl: `https://www.google.com/search?q=${encodeURIComponent(`"${cleanEmail}" (site:pastebin.com OR site:github.com OR site:gitlab.com)`)}`
      },
      {
        title: "Credential Dumps & Password Leaks",
        query: `"${cleanEmail}" (intext:password OR intext:hash OR intext:leak OR intext:pass)`,
        googleUrl: `https://www.google.com/search?q=${encodeURIComponent(`"${cleanEmail}" (intext:password OR intext:hash OR intext:leak OR intext:pass)`)}`
      },
      {
        title: "Public Document & Invoice Leaks",
        query: `"${cleanEmail}" (filetype:pdf OR filetype:xlsx OR filetype:csv OR filetype:doc)`,
        googleUrl: `https://www.google.com/search?q=${encodeURIComponent(`"${cleanEmail}" (filetype:pdf OR filetype:xlsx OR filetype:csv OR filetype:doc)`)}`
      },
      {
        title: "HaveIBeenPwned Breach Registry",
        query: cleanEmail,
        googleUrl: `https://haveibeenpwned.com/unifiedsearch/${encodeURIComponent(cleanEmail)}`
      },
      {
        title: "Intelligence X Search Vector",
        query: cleanEmail,
        googleUrl: `https://intelx.io/?s=${encodeURIComponent(cleanEmail)}`
      }
    ];

    await onResult({
      platform: "Breach & Leak Index",
      username: cleanEmail,
      displayName: `Breach Forensics (${cleanEmail})`,
      userId: emailSha256.slice(0, 16),
      sourceQuery: cleanEmail,
      profileUrl: `https://haveibeenpwned.com/unifiedsearch/${encodeURIComponent(cleanEmail)}`,
      platformUrl: "https://haveibeenpwned.com",
      pfpUrl: "",
      bannerUrl: "",
      isVerified: true,
      isPrivate: false,
      followers: 0,
      following: 0,
      posts: 0,
      likes: 0,
      location: "",
      emails: [cleanEmail],
      phones: [],
      website: `https://intelx.io/?s=${encodeURIComponent(cleanEmail)}`,
      createdAt: "",
      lastActive: "",
      bio: `Generated 5 automated OSINT breach vectors, credential dump dorks, and registry pivots for ${cleanEmail}.`,
      extras: {
        dorks: breachDorks,
        haveIBeenPwnedUrl: `https://haveibeenpwned.com/unifiedsearch/${encodeURIComponent(cleanEmail)}`,
        intelXUrl: `https://intelx.io/?s=${encodeURIComponent(cleanEmail)}`,
        dehashedUrl: `https://www.dehashed.com/search?query=${encodeURIComponent(cleanEmail)}`
      },
      discoveredUsernames: []
    });
  } catch {}
  onChecked?.({ total: 1, counts: { "Breach & Leak Index": 1 } });
}

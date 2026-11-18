/**
 * Git & VCS Cryptographic Provenance Extractor
 * Performs deep forensic investigation on developer profiles (GitHub, GitLab, Codeberg):
 * 1. Public SSH Keys & Cryptographic Fingerprints (github.com/<user>.keys)
 * 2. Real Commit Author Emails & Names from public patches (github.com/<user>/<repo>/commit/HEAD.patch)
 * 3. Exact Commit Timestamps & Local Timezone Offsets (e.g. +0530 for IST)
 * 4. Automatic extraction of secondary pivotable emails and handles into the Dig Engine.
 */

import crypto from "node:crypto";

/**
 * Compute OpenSSH-style SHA256 fingerprint for a public key string
 * @param {string} rawKeyLine - e.g. "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5..."
 * @returns {string} e.g. "SHA256:7uX9..."
 */
export function computeSshFingerprint(rawKeyLine) {
  try {
    const parts = rawKeyLine.trim().split(/\s+/);
    if (parts.length < 2) return "";
    const b64 = parts[1];
    const keyBuf = Buffer.from(b64, "base64");
    const hash = crypto.createHash("sha256").update(keyBuf).digest("base64").replace(/=+$/, "");
    return `SHA256:${hash}`;
  } catch {
    return "";
  }
}

/**
 * Extract deep VCS forensic provenance from a GitHub username
 * @param {string} username
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function extractGitProvenance(username, options = {}) {
  const cleanUser = username.trim().toLowerCase();
  const timeoutMs = options.timeoutMs || 5000;

  const provenance = {
    username: cleanUser,
    sshKeys: [],
    repos: [],
    commitEmails: [],
    commitAuthors: [],
    timezone: null,
    pivotLeads: [],
    timestamp: Date.now()
  };

  try {
    // 1. Fetch Public SSH Keys
    const controller1 = new AbortController();
    const t1 = setTimeout(() => controller1.abort(), timeoutMs);
    try {
      const keysRes = await fetch(`https://github.com/${cleanUser}.keys`, {
        signal: controller1.signal,
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" }
      });
      clearTimeout(t1);

      if (keysRes.ok) {
        const text = await keysRes.text();
        const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
          const parts = line.split(/\s+/);
          const keyType = parts[0];
          const comment = parts.slice(2).join(" ");
          const fingerprint = computeSshFingerprint(line);
          provenance.sshKeys.push({
            type: keyType,
            fingerprint,
            raw: line,
            comment: comment || null
          });

          // Check if key comment has an email
          if (comment && comment.includes("@")) {
            const emailMatch = comment.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            if (emailMatch) {
              provenance.commitEmails.push(emailMatch[1]);
              provenance.pivotLeads.push({
                username: emailMatch[1],
                queryType: "email",
                foundOn: `GitHub SSH Key (${fingerprint.slice(0, 16)}...)`,
                from: cleanUser
              });
            }
          }
        }
      }
    } catch {}

    // 2. Extract Public Repositories from Profile HTML
    const controller2 = new AbortController();
    const t2 = setTimeout(() => controller2.abort(), timeoutMs);
    let publicRepos = [];
    try {
      const profileRes = await fetch(`https://github.com/${cleanUser}`, {
        signal: controller2.signal,
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" }
      });
      clearTimeout(t2);

      if (profileRes.ok) {
        const html = await profileRes.text();
        const repoRegex = new RegExp(`href="/${cleanUser}/([a-zA-Z0-9_.-]+)"`, "gi");
        const matches = Array.from(html.matchAll(repoRegex)).map(m => m[1]);
        const ignoreList = new Set(["followers", "following", "stars", "tab=repositories", "tab=stars", "tab=projects"]);
        publicRepos = Array.from(new Set(matches)).filter(r => !ignoreList.has(r.toLowerCase()) && !r.includes("="));
        provenance.repos = publicRepos.slice(0, 10);
      }
    } catch {}

    // 3. Inspect Commit Patches to recover Author Email & Timezone
    if (publicRepos.length > 0) {
      // Test top 2 repositories for commit patches
      for (const repo of publicRepos.slice(0, 2)) {
        const controller3 = new AbortController();
        const t3 = setTimeout(() => controller3.abort(), timeoutMs);
        try {
          const patchRes = await fetch(`https://github.com/${cleanUser}/${repo}/commit/HEAD.patch`, {
            signal: controller3.signal,
            headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" }
          });
          clearTimeout(t3);

          if (patchRes.ok) {
            const patchText = await patchRes.text();
            // Match From: Name <email>
            const fromMatch = patchText.match(/From:\s*([^<]+)<([^>]+)>/i);
            const dateMatch = patchText.match(/Date:\s*([^\n]+)/i);

            if (fromMatch) {
              const authorName = fromMatch[1].trim();
              const authorEmail = fromMatch[2].trim();

              if (!provenance.commitAuthors.includes(authorName)) {
                provenance.commitAuthors.push(authorName);
              }

              // Filter out github generic bot emails: @users.noreply.github.com
              if (!provenance.commitEmails.includes(authorEmail)) {
                provenance.commitEmails.push(authorEmail);

                if (!authorEmail.includes("noreply.github.com")) {
                  // Valid direct personal email lead!
                  provenance.pivotLeads.push({
                    username: authorEmail,
                    queryType: "email",
                    foundOn: `GitHub Commit Patch (${cleanUser}/${repo})`,
                    from: cleanUser
                  });

                  // Extract email localpart as handle lead
                  const localPart = authorEmail.split("@")[0];
                  if (localPart && localPart !== cleanUser) {
                    provenance.pivotLeads.push({
                      username: localPart,
                      queryType: "username",
                      foundOn: `GitHub Commit Email Localpart (${authorEmail})`,
                      from: cleanUser
                    });
                  }
                }
              }
            }

            if (dateMatch && !provenance.timezone) {
              const rawDate = dateMatch[1].trim();
              // Extract timezone offset e.g. +0530 or -0400
              const tzMatch = rawDate.match(/([+-]\d{4})$/);
              if (tzMatch) {
                const tzOffset = tzMatch[1];
                let tzName = tzOffset;
                if (tzOffset === "+0530") tzName = "IST (India Standard Time, UTC+5:30)";
                else if (tzOffset === "+0000") tzName = "UTC / GMT";
                else if (tzOffset === "-0400" || tzOffset === "-0500") tzName = "EST/EDT (North America Eastern)";
                else if (tzOffset === "-0700" || tzOffset === "-0800") tzName = "PST/PDT (North America Pacific)";
                else if (tzOffset === "+0100" || tzOffset === "+0200") tzName = "CET/CEST (Central Europe)";

                provenance.timezone = {
                  rawOffset: tzOffset,
                  name: tzName,
                  commitDate: rawDate
                };
              }
            }
          }
        } catch {}
      }
    }
  } catch (err) {
    provenance.error = err.message;
  }

  return provenance;
}

/**
 * Searches public GitHub commit records by author email address to discover
 * developer account logins and commit author display names.
 * @param {string} email
 * @param {number} [timeoutMs=4000]
 * @returns {Promise<{logins: string[], names: string[]}|null>}
 */
export async function searchGitHubCommitAuthor(email, timeoutMs = 4000) {
  if (!email || !email.includes("@")) return null;
  const cleanEmail = email.trim().toLowerCase();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(`https://api.github.com/search/commits?q=author-email:${encodeURIComponent(cleanEmail)}&sort=author-date&order=desc`, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "application/vnd.github.cloak-preview+json, application/vnd.github.v3+json"
      }
    });
    clearTimeout(timer);

    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data.items) || data.items.length === 0) return null;

    const authors = new Set();
    const logins = new Set();

    for (const item of data.items.slice(0, 5)) {
      if (item.author?.login) logins.add(item.author.login);
      if (item.commit?.author?.name) authors.add(item.commit.author.name);
    }

    return {
      logins: Array.from(logins),
      names: Array.from(authors)
    };
  } catch {
    return null;
  }
}

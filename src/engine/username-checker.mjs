import { extractDigLeads } from "./dig-engine.mjs";

/**
 * Execute parallel platform checks with bounded concurrency.
 * @param {string} username - Target handle to search
 * @param {Array<object>} platforms - Array of platform definition objects
 * @param {object} callbacks - { onResult, onChecked, onDig, signal }
 * @param {number} concurrency - Max concurrent network probes (default 12)
 */
export async function checkUsername(username, platforms, callbacks = {}, concurrency = 12) {
  const { onResult, onChecked, onDig, signal } = callbacks;
  const results = [];
  const cleanUsername = username.trim().replace(/^@+/, "");

  let index = 0;
  const total = platforms.length;

  async function worker() {
    while (index < total) {
      if (signal?.aborted) break;
      const currentIndex = index++;
      const p = platforms[currentIndex];
      if (!p) break;

      const targetUrl = p.probeUrl.replace(/\{username\}/g, encodeURIComponent(cleanUsername));
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6500);

      try {
        const fetchSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
        const res = await fetch(targetUrl, {
          method: p.method || "GET",
          headers: p.headers || {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          },
          signal: fetchSignal
        });

        clearTimeout(timeoutId);
        const text = await res.text();

        const checkRes = await p.check(res, text, cleanUsername);
        if (checkRes && checkRes.exists) {
          const rawOutlinks = [
            ...(checkRes.extras?.outlinks || []),
            ...(checkRes.links || [])
          ];
          const outlinks = Array.from(new Set(rawOutlinks.filter(u => typeof u === "string" && u.startsWith("http"))));
          const linkedAccounts = checkRes.extras?.linkedAccounts || checkRes.linkedAccounts || [];
          const category = checkRes.extras?.category || checkRes.category || "";
          const threadsHandle = checkRes.extras?.threadsHandle || checkRes.threadsHandle || "";
          const bioMetadata = checkRes.extras?.bioMetadata || checkRes.bioMetadata || {};

          const profile = {
            platform: p.name,
            username: checkRes.username || cleanUsername,
            displayName: checkRes.displayName || cleanUsername,
            userId: checkRes.userId || "",
            sourceQuery: cleanUsername,
            profileUrl: checkRes.profileUrl || p.url.replace(/\{username\}/g, cleanUsername),
            platformUrl: checkRes.platformUrl || p.urlMain || "",
            pfpUrl: checkRes.pfpUrl || "",
            bannerUrl: checkRes.bannerUrl || "",
            isVerified: Boolean(checkRes.isVerified),
            isPrivate: Boolean(checkRes.isPrivate),
            followers: checkRes.followers ?? null,
            following: checkRes.following ?? null,
            posts: checkRes.posts ?? null,
            likes: checkRes.likes ?? null,
            location: checkRes.location || "",
            emails: checkRes.emails || [],
            phones: checkRes.phones || [],
            website: checkRes.website || (outlinks.length > 0 ? outlinks[0] : ""),
            createdAt: checkRes.createdAt || "",
            lastActive: checkRes.lastActive || "",
            bio: checkRes.bio || "",
            extras: {
              ...(checkRes.extras || {}),
              outlinks,
              linkedAccounts,
              category,
              threadsHandle,
              bioMetadata
            },
            error: null
          };

          // Extract recursive dig leads
          const digLeads = extractDigLeads({
            ...profile,
            discoveredUsernames: checkRes.discoveredUsernames
          });
          if (digLeads.length > 0) {
            profile.discoveredUsernames = digLeads;
            if (onDig) {
              for (const lead of digLeads) {
                onDig(lead);
              }
            }
          } else if (Array.isArray(checkRes.discoveredUsernames) && checkRes.discoveredUsernames.length > 0) {
            profile.discoveredUsernames = checkRes.discoveredUsernames;
            if (onDig) {
              for (const lead of checkRes.discoveredUsernames) {
                onDig(lead);
              }
            }
          }

          results.push(profile);
          onResult?.(profile);
        }
      } catch (err) {
        // Platform timeout or network block; handled gracefully
      } finally {
        clearTimeout(timeoutId);
        onChecked?.({ total: 1, counts: { [p.name]: 1 } });
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker());
  await Promise.all(workers);

  return results;
}

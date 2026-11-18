import fs from "node:fs";
import path from "node:path";
import { MAJOR_PLATFORMS } from "./definitions.mjs";

let extendedPlatformsCache = null;

/**
 * Load all platforms. Includes rich major platforms + optional extended maigret database.
 * @param {boolean} includeExtended - Whether to include the extended 3000+ site catalog from Maigret
 */
export function getPlatforms(includeExtended = false) {
  if (!includeExtended) {
    return MAJOR_PLATFORMS;
  }

  if (extendedPlatformsCache) {
    return extendedPlatformsCache;
  }

  const combined = [...MAJOR_PLATFORMS];
  const existingNames = new Set(MAJOR_PLATFORMS.map(p => p.name.toLowerCase()));

  // Try locating data.json in MAIGRET directory
  const possiblePaths = [
    path.resolve(process.cwd(), "../MAIGRET/maigret/resources/data.json"),
    path.resolve(process.cwd(), "MAIGRET/maigret/resources/data.json"),
    path.resolve(process.cwd(), "resources/data.json"),
    "/Users/harshkumar/Desktop/projects/osint_toolkit/MAIGRET/maigret/resources/data.json"
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
        const sites = raw.sites || {};
        for (const [siteName, site] of Object.entries(sites)) {
          if (existingNames.has(siteName.toLowerCase())) continue;
          if (!site.url) continue;

          // Only take top Alexa-ranked or verified sites to keep checks fast
          if (site.alexaRank && site.alexaRank > 500000 && !site.urlProbe) continue;

          combined.push({
            name: siteName,
            category: (site.tags && site.tags[0]) || "General",
            url: site.url,
            urlMain: site.urlMain || "",
            probeUrl: site.urlProbe || site.url,
            headers: site.headers || {
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
            async check(res, text, username) {
              if (site.checkType === "status_code") {
                if (res.status === 200) {
                  return {
                    exists: true,
                    username,
                    displayName: username,
                    profileUrl: site.url.replace("{username}", username),
                    platformUrl: site.urlMain || "",
                    bio: "",
                    isVerified: false,
                    isPrivate: false
                  };
                }
                return { exists: false };
              }

              if (site.checkType === "message") {
                const notFound = (site.absenceStrs || []).some(s => text.includes(s));
                const found = (site.presenseStrs || []).some(s => text.includes(s));
                if (res.status === 200 && !notFound && (found || !site.presenseStrs?.length)) {
                  return {
                    exists: true,
                    username,
                    displayName: username,
                    profileUrl: site.url.replace("{username}", username),
                    platformUrl: site.urlMain || "",
                    bio: ""
                  };
                }
              }

              if (res.status === 200 && !text.includes("404") && !text.includes("Not Found")) {
                return {
                  exists: true,
                  username,
                  displayName: username,
                  profileUrl: site.url.replace("{username}", username),
                  platformUrl: site.urlMain || ""
                };
              }

              return { exists: false };
            }
          });
        }
        break;
      } catch (err) {
        console.warn("Could not load extended Maigret catalog:", err.message);
      }
    }
  }

  extendedPlatformsCache = combined;
  return combined;
}

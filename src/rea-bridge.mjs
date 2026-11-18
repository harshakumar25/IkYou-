/**
 * REA (Reverse Engineering Assistant) Engine Bridge
 * Integrates REA's bounded Playwright engine, browser scenarios, and network inspection
 * for deep verification of JavaScript-rendered or anti-bot-protected OSINT targets.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const execFileAsync = promisify(execFile);

const REA_SCRIPT_PATH = path.resolve("/Users/harshkumar/Desktop/projects/osint_toolkit/rea/scripts/rea.mjs");
const EVIDENCE_DIR = path.resolve("/Users/harshkumar/Desktop/projects/osint_toolkit/localfingerprint/public/evidence");

/**
 * Auto-detect an installed Chromium browser binary on the system
 * @returns {string|null}
 */
export function findAvailableBrowser() {
  const candidatePaths = [
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Arc.app/Contents/MacOS/Arc",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

/**
 * Check if REA toolchain is installed and accessible.
 * @returns {Promise<{available: boolean, version: string|null, browser: string|null}>}
 */
export async function checkReaAvailability() {
  const browser = findAvailableBrowser();
  try {
    if (!fs.existsSync(REA_SCRIPT_PATH)) {
      return { available: false, version: null, browser };
    }
    const { stdout } = await execFileAsync("node", [REA_SCRIPT_PATH, "--version"], { timeout: 15000 });
    return { available: true, version: stdout.trim(), browser };
  } catch (err) {
    return { available: false, version: null, browser, error: err.message };
  }
}

/**
 * Executes a bounded browser scenario via REA to inspect, screenshot, and extract live profile evidence.
 * @param {string} targetUrl - Profile URL to inspect
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function executeReaScenario(targetUrl, options = {}) {
  const isAvailable = await checkReaAvailability();
  if (!isAvailable.available) {
    return {
      success: false,
      reason: "REA CLI not found or inactive",
      targetUrl
    };
  }

  const browserPath = options.browserPath || isAvailable.browser;
  if (!browserPath) {
    return {
      success: false,
      reason: "No compatible Chromium browser found on system",
      targetUrl
    };
  }

  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }

  let effectiveUrl = (targetUrl || "").trim();

  // 1. Auto-pivot non-HTTP schemes (tel:, mailto:, viber:) to browser-executable web endpoints
  if (effectiveUrl.startsWith("tel:")) {
    const rawNumber = effectiveUrl.replace(/^tel:/, "").trim();
    const cleanDigits = rawNumber.replace(/\D/g, "");
    if (cleanDigits.startsWith("91") && cleanDigits.length === 12) {
      effectiveUrl = `https://www.truecaller.com/search/in/${cleanDigits.slice(2)}`;
    } else if (cleanDigits.length === 10) {
      effectiveUrl = `https://www.truecaller.com/search/in/${cleanDigits}`;
    } else if (cleanDigits.startsWith("1") && cleanDigits.length === 11) {
      effectiveUrl = `https://www.truecaller.com/search/us/${cleanDigits.slice(1)}`;
    } else if (cleanDigits.length >= 7) {
      effectiveUrl = `https://www.google.com/search?q=%22%2B${cleanDigits}%22`;
    } else {
      effectiveUrl = "https://www.truecaller.com";
    }
  } else if (effectiveUrl.startsWith("mailto:")) {
    const email = effectiveUrl.replace(/^mailto:/, "").trim();
    effectiveUrl = `https://haveibeenpwned.com/unifiedsearch/${encodeURIComponent(email)}`;
  } else if (effectiveUrl.startsWith("viber:")) {
    const match = effectiveUrl.match(/number=(?:%2B|\+)?(\d+)/i);
    const digits = match ? match[1] : "";
    effectiveUrl = digits ? `https://www.google.com/search?q=%22%2B${digits}%22` : "https://viber.com";
  }

  // 2. Validate URL protocol (Chromium requires HTTP/HTTPS)
  if (!effectiveUrl.startsWith("http://") && !effectiveUrl.startsWith("https://")) {
    if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(effectiveUrl)) {
      effectiveUrl = `https://${effectiveUrl}`;
    } else {
      return {
        success: false,
        reason: `Browser inspection requires valid HTTP(S) web URLs. '${targetUrl}' cannot be navigated directly by Chromium.`,
        targetUrl
      };
    }
  }

  const scenarioId = `rea_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const tempScenarioPath = path.resolve("/tmp", `${scenarioId}.json`);
  const evidenceOutputPath = path.resolve("/tmp", `${scenarioId}_evidence.json`);

  // Construct bounded browser scenario matching REA schema
  const scenario = {
    browser: {
      mode: "launch",
      executable_path: browserPath,
      headless: true
    },
    start_url: {
      url: effectiveUrl
    },
    environment: {
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
      timezone: "UTC"
    },
    capture: {
      at_end: ["url", "dom", "screenshot"]
    },
    actions: [
      {
        step_id: "wait_dom",
        action: "wait_for_timeout",
        duration_ms: options.waitMs || 2000
      }
    ]
  };

  try {
    fs.writeFileSync(tempScenarioPath, JSON.stringify(scenario, null, 2), "utf8");

    await execFileAsync("node", [
      REA_SCRIPT_PATH,
      "capture-browser-scenario",
      tempScenarioPath,
      "--detail",
      "summary",
      "--evidence_output",
      evidenceOutputPath
    ], { timeout: 35000, maxBuffer: 50 * 1024 * 1024 });

    if (!fs.existsSync(evidenceOutputPath)) {
      return { success: false, reason: "Evidence bundle not generated", targetUrl };
    }

    const evidenceRaw = JSON.parse(fs.readFileSync(evidenceOutputPath, "utf8"));
    const record = evidenceRaw.records?.[0] || evidenceRaw;
    const normalized = record.normalized_result || {};
    const steps = normalized.steps || [];
    const lastStep = steps[steps.length - 1];

    let screenshotUrl = null;
    let screenshotSha256 = null;
    const extractedLinks = new Set();
    const extractedEmails = new Set();
    let instagramMeta = null;
    let metaInfo = null;

    const ignoredGithubSlugs = new Set([
      "features", "security", "enterprise", "team", "customer-stories", "readme",
      "pricing", "resources", "github-models", "skills", "marketplace", "trending",
      "collections", "events", "sponsors", "about", "contact", "login", "join",
      "site", "fluidicon", "cmc", "github", "get-started", "en", "credentials", "open-source", "platform"
    ]);

    const ignoredInstagramSlugs = new Set([
      "rsrc.php", "v", "_u", "blog", "about", "policy", "terms", "privacy", "legal",
      "help", "press", "api", "jobs", "directory", "explore", "reels", "stories",
      "accounts", "p", "tv", "developer", "meta"
    ]);

    if (lastStep?.artifacts?.screenshot?.value?.data_base64) {
      const base64Data = lastStep.artifacts.screenshot.value.data_base64;
      screenshotSha256 = lastStep.artifacts.screenshot.value.sha256;
      const imgBuffer = Buffer.from(base64Data, "base64");
      const filename = `${scenarioId}.png`;
      const diskPath = path.join(EVIDENCE_DIR, filename);
      fs.writeFileSync(diskPath, imgBuffer);
      screenshotUrl = `/evidence/${filename}`;
    }

    if (lastStep?.artifacts?.dom?.value) {
      const domText = lastStep.artifacts.dom.value.text || String(lastStep.artifacts.dom.value);

      // Extract emails from DOM
      const emailMatches = domText.matchAll(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g);
      for (const m of emailMatches) {
        if (!m[1].includes(".png") && !m[1].includes(".jpg") && !m[1].includes("sentry")) {
          extractedEmails.add(m[1].toLowerCase());
        }
      }

      // Extract social profile links from DOM
      const linkRegexes = [
        /(?:https?:\/\/)?(?:www\.)?twitter\.com\/([a-zA-Z0-9_]{1,15})/gi,
        /(?:https?:\/\/)?(?:www\.)?x\.com\/([a-zA-Z0-9_]{1,15})/gi,
        /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9_-]+)/gi,
        /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9_.]+)/gi,
        /(?:https?:\/\/)?(?:www\.)?t\.me\/([a-zA-Z0-9_]{5,32})/gi,
        /(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9-]{1,38})/gi
      ];

      for (const r of linkRegexes) {
        const matches = Array.from(domText.matchAll(r)).map(m => m[0]);
        for (const l of matches) {
          const lower = l.toLowerCase();
          const ghMatch = lower.match(/github\.com\/([a-zA-Z0-9_-]+)/);
          if (ghMatch && ignoredGithubSlugs.has(ghMatch[1])) continue;

          const igMatch = lower.match(/instagram\.com\/([a-zA-Z0-9_.]+)/);
          if (igMatch && ignoredInstagramSlugs.has(igMatch[1])) continue;

          extractedLinks.add(l);
        }
      }

      // Specialized extraction for Instagram profiles from DOM
      if (targetUrl.includes("instagram.com")) {
        const titleMatch = domText.match(/<title[^>]*>([^<]+)<\/title>/i);
        const title = titleMatch ? titleMatch[1].replace(/&#064;/g, "@").replace(/&amp;/g, "&") : "";
        const nameMatch = title.match(/^(.+?)\s*\(@/);
        const ogDescMatch = domText.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i);
        const idMatch = domText.match(/"profile_id":"(\d+)"/) || domText.match(/"id":"(\d{5,})"/);
        
        let followers = null, following = null, posts = null;
        if (ogDescMatch) {
          const statsMatch = ogDescMatch[1].match(/([\d.,KMkm]+)\s*Followers,\s*([\d.,KMkm]+)\s*Following,\s*([\d.,KMkm]+)\s*Posts/i);
          if (statsMatch) {
            followers = statsMatch[1];
            following = statsMatch[2];
            posts = statsMatch[3];
          }
        }

        instagramMeta = {
          displayName: nameMatch ? nameMatch[1].trim() : "",
          userId: idMatch ? idMatch[1] : null,
          followers,
          following,
          posts,
          bio: ogDescMatch ? ogDescMatch[1].split(" - See Instagram photos")[0] : ""
        };
      }
    }

    // Fallback/enrichment for Instagram via stealth SSR if DOM did not expose complete details
    if (targetUrl.includes("instagram.com")) {
      const igMatch = targetUrl.match(/instagram\.com\/([a-zA-Z0-9_.]+)/i);
      const igUser = igMatch ? igMatch[1].replace(/\/$/, "") : null;
      if (igUser && !ignoredInstagramSlugs.has(igUser.toLowerCase())) {
        try {
          const { probeInstagramUser } = await import("./engine/instagram-resolver.mjs");
          const probed = await probeInstagramUser(igUser);
          if (probed && probed.exists) {
            instagramMeta = {
              displayName: probed.displayName || instagramMeta?.displayName || "",
              userId: probed.userId || instagramMeta?.userId || null,
              followers: probed.followers || instagramMeta?.followers || null,
              following: probed.following || instagramMeta?.following || null,
              posts: probed.posts || instagramMeta?.posts || null,
              bio: probed.bio || instagramMeta?.bio || ""
            };
          }
        } catch {}
      }
    }

    // Specialized extraction for Facebook/Meta profiles
    if (targetUrl.includes("facebook.com") || targetUrl.includes("meta.com")) {
      const domText = lastStep?.artifacts?.dom?.value ? (lastStep.artifacts.dom.value.text || String(lastStep.artifacts.dom.value)) : "";
      const titleMatch = domText.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].replace(/&amp;/g, "&").trim() : "";
      const ogDescMatch = domText.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i);
      metaInfo = {
        platform: targetUrl.includes("facebook.com") ? "Facebook" : "Meta",
        title: title || "",
        description: ogDescMatch ? ogDescMatch[1].trim() : ""
      };
    }

    return {
      success: true,
      targetUrl,
      effectiveUrl,
      evidenceId: evidenceRaw.evidence_id,
      browser: evidenceRaw.normalized_result?.browser?.product,
      durationMs: evidenceRaw.normalized_result?.duration_ms,
      screenshotUrl,
      screenshotSha256,
      extractedEmails: Array.from(extractedEmails),
      extractedLinks: Array.from(extractedLinks).slice(0, 20),
      instagramMeta,
      metaInfo
    };
  } catch (err) {
    let cleanError = err.message || "REA browser scenario execution failed";
    if (err.stderr) {
      cleanError = err.stderr.trim();
    } else if (err.stdout && (err.stdout.includes("message:") || err.stdout.includes("error:"))) {
      const msgMatch = err.stdout.match(/message:\s*([^\n]+)/);
      if (msgMatch) cleanError = msgMatch[1].trim();
    }
    cleanError = cleanError.replace(/Command failed: node \/[^\n]+rea\.mjs[^\n]+/g, "").trim() || cleanError;

    return {
      success: false,
      targetUrl,
      effectiveUrl,
      error: cleanError
    };
  } finally {
    try {
      if (fs.existsSync(tempScenarioPath)) fs.unlinkSync(tempScenarioPath);
      if (fs.existsSync(evidenceOutputPath)) fs.unlinkSync(evidenceOutputPath);
    } catch {}
  }
}

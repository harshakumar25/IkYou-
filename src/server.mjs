import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeSearch } from "./engine/search-orchestrator.mjs";
import { computeVisitorIdentifier } from "./device/browser-fingerprint.mjs";
import { exportToJson, exportToCsv, exportToTextDossier, exportToMarkdownDossier, exportToHtmlDossier } from "./exporters/export-service.mjs";
import { getPlatforms } from "./platforms/catalog.mjs";
import { mintDeviceToken, verifyDeviceToken, analyzePassiveEdgeSignals } from "./edge/passive-fingerprint.mjs";
import { globalEdgeCache } from "./edge/cache.mjs";
import { IdentityGraph } from "./engine/identity-graph.mjs";
import { checkReaAvailability, executeReaScenario } from "./rea-bridge.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, "../public");

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

// In-memory active investigation graph
let activeIdentityGraph = null;

/**
 * Create and start the LocalFingerprint server.
 */
export function createServer(port = 3333) {
  const server = http.createServer(async (req, res) => {
    // 1. CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("X-Edge-Runtime", "LocalFingerprint-Edge/2.0");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname;
    const clientIp = req.socket.remoteAddress || "127.0.0.1";

    // 2. Cookie & Edge Device Identification (fp_did)
    const cookieHeader = req.headers["cookie"] || "";
    const cookieMatch = cookieHeader.match(/fp_did=([a-zA-Z0-9._-]+)/);
    let deviceToken = cookieMatch ? cookieMatch[1] : null;
    const tokenVerification = deviceToken ? verifyDeviceToken(deviceToken) : { valid: false };

    if (!tokenVerification.valid) {
      deviceToken = mintDeviceToken();
      res.setHeader("Set-Cookie", `fp_did=${deviceToken}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax; Secure`);
    }

    // 3. Passive Edge Telemetry Endpoint: /api/edge/telemetry
    if (pathname === "/api/edge/telemetry") {
      const telemetry = analyzePassiveEdgeSignals(req.headers, clientIp);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ...telemetry,
        deviceToken,
        tokenValid: tokenVerification.valid
      }, null, 2));
      return;
    }

    // 4. Streaming SSE Search Endpoints (/api/search & /api/demo-search)
    if (pathname === "/api/search" || pathname === "/api/demo-search") {
      const query = parsedUrl.searchParams.get("query") || parsedUrl.searchParams.get("q") || "";
      let type = parsedUrl.searchParams.get("type");
      
      // Smart Auto-Detection: if type is missing or default "username", detect if query is an email or phone number
      const trimmedQuery = query.trim();
      if (!type || type === "username" || type === "auto") {
        if (trimmedQuery.includes("@") && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedQuery)) {
          type = "email";
        } else if ((trimmedQuery.startsWith("+") || /^\d[\d\s\-().]{6,18}\d$/.test(trimmedQuery)) && trimmedQuery.replace(/\D/g, "").length >= 7) {
          type = "phone";
        } else {
          type = type || "username";
        }
      }
      const dig = parsedUrl.searchParams.get("dig") === "true";
      const digDepth = parseInt(parsedUrl.searchParams.get("dig_depth") || "1", 10);
      const digType = parsedUrl.searchParams.get("dig_type") || "both";
      const extended = parsedUrl.searchParams.get("extended") === "true";
      const deepRea = parsedUrl.searchParams.get("deep_rea") === "true";
      const bypassCache = parsedUrl.searchParams.get("cache") === "false" ||
                          parsedUrl.searchParams.get("fresh") === "true" ||
                          req.headers["cache-control"] === "no-cache";

      // Seed parameters for Person Identity Resolution & Disambiguation
      const firstName = parsedUrl.searchParams.get("first_name") || "";
      const lastName = parsedUrl.searchParams.get("last_name") || "";
      const nicknames = parsedUrl.searchParams.get("nicknames") ? parsedUrl.searchParams.get("nicknames").split(/[\s,]+/) : [];
      const numbers = parsedUrl.searchParams.get("numbers") ? parsedUrl.searchParams.get("numbers").split(/[\s,]+/) : [];
      const keywords = parsedUrl.searchParams.get("keywords") ? parsedUrl.searchParams.get("keywords").split(/[\s,]+/) : [];
      const location = parsedUrl.searchParams.get("location") || "";

      let seedProfile = null;
      if (firstName || lastName || type === "person") {
        seedProfile = {
          firstName,
          lastName,
          nicknames,
          numbers,
          keywords,
          location
        };
      }

      if (!query.trim() && !seedProfile) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Query parameter or Seed Profile is required" }));
        return;
      }

      const effectiveQuery = query.trim() || `${firstName} ${lastName}`.trim();

      // Check Edge Cache
      const cacheKey = `${type}:${effectiveQuery.toLowerCase()}:dig=${dig}:depth=${digDepth}:digType=${digType}:ext=${extended}`;
      const cached = bypassCache ? null : globalEdgeCache.get(cacheKey);

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive"
      });

      const abortController = new AbortController();
      req.on("close", () => {
        abortController.abort();
      });

      const sendEvent = (event, data) => {
        if (!res.writableEnded) {
          res.write(`event: ${event}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
      };

      try {
        activeIdentityGraph = new IdentityGraph(effectiveQuery, type);

        if (cached && !cached.isStale) {
          // Serve immediately from Edge Cache with full stream event parity
          sendEvent("connected", { ok: true, cached: true, timestamp: Date.now() });
          sendEvent("ratelimit", { limit: 999999, remaining: 999999, reset: 0 });
          sendEvent("start", { total: cached.data.results.length, usernamePlatforms: cached.data.results.length });

          for (const r of cached.data.results) {
            sendEvent("checked", { total: 1, counts: { [r.platform]: 1 } });
            if (Array.isArray(r.discoveredUsernames)) {
              for (const lead of r.discoveredUsernames) {
                sendEvent("dig", lead);
              }
            }
            sendEvent("result", r);
            activeIdentityGraph.ingestProfile(r);
          }

          sendEvent("done", {
            refundedTokens: 0,
            cached: true,
            totalFound: cached.data.results.length,
            elapsedMs: 2
          });

          setTimeout(() => {
            if (!res.writableEnded) res.end();
          }, 60);
          return;
        }

        const searchRes = await executeSearch({
          query: effectiveQuery,
          type,
          seedProfile,
          dig,
          digDepth,
          digType,
          extended,
          deepRea,
          sendEvent: (event, data) => {
            sendEvent(event, data);
            if (event === "result") activeIdentityGraph.ingestProfile(data);
            if (event === "dig") activeIdentityGraph.ingestLead(data);
          },
          signal: abortController.signal
        });

        // Save in Edge Cache
        globalEdgeCache.set(cacheKey, {
          results: searchRes.results,
          graph: activeIdentityGraph.toJSON()
        });
      } catch (err) {
        sendEvent("error", { error: err.message, verificationFailed: false });
      } finally {
        setTimeout(() => {
          if (!res.writableEnded) res.end();
        }, 60);
      }
      return;
    }

    // 5. Identity Graph Endpoint: /api/graph
    if (pathname === "/api/graph") {
      if (activeIdentityGraph) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(activeIdentityGraph.toJSON(), null, 2));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ nodes: [], edges: [], message: "No active investigation graph" }));
      }
      return;
    }

    // 6. Direct REST API: /v1/:platform/:username
    const v1Match = pathname.match(/^\/v1\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/);
    if (v1Match && req.method === "GET") {
      const [, platformSlug, targetUser] = v1Match;
      const platforms = getPlatforms(false);
      const targetPlatform = platforms.find(p => p.name.toLowerCase() === platformSlug.toLowerCase());

      if (!targetPlatform) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Platform '${platformSlug}' not found` }));
        return;
      }

      try {
        const url = targetPlatform.probeUrl.replace("{username}", encodeURIComponent(targetUser));
        const probeRes = await fetch(url, {
          headers: targetPlatform.headers || { "User-Agent": "Mozilla/5.0" }
        });
        const text = await probeRes.text();
        const checkResult = await targetPlatform.check(probeRes, text, targetUser);

        if (checkResult && checkResult.exists) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            platform: targetPlatform.name,
            username: targetUser,
            profileUrl: checkResult.profileUrl || targetPlatform.url.replace("{username}", targetUser),
            displayName: checkResult.displayName || targetUser,
            isVerified: Boolean(checkResult.isVerified),
            bio: checkResult.bio || "",
            followers: checkResult.followers ?? null,
            pfpUrl: checkResult.pfpUrl || "",
            location: checkResult.location || "",
            website: checkResult.website || "",
            extras: checkResult.extras || {}
          }));
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "User not found on this platform", exists: false }));
        }
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // 7. Turnstile & Auth Mock for Compatibility
    if (pathname === "/api/auth/turnstile") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        enabled: false,
        invisible: true,
        invisibleSiteKey: "edge_local_bypass",
        invisibleVariant: "invisible",
        dashboardBypass: true
      }));
      return;
    }

    if (pathname === "/api/auth/me") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        user: "local-investigator",
        email: "investigator@localfingerprint.local",
        plan: "MAX Local Edge Unlimited",
        tokens: 999999,
        maxTokens: 999999,
        resetAt: new Date(Date.now() + 86400000).toISOString()
      }));
      return;
    }

    // 8. Device Fingerprint Registration
    if (pathname === "/api/device-fingerprint" && req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const components = JSON.parse(body || "{}");
          const fpResult = computeVisitorIdentifier(components);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(fpResult));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON body" }));
        }
      });
      return;
    }

    // 9. Export Endpoint
    if (pathname === "/api/export" && req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const { results = [], query = "investigation", type = "username", format = "json" } = JSON.parse(body || "{}");
          let output = "";
          let contentType = "application/json";
          let filename = `fingerprint_${query}_${Date.now()}.${format}`;

          if (format === "csv") {
            output = exportToCsv(results);
            contentType = "text/csv";
          } else if (format === "txt") {
            output = exportToTextDossier(results, query, type);
            contentType = "text/plain";
          } else if (format === "md") {
            output = exportToMarkdownDossier(results, query, type, activeIdentityGraph);
            contentType = "text/markdown";
          } else if (format === "html") {
            output = exportToHtmlDossier(results, query, type, activeIdentityGraph);
            contentType = "text/html; charset=utf-8";
            filename = `dossier_${query}_${Date.now()}.html`;
          } else {
            output = exportToJson(results, query, type);
            contentType = "application/json";
          }

          res.writeHead(200, {
            "Content-Type": contentType,
            "Content-Disposition": `attachment; filename="${filename}"`
          });
          res.end(output);
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // 10. REA Reverse Engineering Status & Scenario Execution
    if (pathname === "/api/rea/status" && req.method === "GET") {
      const reaStatus = await checkReaAvailability();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(reaStatus));
      return;
    }

    if ((pathname === "/api/rea/inspect" || pathname === "/api/rea/verify") && req.method === "GET") {
      const targetUrl = parsedUrl.searchParams.get("url");
      if (!targetUrl) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "URL query parameter is required" }));
        return;
      }
      try {
        const evidence = await executeReaScenario(targetUrl);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(evidence, null, 2));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    if (pathname === "/api/rea/verify" && req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", async () => {
        try {
          const { url, browserPath } = JSON.parse(body || "{}");
          if (!url) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "URL is required" }));
            return;
          }
          const evidence = await executeReaScenario(url, { browserPath });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(evidence));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // 11. Static File Serving (Web Dashboard)
    let filePath = path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("404 Not Found");
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType });
      fs.createReadStream(filePath).pipe(res);
    });
  });

  server.listen(port, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 LocalFingerprint Edge-Native Server is live!`);
    console.log(`📡 Web Dashboard: http://localhost:${port}`);
    console.log(`⚡ Streaming SSE: http://localhost:${port}/api/search?query=target&type=username`);
    console.log(`🌐 Edge Telemetry: http://localhost:${port}/api/edge/telemetry`);
    console.log(`🔗 Identity Graph: http://localhost:${port}/api/graph`);
    console.log(`🔍 Direct API:     http://localhost:${port}/v1/github/torvalds`);
    console.log(`======================================================\n`);
  });

  return server;
}

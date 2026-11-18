/**
 * Universal Edge Worker Entry Point
 * Implements standard Web API fetch(request, env, ctx) handler.
 * Deployable on Cloudflare Workers, Vercel Edge, Deno, Bun, or Node.js.
 */

import { executeSearch } from "../engine/search-orchestrator.mjs";
import { computeVisitorIdentifier } from "../device/browser-fingerprint.mjs";
import { exportToJson, exportToCsv, exportToTextDossier } from "../exporters/export-service.mjs";
import { getPlatforms } from "../platforms/catalog.mjs";
import { mintDeviceToken, verifyDeviceToken, analyzePassiveEdgeSignals } from "./passive-fingerprint.mjs";
import { globalEdgeCache } from "./cache.mjs";
import { IdentityGraph } from "../engine/identity-graph.mjs";

export default {
  /**
   * Main Edge Worker Request Dispatcher
   * @param {Request} request - Standard Fetch Request
   * @param {object} [env] - Environment bindings (KV, Secrets, etc.)
   * @param {object} [ctx] - Execution context (waitUntil, passThroughOnException)
   */
  async fetch(request, env = {}, ctx = null) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const clientIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "127.0.0.1";

    // 1. CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    // 2. Cookie & Edge Device Identification
    const cookieHeader = request.headers.get("cookie") || "";
    const cookieMatch = cookieHeader.match(/fp_did=([a-zA-Z0-9._-]+)/);
    let deviceToken = cookieMatch ? cookieMatch[1] : null;
    const tokenVerification = deviceToken ? verifyDeviceToken(deviceToken) : { valid: false };

    let shouldSetCookie = false;
    if (!tokenVerification.valid) {
      deviceToken = mintDeviceToken();
      shouldSetCookie = true;
    }

    const defaultHeaders = {
      "Access-Control-Allow-Origin": "*",
      "X-Edge-Runtime": "LocalFingerprint-Edge/2.0",
      "X-Content-Type-Options": "nosniff"
    };

    if (shouldSetCookie) {
      defaultHeaders["Set-Cookie"] = `fp_did=${deviceToken}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax; Secure`;
    }

    // 3. Passive Edge Telemetry Endpoint: /api/edge/telemetry
    if (pathname === "/api/edge/telemetry") {
      const telemetry = analyzePassiveEdgeSignals(request.headers, clientIp);
      return new Response(JSON.stringify({
        ...telemetry,
        deviceToken,
        tokenValid: tokenVerification.valid
      }, null, 2), {
        status: 200,
        headers: { ...defaultHeaders, "Content-Type": "application/json" }
      });
    }

    // 4. Streaming SSE Endpoint: /api/search & /api/demo-search
    if (pathname === "/api/search" || pathname === "/api/demo-search") {
      const query = url.searchParams.get("query") || url.searchParams.get("q") || "";
      const type = url.searchParams.get("type") || "username";
      const dig = url.searchParams.get("dig") === "true";
      const digDepth = parseInt(url.searchParams.get("dig_depth") || "1", 10);
      const extended = url.searchParams.get("extended") === "true";
      const bypassCache = url.searchParams.get("cache") === "false" ||
                          url.searchParams.get("fresh") === "true" ||
                          request.headers.get("cache-control") === "no-cache";

      if (!query.trim()) {
        return new Response(JSON.stringify({ error: "Query parameter required" }), {
          status: 400,
          headers: { ...defaultHeaders, "Content-Type": "application/json" }
        });
      }

      // Check Edge Cache
      const cacheKey = `${type}:${query.toLowerCase()}:dig=${dig}:depth=${digDepth}:ext=${extended}`;
      const cached = bypassCache ? null : globalEdgeCache.get(cacheKey);

      // Create Web ReadableStream with TransformStream for live SSE dispatch
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      const sendEvent = async (event, data) => {
        try {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          await writer.write(encoder.encode(payload));
        } catch {}
      };

      // Asynchronous search orchestrator
      const runSearchAsync = async () => {
        try {
          const graph = new IdentityGraph(query, type);

          if (cached && !cached.isStale) {
            // Instant delivery from Edge Cache with full stream event parity
            await sendEvent("connected", { ok: true, cached: true, timestamp: Date.now() });
            await sendEvent("ratelimit", { limit: 999999, remaining: 999999, reset: 0 });
            await sendEvent("start", { total: cached.data.results.length, usernamePlatforms: cached.data.results.length });

            for (const r of cached.data.results) {
              await sendEvent("checked", { total: 1, counts: { [r.platform]: 1 } });
              if (Array.isArray(r.discoveredUsernames)) {
                for (const lead of r.discoveredUsernames) {
                  await sendEvent("dig", lead);
                }
              }
              await sendEvent("result", r);
            }

            await sendEvent("done", {
              refundedTokens: 0,
              cached: true,
              totalFound: cached.data.results.length,
              elapsedMs: 2
            });
            await writer.close();
            return;
          }

          const searchRes = await executeSearch({
            query,
            type,
            dig,
            digDepth,
            extended,
            sendEvent: (event, data) => {
              sendEvent(event, data);
              if (event === "result") graph.ingestProfile(data);
              if (event === "dig") graph.ingestLead(data);
            }
          });

          // Store in Edge Cache
          globalEdgeCache.set(cacheKey, {
            results: searchRes.results,
            graph: graph.toJSON()
          });
        } catch (err) {
          sendEvent("error", { error: err.message, verificationFailed: false });
        } finally {
          try { await writer.close(); } catch {}
        }
      };

      if (ctx && typeof ctx.waitUntil === "function") {
        ctx.waitUntil(runSearchAsync());
      } else {
        runSearchAsync();
      }

      return new Response(readable, {
        status: 200,
        headers: {
          ...defaultHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive"
        }
      });
    }

    // 5. Direct REST API: /v1/:platform/:username
    const v1Match = pathname.match(/^\/v1\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/);
    if (v1Match && request.method === "GET") {
      const [, platformSlug, targetUser] = v1Match;
      const platforms = getPlatforms(false);
      const targetPlatform = platforms.find(p => p.name.toLowerCase() === platformSlug.toLowerCase());

      if (!targetPlatform) {
        return new Response(JSON.stringify({ error: `Platform '${platformSlug}' not found` }), {
          status: 404,
          headers: { ...defaultHeaders, "Content-Type": "application/json" }
        });
      }

      try {
        const url = targetPlatform.probeUrl.replace("{username}", encodeURIComponent(targetUser));
        const probeRes = await fetch(url, { headers: targetPlatform.headers || { "User-Agent": "Mozilla/5.0" } });
        const text = await probeRes.text();
        const checkResult = await targetPlatform.check(probeRes, text, targetUser);

        if (checkResult && checkResult.exists) {
          return new Response(JSON.stringify({
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
          }), {
            status: 200,
            headers: { ...defaultHeaders, "Content-Type": "application/json" }
          });
        }

        return new Response(JSON.stringify({ error: "User not found on this platform", exists: false }), {
          status: 404,
          headers: { ...defaultHeaders, "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...defaultHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // 6. Compatibility & Device Fingerprint Endpoints
    if (pathname === "/api/auth/turnstile") {
      return new Response(JSON.stringify({
        enabled: false,
        invisible: true,
        invisibleSiteKey: "edge_local_bypass",
        invisibleVariant: "invisible",
        dashboardBypass: true
      }), {
        status: 200,
        headers: { ...defaultHeaders, "Content-Type": "application/json" }
      });
    }

    if (pathname === "/api/auth/me") {
      return new Response(JSON.stringify({
        user: "local-investigator",
        email: "investigator@localfingerprint.local",
        plan: "MAX Edge Unlimited",
        tokens: 999999,
        maxTokens: 999999,
        resetAt: new Date(Date.now() + 86400000).toISOString()
      }), {
        status: 200,
        headers: { ...defaultHeaders, "Content-Type": "application/json" }
      });
    }

    if (pathname === "/api/device-fingerprint" && request.method === "POST") {
      const components = await request.json().catch(() => ({}));
      const fpResult = computeVisitorIdentifier(components);
      return new Response(JSON.stringify(fpResult), {
        status: 200,
        headers: { ...defaultHeaders, "Content-Type": "application/json" }
      });
    }

    if (pathname === "/api/export" && request.method === "POST") {
      const { results = [], query = "investigation", type = "username", format = "json" } = await request.json().catch(() => ({}));
      let output = "";
      let contentType = "application/json";
      let filename = `fingerprint_${query}_${Date.now()}.${format}`;

      if (format === "csv") {
        output = exportToCsv(results);
        contentType = "text/csv";
      } else if (format === "txt") {
        output = exportToTextDossier(results, query, type);
        contentType = "text/plain";
      } else {
        output = exportToJson(results, query, type);
        contentType = "application/json";
      }

      return new Response(output, {
        status: 200,
        headers: {
          ...defaultHeaders,
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="${filename}"`
        }
      });
    }

    return new Response("Not Found", { status: 404 });
  }
};

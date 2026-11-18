import fs from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");

// Load static fixtures into memory for sub-millisecond retrieval
const fixtures = {
  instagramRich: fs.readFileSync(path.join(FIXTURES_DIR, "instagram/profile_rich.html"), "utf8"),
  instagramMinimal: fs.readFileSync(path.join(FIXTURES_DIR, "instagram/profile_minimal.html"), "utf8"),
  instagram404: fs.readFileSync(path.join(FIXTURES_DIR, "instagram/profile_404.html"), "utf8"),
  githubProfile: fs.readFileSync(path.join(FIXTURES_DIR, "github/profile.html"), "utf8"),
  githubKeys: fs.readFileSync(path.join(FIXTURES_DIR, "github/keys.txt"), "utf8"),
  githubPatch: fs.readFileSync(path.join(FIXTURES_DIR, "github/commit_head.patch"), "utf8"),
  githubSearchUsers: fs.readFileSync(path.join(FIXTURES_DIR, "github/search_users.json"), "utf8"),
  gravatarRich: fs.readFileSync(path.join(FIXTURES_DIR, "gravatar/profile_rich.json"), "utf8"),
  gravatar404: fs.readFileSync(path.join(FIXTURES_DIR, "gravatar/profile_404.json"), "utf8"),
  linktreeProfile: fs.readFileSync(path.join(FIXTURES_DIR, "linktree/profile.html"), "utf8"),
  mxRecords: JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, "dns/mx_records.json"), "utf8")),
  reaEvidence: JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, "rea/evidence_bundle.json"), "utf8"))
};

// 1x1 transparent PNG buffer for avatar mock requests
const MOCK_IMAGE_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

let originalFetch = null;
let originalResolveMx = null;
let isInstalled = false;

/**
 * Install offline network interception for fetch and DNS resolveMx.
 * Intercepts Instagram, GitHub, Gravatar, Linktree, Reddit, Telegram, DNS MX, and image fetches.
 * Guaranteed 100% offline deterministic execution.
 */
export function installNetworkMocks() {
  if (isInstalled) return;

  originalFetch = globalThis.fetch;
  originalResolveMx = dns.resolveMx;

  // Intercept global fetch
  globalThis.fetch = async (input, init = {}) => {
    const urlStr = typeof input === "string" ? input : input?.url || input?.toString() || "";
    const parsedUrl = new URL(urlStr);
    const pathname = parsedUrl.pathname;
    const hostname = parsedUrl.hostname.toLowerCase();

    // 1. Instagram Probing
    if (hostname.includes("instagram.com")) {
      if (pathname.includes("this_user_definitely_does_not_exist") || pathname.includes("nonexistent") || pathname.includes("404")) {
        return new Response(fixtures.instagram404, {
          status: 404,
          statusText: "Not Found",
          headers: { "Content-Type": "text/html; charset=utf-8" }
        });
      }
      if (pathname.includes("johndoe") || pathname.includes("minimal")) {
        return new Response(fixtures.instagramMinimal, {
          status: 200,
          statusText: "OK",
          headers: { "Content-Type": "text/html; charset=utf-8" }
        });
      }
      // Rich Instagram profile (default for test targets such as 'harshakumar25', 'zuck')
      return new Response(fixtures.instagramRich, {
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    // 2. GitHub API & HTML
    if (hostname.includes("api.github.com")) {
      if (pathname.includes("/search/users")) {
        return new Response(fixtures.githubSearchUsers, {
          status: 200,
          statusText: "OK",
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ message: "Mock GitHub API" }), { status: 200 });
    }

    if (hostname === "github.com") {
      if (pathname.endsWith(".keys")) {
        return new Response(fixtures.githubKeys, {
          status: 200,
          statusText: "OK",
          headers: { "Content-Type": "text/plain" }
        });
      }
      if (pathname.endsWith("HEAD.patch")) {
        return new Response(fixtures.githubPatch, {
          status: 200,
          statusText: "OK",
          headers: { "Content-Type": "text/plain" }
        });
      }
      if (pathname.includes("404") || pathname.includes("nonexistent")) {
        return new Response("Not Found", { status: 404 });
      }
      return new Response(fixtures.githubProfile, {
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    // 3. Gravatar Profile Lookup
    if (hostname.includes("gravatar.com")) {
      if (pathname.endsWith(".json")) {
        if (pathname.includes("nonexistent") || pathname.includes("404") || pathname.includes("00000000000000000000000000000000")) {
          return new Response(fixtures.gravatar404, {
            status: 404,
            statusText: "Not Found",
            headers: { "Content-Type": "application/json" }
          });
        }
        return new Response(fixtures.gravatarRich, {
          status: 200,
          statusText: "OK",
          headers: { "Content-Type": "application/json" }
        });
      }
      // Avatar image
      return new Response(MOCK_IMAGE_BUFFER, {
        status: 200,
        headers: { "Content-Type": "image/png" }
      });
    }

    // 4. Linktree Profile
    if (hostname.includes("linktr.ee")) {
      if (pathname.includes("nonexistent") || pathname.includes("404")) {
        return new Response("The page you're looking for doesn't exist", { status: 404 });
      }
      return new Response(fixtures.linktreeProfile, {
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    // 5. Reddit
    if (hostname.includes("reddit.com")) {
      if (pathname.includes("about.json")) {
        if (pathname.includes("nonexistent") || pathname.includes("404")) {
          return new Response(JSON.stringify({ error: 404, message: "Not Found" }), { status: 404 });
        }
        const mockReddit = {
          data: {
            name: pathname.split("/")[2] || "harshakumar25",
            id: "t2_abc123",
            total_karma: 1250,
            link_karma: 800,
            comment_karma: 450,
            is_gold: true,
            has_verified_email: true,
            created_utc: 1600000000,
            subreddit: {
              title: "Harsha Kumar",
              public_description: "Security researcher and open-source enthusiast. https://harshakumar25.in",
              icon_img: "https://reddit.com/avatar.png",
              subscribers: 42,
              over_18: false
            },
            social_links: [
              { provider: "twitter", handle: "harshakumar", url: "https://x.com/harshakumar" },
              { provider: "github", handle: "harshakumar25", url: "https://github.com/harshakumar25" }
            ]
          }
        };
        return new Response(JSON.stringify(mockReddit), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response("Reddit HTML", { status: 200 });
    }

    // 6. Telegram
    if (hostname === "t.me") {
      if (pathname.includes("nonexistent") || pathname.includes("404")) {
        return new Response("If you have Telegram, you can contact @nonexistent right away.", { status: 200 });
      }
      const tgHtml = `
        <!DOCTYPE html><html><body>
          <div class="tgme_page_title">Harsha Kumar</div>
          <div class="tgme_page_extra">@harshakumar</div>
          <div class="tgme_page_description">Security research &amp; tools. Contact: harsha@example.com, website: https://harshakumar25.in, backup: @harshadev</div>
          <img class="tgme_page_photo_image" src="https://cdn4.telesco.pe/file/avatar.jpg" />
        </body></html>
      `;
      return new Response(tgHtml, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    // 7. Mock images and avatars
    if (
      hostname.includes("cdninstagram.com") ||
      hostname.includes("githubusercontent.com") ||
      pathname.endsWith(".png") ||
      pathname.endsWith(".jpg") ||
      pathname.endsWith(".jpeg")
    ) {
      return new Response(MOCK_IMAGE_BUFFER, {
        status: 200,
        headers: { "Content-Type": "image/png" }
      });
    }

    // 8. General Platform Fallback
    if (pathname.includes("404") || pathname.includes("nonexistent")) {
      return new Response("Not Found", { status: 404 });
    }

    return new Response("OK", { status: 200 });
  };

  // Intercept DNS MX resolution
  dns.resolveMx = async (domain) => {
    const d = (domain || "").toLowerCase().trim();
    if (fixtures.mxRecords[d]) {
      return fixtures.mxRecords[d];
    }
    // Default valid MX records for test domains
    if (d.includes("gmail")) return fixtures.mxRecords["gmail.com"];
    if (d.includes("outlook") || d.includes("microsoft")) return fixtures.mxRecords["outlook.com"];
    if (d.includes("proton")) return fixtures.mxRecords["proton.me"];
    return [{ exchange: `mail.${d}`, priority: 10 }];
  };

  isInstalled = true;
}

/**
 * Restore original global fetch and dns.resolveMx.
 */
export function restoreNetworkMocks() {
  if (!isInstalled) return;
  globalThis.fetch = originalFetch;
  dns.resolveMx = originalResolveMx;
  isInstalled = false;
}

export { fixtures };

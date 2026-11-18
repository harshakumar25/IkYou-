#!/usr/bin/env node

import { createServer } from "../src/server.mjs";
import { executeSearch } from "../src/engine/search-orchestrator.mjs";
import { exportToJson, exportToCsv, exportToTextDossier, exportToMarkdownDossier, exportToHtmlDossier } from "../src/exporters/export-service.mjs";
import { getPlatforms } from "../src/platforms/catalog.mjs";
import { checkReaAvailability, executeReaScenario } from "../src/rea-bridge.mjs";
import fs from "node:fs";

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
LocalFingerprint — High-Performance OSINT Investigation & Fingerprinting CLI
(Reverse-engineered & enhanced local replacement for fingerprint.to)

USAGE:
  localfingerprint <command> [options]

COMMANDS:
  serve                      Start the web dashboard & streaming API server
    --port <number>          Port to listen on (default: 3333)

  search <target>            Search target by username, email, phone, or person seeds
    --type <type>            Lookup type: 'username' (default), 'person', 'email', 'phone'
    --person                 Enable person seed disambiguation mode
    --numbers <list>         Known numbers/birth dates (e.g. 25,1225,2025)
    --nicknames <list>       Known nicknames/alternate handles (e.g. harsha,jhah1225)
    --keywords <list>        Keywords/affiliations (e.g. Veriqo,DOCVEX,Delhi)
    --location <place>       Target location (e.g. Delhi, India)
    --target-only            Filter out homonyms, display only high-confidence target matches
    --deep-rea               Trigger automated REA headless browser screenshot & DOM verification
    --dig                    Enable recursive identity correlation across bios
    --depth <number>         Dig recursion depth (default: 1)
    --extended               Include full 3000+ platform catalog
    --json                   Output full results as JSON
    --csv                    Output results as CSV
    --md                     Output rich markdown investigation dossier
    --out <file>             Save output to file

  rea <url>                  Deep inspect a target URL using REA Playwright/CDP browser engine
                             (Captures viewport screenshot, extracts concealed DOM emails & links)

  probe <platform> <user>    Directly probe a single platform (e.g. github, reddit)

  help                       Show this help message

EXAMPLES:
  localfingerprint serve --port 3333
  localfingerprint search "Harsh Kumar" --person --numbers 25,1225 --nicknames harsha,jhah1225 --deep-rea
  localfingerprint rea https://github.com/harshakumar25
  localfingerprint search johndoe --type username --dig
  localfingerprint probe github harshakumar25
`);
}

async function main() {
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  // 1. SERVE
  if (command === "serve") {
    let port = 3333;
    const portIdx = args.indexOf("--port");
    if (portIdx !== -1 && args[portIdx + 1]) {
      port = parseInt(args[portIdx + 1], 10);
    }
    createServer(port);
    return;
  }

  // 2. SEARCH
  if (command === "search") {
    const query = args[1];
    if (!query) {
      console.error("Error: Search query target is required. E.g.: localfingerprint search johndoe");
      process.exit(1);
    }

    let type = null;
    if (args.includes("--person")) type = "person";
    const typeIdx = args.indexOf("--type");
    if (typeIdx !== -1 && args[typeIdx + 1]) type = args[typeIdx + 1];

    // Smart Auto-Detection if not explicitly supplied
    if (!type || type === "auto") {
      const trimmedQuery = query.trim();
      if (trimmedQuery.includes("@") && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedQuery)) {
        type = "email";
      } else if ((trimmedQuery.startsWith("+") || /^\d[\d\s\-().]{6,18}\d$/.test(trimmedQuery)) && trimmedQuery.replace(/\D/g, "").length >= 7) {
        type = "phone";
      } else {
        type = "username";
      }
    }

    const numbersIdx = args.indexOf("--numbers");
    const numbers = numbersIdx !== -1 && args[numbersIdx + 1] ? args[numbersIdx + 1].split(/[\s,]+/) : [];

    const nickIdx = args.indexOf("--nicknames");
    const nicknames = nickIdx !== -1 && args[nickIdx + 1] ? args[nickIdx + 1].split(/[\s,]+/) : [];

    const kwIdx = args.indexOf("--keywords");
    const keywords = kwIdx !== -1 && args[kwIdx + 1] ? args[kwIdx + 1].split(/[\s,]+/) : [];

    const locIdx = args.indexOf("--location");
    const location = locIdx !== -1 && args[locIdx + 1] ? args[locIdx + 1] : "";

    const targetOnly = args.includes("--target-only");
    const deepRea = args.includes("--deep-rea");

    let seedProfile = null;
    if (type === "person" || numbers.length > 0 || nicknames.length > 0) {
      const nameParts = query.split(/\s+/);
      seedProfile = {
        firstName: nameParts[0] || "",
        lastName: nameParts.slice(1).join(" ") || "",
        numbers,
        nicknames,
        keywords,
        location
      };
    }

    const dig = args.includes("--dig");
    let digDepth = 1;
    const depthIdx = args.indexOf("--depth");
    if (depthIdx !== -1 && args[depthIdx + 1]) digDepth = parseInt(args[depthIdx + 1], 10);

    let digType = "both";
    const digTypeIdx = args.indexOf("--dig-type");
    if (digTypeIdx !== -1 && args[digTypeIdx + 1]) digType = args[digTypeIdx + 1];

    const extended = args.includes("--extended");
    const isJson = args.includes("--json");
    const isCsv = args.includes("--csv");
    const isMd = args.includes("--md");
    const isHtml = args.includes("--html");

    let outFile = null;
    const outIdx = args.indexOf("--out");
    if (outIdx !== -1 && args[outIdx + 1]) outFile = args[outIdx + 1];

    if (!isJson && !isCsv && !isMd) {
      console.log(`\n🔍 Searching for "${query}" (${type.toUpperCase()}) | Dig: ${dig ? `ON (depth ${digDepth}, type: ${digType})` : "OFF"} | Extended: ${extended}`);
      if (seedProfile) {
        console.log(`🎯 Identity Seeds: Name: "${seedProfile.firstName} ${seedProfile.lastName}" | Numbers: [${seedProfile.numbers.join(", ")}] | Nicknames: [${seedProfile.nicknames.join(", ")}] | Context: [${seedProfile.keywords.join(", ")}]\n`);
      } else {
        console.log("");
      }
    }

    const results = [];
    const discovered = [];

    await executeSearch({
      query,
      type,
      seedProfile,
      dig,
      digDepth,
      digType,
      extended,
      deepRea,
      sendEvent: (event, data) => {
        if (!isJson && !isCsv && !isMd) {
          if (event === "candidates") {
            console.log(`\x1b[35m🧬 [GENERATED ${data.total} SEED PERMUTATIONS]\x1b[0m: ${data.candidates.map(c => c.username).join(", ")}\n`);
          } else if (event === "result") {
            const r = data;
            const isHomonym = r.disambiguation?.isHomonym;
            const isTarget = r.disambiguation?.isTargetMatch;
            const conf = r.disambiguation ? Math.round(r.disambiguation.confidenceScore * 100) : null;

            if (targetOnly && isHomonym) return;

            if (isTarget) {
              console.log(`\x1b[32m🎯 [TARGET MATCH (${conf}%)]\x1b[0m \x1b[1m${r.platform.padEnd(16)}\x1b[0m ${r.profileUrl} (\x1b[36m@${r.username}\x1b[0m)`);
              if (r.disambiguation?.reasons?.length) {
                console.log(`        \x1b[32mEvidence:\x1b[0m ${r.disambiguation.reasons.join("; ")}`);
              }
            } else if (isHomonym) {
              console.log(`\x1b[31m⚠️ [FILTERED HOMONYM (${conf}%)]\x1b[0m \x1b[90m${r.platform.padEnd(16)} ${r.profileUrl} (@${r.username})\x1b[0m`);
              if (r.disambiguation?.flags?.length) {
                console.log(`        \x1b[90mReason:\x1b[0m ${r.disambiguation.flags.join("; ")}`);
              }
            } else {
              console.log(`\x1b[32m[FOUND]\x1b[0m \x1b[1m${r.platform.padEnd(16)}\x1b[0m ${r.profileUrl}`);
            }

            if (r.displayName && r.displayName !== r.username) {
              console.log(`        \x1b[90mDisplay:\x1b[0m ${r.displayName}`);
            }
            if (r.followers !== null && r.followers !== undefined && r.followers !== 0 && type !== "phone") {
              console.log(`        \x1b[90mFollowers:\x1b[0m ${r.followers}`);
            }
            if (r.extras?.carrier) {
              console.log(`        \x1b[33m📶 Telecom Carrier:\x1b[0m ${r.extras.carrier} | Line: ${r.extras.lineType || "Mobile"} | Circle: ${r.extras.region || r.location}`);
              if (r.extras.timezone) {
                console.log(`        \x1b[33m🕒 Timezone:\x1b[0m ${r.extras.timezone} (${r.extras.utcOffset || "UTC"})`);
              }
              if (r.extras.riskScore !== undefined) {
                const riskColor = r.extras.riskScore > 0.5 ? "\x1b[31m" : "\x1b[32m";
                console.log(`        ${riskColor}🛡️ Risk Score:\x1b[0m ${Math.round(r.extras.riskScore * 100)}% (${r.extras.riskReasons?.join(", ") || "Standard"})`);
              }
            }
            if (r.extras?.registrationEst) {
              console.log(`        \x1b[34m📅 Account Origin:\x1b[0m ${r.extras.registrationEst.label} (Confidence: ${r.extras.registrationEst.confidence})`);
            }
            if (r.visualTwins?.length) {
              const twinStr = r.visualTwins.map(t => `${t.platform} (@${t.username}) [${Math.round(t.similarity * 100)}%]`).join(", ");
              console.log(`        \x1b[32m🖼️ Visual Twin:\x1b[0m Matches ${twinStr}`);
            }
            if (r.location && !r.extras?.carrier) {
              console.log(`        \x1b[90mLocation:\x1b[0m ${r.location}`);
            }
            if (r.bio && !r.extras?.carrier) {
              console.log(`        \x1b[90mBio:\x1b[0m ${r.bio.slice(0, 100).replace(/\n/g, " ")}${r.bio.length > 100 ? "..." : ""}`);
            }
            if (r.provenance) {
              if (r.provenance.commitEmails?.length) {
                console.log(`        \x1b[35m✉ Commit Author Email:\x1b[0m \x1b[1m${r.provenance.commitEmails.join(", ")}\x1b[0m`);
              }
              if (r.provenance.timezone) {
                console.log(`        \x1b[35m🕒 Commit Timezone:\x1b[0m ${r.provenance.timezone.rawOffset} (${r.provenance.timezone.name})`);
              }
              if (r.provenance.sshKeys?.length) {
                console.log(`        \x1b[35m🔐 SSH Key:\x1b[0m ${r.provenance.sshKeys[0].fingerprint} (${r.provenance.sshKeys[0].type})`);
              }
            }
            if (r.avatarFingerprint) {
              console.log(`        \x1b[36m🖼 Avatar pHash:\x1b[0m ${r.avatarFingerprint.perceptualHash}`);
            }
            if (r.reaEvidence) {
              if (r.reaEvidence.screenshotUrl) {
                console.log(`        \x1b[32m📸 REA Screenshot:\x1b[0m ${r.reaEvidence.screenshotUrl}`);
              }
              if (r.reaEvidence.extractedEmails?.length) {
                console.log(`        \x1b[35m✉ REA Extracted Emails:\x1b[0m \x1b[1m${r.reaEvidence.extractedEmails.join(", ")}\x1b[0m`);
              }
              if (r.reaEvidence.extractedLinks?.length) {
                console.log(`        \x1b[36m🔗 REA Verified Outlinks:\x1b[0m ${r.reaEvidence.extractedLinks.slice(0, 3).join(", ")}`);
              }
            }
          } else if (event === "dig") {
            const isCrypto = data.entityType === "crypto_wallet";
            const icon = isCrypto ? "💰 [CRYPTO WALLET]" : "↪ [DISCOVERED LEAD]";
            const color = isCrypto ? "\x1b[33m" : "\x1b[36m";
            const fromText = data.from ? ` (from @${data.from})` : "";
            console.log(`  ${color}${icon}\x1b[0m ${data.username} on ${data.foundOn}${fromText}`);
          }
        }

        if (event === "result") results.push(data);
        if (event === "dig") discovered.push(data);
      }
    });

    if (isMd) {
      const out = exportToMarkdownDossier(results, query, type);
      if (outFile) fs.writeFileSync(outFile, out);
      else console.log(out);
      return;
    }

    if (isJson) {
      const out = exportToJson(results, query, type);
      if (outFile) fs.writeFileSync(outFile, out);
      else console.log(out);
      return;
    }

    if (isCsv) {
      const out = exportToCsv(results);
      if (outFile) fs.writeFileSync(outFile, out);
      else console.log(out);
      return;
    }

    if (isHtml) {
      const out = exportToHtmlDossier(results, query, type);
      if (outFile) {
        fs.writeFileSync(outFile, out);
        console.log(`Saved forensic HTML investigation dossier to ${outFile}`);
      } else {
        console.log(out);
      }
      return;
    }

    const visualTwinCount = results.filter(r => r.visualTwins?.length > 0).length;

    console.log(`\n======================================================`);
    console.log(`✨ Search Complete: ${results.length} verified footprint(s) found!`);
    if (discovered.length) console.log(`🔗 Correlated Identities Discovered: ${discovered.length}`);
    if (visualTwinCount > 0) console.log(`🖼️ Biometric Visual Twins Correlated: ${visualTwinCount} profile(s) matched`);
    console.log(`======================================================\n`);

    if (outFile) {
      fs.writeFileSync(outFile, exportToTextDossier(results, query, type));
      console.log(`Saved investigation dossier to ${outFile}`);
    }
    return;
  }

  // 3. PROBE SINGLE PLATFORM
  if (command === "probe") {
    const platformSlug = args[1];
    const targetUser = args[2];
    if (!platformSlug || !targetUser) {
      console.error("Usage: localfingerprint probe <platform> <username>");
      process.exit(1);
    }

    const platforms = getPlatforms(false);
    const target = platforms.find(p => p.name.toLowerCase() === platformSlug.toLowerCase());
    if (!target) {
      console.error(`Unknown platform: ${platformSlug}`);
      process.exit(1);
    }

    console.log(`Probing ${target.name} for '${targetUser}'...`);
    const probeUrl = target.probeUrl.replace("{username}", encodeURIComponent(targetUser));
    const res = await fetch(probeUrl, { headers: target.headers || { "User-Agent": "Mozilla/5.0" } });
    const text = await res.text();
    const result = await target.check(res, text, targetUser);

    if (result && result.exists) {
      console.log(`\x1b[32m✔ User FOUND on ${target.name}!\x1b[0m`);
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`\x1b[31m✖ User NOT found on ${target.name}.\x1b[0m`);
    }
    return;
  }

  // 4. REA DEEP INSPECTOR
  if (command === "rea") {
    const targetUrl = args[1];
    if (!targetUrl) {
      console.error("Usage: localfingerprint rea <url>");
      console.error("Example: localfingerprint rea https://github.com/harshakumar25");
      process.exit(1);
    }

    console.log(`\n🔬 [REA DEEP INSPECTOR] Launching Playwright browser verification for: ${targetUrl}`);
    const isAvail = await checkReaAvailability();
    if (!isAvail.available) {
      console.error(`✖ REA CLI not available. Path: /Users/harshkumar/Desktop/projects/osint_toolkit/rea/scripts/rea.mjs`);
      process.exit(1);
    }
    console.log(`🌐 Browser engine: ${isAvail.browser || "Brave/Chromium"}`);
    console.log(`⏳ Executing bounded scenario, rendering DOM & capturing evidence...`);

    const result = await executeReaScenario(targetUrl, { waitMs: 2500 });
    if (!result.success) {
      console.error(`✖ REA scenario failed: ${result.error || result.reason}`);
      process.exit(1);
    }

    console.log(`\n======================================================`);
    console.log(`✔ REA Scenario Completed Successfully!`);
    console.log(`======================================================`);
    console.log(`🔗 Target URL:          ${result.targetUrl}`);
    if (result.effectiveUrl && result.effectiveUrl !== result.targetUrl) {
      console.log(`🔀 Normalized Web URL:  \x1b[36m${result.effectiveUrl}\x1b[0m (Scheme Auto-Pivot)`);
    }
    if (result.screenshotUrl) {
      console.log(`📸 Viewport Screenshot: \x1b[32m${result.screenshotUrl}\x1b[0m`);
      console.log(`🔐 Screenshot SHA256:   \x1b[90m${result.screenshotSha256 || "N/A"}\x1b[0m`);
    }
    if (result.extractedEmails?.length) {
      console.log(`✉ Extracted Emails:     \x1b[35m\x1b[1m${result.extractedEmails.join(", ")}\x1b[0m`);
    } else {
      console.log(`✉ Extracted Emails:     None detected in rendered DOM`);
    }
    if (result.extractedLinks?.length) {
      console.log(`🌐 Extracted Social Links:`);
      for (const l of result.extractedLinks) {
        console.log(`   - \x1b[36m${l}\x1b[0m`);
      }
    }
    console.log(`📜 Evidence ID:         ${result.evidenceId || "REA-VERIFIED"}`);
    console.log(`======================================================\n`);
    return;
  }

  console.error(`Unknown command: ${command}. Run 'localfingerprint help' for available commands.`);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});

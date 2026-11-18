import test from "node:test";
import assert from "node:assert/strict";
import { estimateInstagramCreationDate } from "../src/engine/instagram-resolver.mjs";
import { correlateAvatars } from "../src/engine/avatar-hasher.mjs";
import { searchGitHubCommitAuthor } from "../src/engine/git-provenance.mjs";
import { checkEmail } from "../src/engine/email-checker.mjs";
import { exportToHtmlDossier } from "../src/exporters/export-service.mjs";
import { executeReaScenario } from "../src/rea-bridge.mjs";

test("Instagram Numeric ID Chronology Engine - Accurately estimates account creation year", () => {
  // Test target Harsh Kumar's numeric ID: 8652939026
  const estHarsh = estimateInstagramCreationDate("8652939026");
  assert.ok(estHarsh, "Should return an estimation object");
  assert.equal(estHarsh.estimatedYear, 2018);
  assert.equal(estHarsh.period, "2018");
  assert.equal(estHarsh.confidence, "High");
  assert.ok(estHarsh.accountAgeYears >= 6, "Account age should be at least 6 years");

  // Test early 2010 launch ID
  const est2010 = estimateInstagramCreationDate("54210");
  assert.equal(est2010.estimatedYear, 2010);
  assert.ok(est2010.period.includes("Launch Period"));

  // Test 2014 ID
  const est2014 = estimateInstagramCreationDate("1200000000");
  assert.equal(est2014.estimatedYear, 2014);

  // Test invalid or missing ID
  assert.equal(estimateInstagramCreationDate(""), null);
  assert.equal(estimateInstagramCreationDate(null), null);
  assert.equal(estimateInstagramCreationDate("not-a-number"), null);
});

test("Biometric Avatar Twin Correlation - Matches identical and perceptual avatars across platforms", () => {
  const profileGitHub = {
    platform: "GitHub",
    username: "harshakumar25",
    pfpUrl: "https://avatars.githubusercontent.com/u/12345?v=4",
    avatarFingerprint: {
      sha256: "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
      md5: "0123456789abcdef0123456789abcdef",
      perceptualHash: "f0f0f0f00f0f0f0f"
    },
    disambiguation: {
      isTargetMatch: true,
      confidenceScore: 0.88,
      reasons: ["Exact seed match"]
    }
  };

  const profileInstagram = {
    platform: "Instagram",
    username: "harshakumar25",
    pfpUrl: "https://scontent.cdninstagram.com/avatar.jpg",
    avatarFingerprint: {
      sha256: "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899", // exact image reuse
      md5: "0123456789abcdef0123456789abcdef",
      perceptualHash: "f0f0f0f00f0f0f0f"
    },
    disambiguation: {
      isTargetMatch: false,
      confidenceScore: 0.65,
      reasons: []
    }
  };

  const results = [profileGitHub, profileInstagram];
  const twins = correlateAvatars(results);

  assert.equal(twins.length, 1, "Should discover 1 visual twin cluster");
  assert.equal(twins[0].similarity, 1.0, "Exact image reuse should have 100% similarity");
  assert.ok(profileGitHub.visualTwins.length > 0, "GitHub should have visualTwin assigned");
  assert.ok(profileInstagram.visualTwins.length > 0, "Instagram should have visualTwin assigned");

  // Verify disambiguation boost: Instagram should be elevated to target match >= 95%
  assert.equal(profileInstagram.disambiguation.isTargetMatch, true);
  assert.ok(profileInstagram.disambiguation.confidenceScore >= 0.95);
  assert.ok(profileInstagram.disambiguation.reasons.some(r => r.includes("Biometric Avatar Match")));
});

test("GitHub Commit Author Search - Handles invalid queries cleanly", async () => {
  const result = await searchGitHubCommitAuthor("invalid-no-at-sign");
  assert.equal(result, null);
});

test("Email Intelligence Pipeline - Discovers Breach & Leak Index with 5 OSINT vectors", async () => {
  const discovered = [];
  const checked = [];

  await checkEmail("jhah1225@gmail.com", (res) => {
    discovered.push(res);
  }, (prog) => {
    checked.push(prog);
  });

  const breachProfile = discovered.find(p => p.platform === "Breach & Leak Index");
  assert.ok(breachProfile, "Breach & Leak Index should be emitted");
  assert.ok(Array.isArray(breachProfile.extras?.dorks), "Should have dorks array");
  assert.equal(breachProfile.extras.dorks.length, 5, "Should generate 5 breach dorks");
  assert.ok(breachProfile.extras.haveIBeenPwnedUrl.includes("haveibeenpwned.com"));
  assert.ok(breachProfile.extras.intelXUrl.includes("intelx.io"));
  assert.ok(breachProfile.extras.dehashedUrl.includes("dehashed.com"));
});

test("Standalone Forensic HTML Dossier Exporter - Generates valid print-ready HTML", () => {
  const mockProfiles = [
    {
      platform: "GitHub",
      username: "harshakumar25",
      displayName: "Harsh Kumar",
      profileUrl: "https://github.com/harshakumar25",
      pfpUrl: "https://avatars.githubusercontent.com/u/12345",
      bio: "Full stack developer",
      isVerified: false,
      followers: 12,
      emails: ["jhah1225@gmail.com"],
      phones: [],
      disambiguation: {
        isTargetMatch: true,
        confidenceScore: 0.96
      },
      provenance: {
        sshKeys: [{ fingerprint: "SHA256:mockfingerprint123456" }],
        timezone: { name: "IST (India Standard Time, UTC+5:30)", rawOffset: "+0530" },
        commitEmails: ["jhah1225@gmail.com"]
      }
    },
    {
      platform: "Instagram",
      username: "harshakumar25",
      displayName: "Harsha Kumar",
      userId: "8652939026",
      profileUrl: "https://instagram.com/harshakumar25",
      pfpUrl: "https://scontent.cdninstagram.com/avatar.jpg",
      bio: "Tech enthusiast",
      isVerified: false,
      followers: 63,
      emails: [],
      phones: [],
      extras: {
        registrationEst: {
          estimatedYear: 2018,
          period: "2018",
          accountAgeYears: 8
        }
      },
      disambiguation: {
        isTargetMatch: true,
        confidenceScore: 0.95
      }
    }
  ];

  const html = exportToHtmlDossier(mockProfiles, "Harsh Kumar", "person");
  assert.ok(typeof html === "string");
  assert.ok(html.includes("<!DOCTYPE html>"), "Should be HTML5");
  assert.ok(html.includes("OSINT Forensic Investigation Dossier"));
  assert.ok(html.includes("harshakumar25"));
  assert.ok(html.includes("jhah1225@gmail.com"));
  assert.ok(html.includes("8652939026"));
  assert.ok(html.includes("@media print"), "Should include print-to-PDF stylesheet");
  assert.ok(html.includes("window.print()"), "Should have print action");
});

test("REA Bridge - Auto-pivots tel: schemes to web endpoints and rejects unsupported schemes safely", async () => {
  // Test non-HTTP scheme gracefully rejected without CLI crash
  const fakeRes = await executeReaScenario("fake://invalid-scheme");
  assert.equal(fakeRes.success, false);
  assert.ok(fakeRes.reason.includes("Browser inspection requires valid HTTP(S)"));

  // Test tel: auto-pivot
  const telRes = await executeReaScenario("tel:+918521012345");
  assert.ok(telRes.effectiveUrl.includes("truecaller.com/search/in/8521012345") || telRes.effectiveUrl.includes("http"));
});

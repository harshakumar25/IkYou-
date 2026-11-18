import test from "node:test";
import assert from "node:assert/strict";
import { validateEmail } from "../src/engine/email-checker.mjs";
import { normalizePhone, parsePhone } from "../src/engine/phone-checker.mjs";
import { extractDigLeads } from "../src/engine/dig-engine.mjs";
import { computeVisitorIdentifier } from "../src/device/browser-fingerprint.mjs";
import { MAJOR_PLATFORMS } from "../src/platforms/definitions.mjs";
import { exportToJson, exportToCsv, exportToTextDossier, exportToMarkdownDossier } from "../src/exporters/export-service.mjs";

test("Email Validator adheres to RFC and fingerprint.to specifications", () => {
  assert.equal(validateEmail("user@example.com"), true);
  assert.equal(validateEmail("john.doe+test@gmail.com"), true);
  assert.equal(validateEmail("invalid-email"), false);
  assert.equal(validateEmail("@no-user.com"), false);
  assert.equal(validateEmail("user@.com"), false);
});

test("Phone Normalizer and Parser format international numbers", () => {
  assert.equal(normalizePhone("+1 (415) 555-0123"), "+14155550123");
  assert.equal(normalizePhone("0044 7911 123456"), "+447911123456");

  const usParsed = parsePhone("+14155550123");
  assert.equal(usParsed.countryCode, "1");
  assert.equal(usParsed.iso, "US/CA");

  const ukParsed = parsePhone("+447911123456");
  assert.equal(ukParsed.countryCode, "44");
  assert.equal(ukParsed.country, "United Kingdom");
});

test("Dig Engine extracts social handles and emails from profile text", () => {
  const sampleProfile = {
    platform: "GitHub",
    username: "dev_john",
    bio: "Full stack engineer. Check out my tweets @johndoe_dev and my youtube.com/@johndoe_vids. Email: contact@johndoe.net",
    website: "https://twitter.com/johndoe_real",
    extras: {}
  };

  const leads = extractDigLeads(sampleProfile);
  assert.ok(leads.length >= 3);

  const handles = leads.map(l => l.username);
  assert.ok(handles.includes("johndoe_dev"));
  assert.ok(handles.includes("johndoe_vids"));
  assert.ok(handles.includes("contact@johndoe.net"));
});

test("Device Fingerprinting computes deterministic SHA-256 visitor ID", () => {
  const components = {
    canvasHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    webglVendor: "Google Inc. (Apple)",
    webglRenderer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Version 15.0)",
    audioHash: "124.872314",
    screenResolution: "1920x1080",
    colorDepth: 24,
    platform: "MacIntel",
    timezone: "America/New_York"
  };

  const id1 = computeVisitorIdentifier(components);
  const id2 = computeVisitorIdentifier(components);

  assert.equal(id1.visitorId, id2.visitorId);
  assert.equal(id1.visitorId.length, 64);
  assert.ok(id1.confidenceScore >= 0.8);
});

test("Major platforms catalog has required fields and unique names", () => {
  assert.ok(MAJOR_PLATFORMS.length >= 25);
  const names = new Set();
  for (const p of MAJOR_PLATFORMS) {
    assert.ok(p.name, "Platform must have a name");
    assert.ok(p.url, "Platform must have a URL template");
    assert.ok(p.probeUrl, "Platform must have a probe URL");
    assert.equal(typeof p.check, "function", "Platform must have check function");
    assert.equal(names.has(p.name), false, `Duplicate platform name: ${p.name}`);
    names.add(p.name);
  }
});

test("Export service generates JSON, CSV, and Text Dossier", () => {
  const sampleResults = [
    {
      platform: "GitHub",
      username: "torvalds",
      displayName: "Linus Torvalds",
      profileUrl: "https://github.com/torvalds",
      followers: 210000,
      following: 0,
      isVerified: true,
      location: "Portland, OR",
      bio: "Creator of Linux and Git",
      sourceQuery: "torvalds"
    }
  ];

  const jsonStr = exportToJson(sampleResults, "torvalds", "username");
  assert.ok(jsonStr.includes("Linus Torvalds"));

  const csvStr = exportToCsv(sampleResults);
  assert.ok(csvStr.includes('"GitHub","torvalds"'));

  const dossierStr = exportToTextDossier(sampleResults, "torvalds", "username");
  assert.ok(dossierStr.includes("LOCALFINGERPRINT OSINT INVESTIGATION DOSSIER"));

  const mdDossier = exportToMarkdownDossier(sampleResults, "torvalds", "username");
  assert.ok(mdDossier.includes("# OSINT Intelligence Dossier: `torvalds`"));
  assert.ok(mdDossier.includes("## 🌳 Identity Correlation Tree"));
});

test("Dig Engine extracts cryptocurrency addresses from bio text", () => {
  const cryptoBioProfile = {
    platform: "Keybase",
    username: "crypto_whale",
    bio: "Tips appreciated: BTC bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq ETH 0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
    website: "https://solana.com",
    extras: {}
  };

  const leads = extractDigLeads(cryptoBioProfile, "both");
  const btcLead = leads.find(l => l.queryType === "crypto" && l.username.startsWith("bc1"));
  const ethLead = leads.find(l => l.queryType === "crypto" && l.username.startsWith("0x"));

  assert.ok(btcLead, "Must extract Bitcoin SegWit address");
  assert.ok(ethLead, "Must extract Ethereum address");
  assert.equal(btcLead.entityType, "crypto_wallet");
  assert.equal(ethLead.entityType, "crypto_wallet");
});

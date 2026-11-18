import test from "node:test";
import assert from "node:assert/strict";
import { mintDeviceToken, verifyDeviceToken, analyzePassiveEdgeSignals } from "../src/edge/passive-fingerprint.mjs";
import { globalEdgeCache } from "../src/edge/cache.mjs";
import { IdentityGraph } from "../src/engine/identity-graph.mjs";
import { buildStealthHeaders } from "../src/edge/anti-detection.mjs";

test("fp_did Token Engine mints valid v1 tokens matching reverse-engineered format", () => {
  const token = mintDeviceToken();
  const parts = token.split(".");
  assert.equal(parts.length, 4, "Token must have 4 segments: v1.did.ts.sig");
  assert.equal(parts[0], "v1");

  const verification = verifyDeviceToken(token);
  assert.equal(verification.valid, true);
  assert.equal(verification.version, "v1");
  assert.ok(verification.deviceId.length === 32, "16 bytes in hex = 32 chars");
  assert.ok(verification.timestamp > 0);
});

test("fp_did Token Engine rejects forged or tampered signatures", () => {
  const legitimate = mintDeviceToken();
  const parts = legitimate.split(".");

  // Tamper with timestamp
  const tampered = `${parts[0]}.${parts[1]}.${parseInt(parts[2], 10) + 100}.${parts[3]}`;
  const res = verifyDeviceToken(tampered);
  assert.equal(res.valid, false);
  assert.ok(res.error.includes("HMAC signature mismatch"));
});

test("Passive Edge Signals analyzer extracts header ordering and detects bots", () => {
  const realBrowserHeaders = {
    "host": "localhost",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "sec-ch-ua": '"Google Chrome";v="131"',
    "sec-ch-ua-platform": '"macOS"',
    "accept-language": "en-US,en;q=0.9",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate"
  };

  const humanSignals = analyzePassiveEdgeSignals(realBrowserHeaders);
  assert.equal(humanSignals.isBot, false);
  assert.ok(humanSignals.headerOrderFingerprint.length === 32);

  const botHeaders = {
    "user-agent": "python-requests/2.31.0",
    "host": "localhost"
  };

  const botSignals = analyzePassiveEdgeSignals(botHeaders);
  assert.equal(botSignals.isBot, true);
  assert.ok(botSignals.detectionFlags.length >= 1);
});

test("Edge LRU Cache respects TTL and capacity eviction", () => {
  globalEdgeCache.set("test:key1", { value: 42 }, 1000);
  assert.equal(globalEdgeCache.has("test:key1"), true);
  const item = globalEdgeCache.get("test:key1");
  assert.equal(item.data.value, 42);

  // Normalization check
  const itemUpper = globalEdgeCache.get("TEST:KEY1");
  assert.equal(itemUpper.data.value, 42);
});

test("Identity Graph ingests profiles and generates connected nodes & edges", () => {
  const graph = new IdentityGraph("alice_crypto", "username");
  graph.ingestProfile({
    platform: "GitHub",
    username: "alice_crypto",
    displayName: "Alice Wonderland",
    profileUrl: "https://github.com/alice_crypto",
    emails: ["alice@cryptocorp.io"],
    website: "https://alice.dev",
    discoveredUsernames: [
      { username: "alice_tweets", foundOn: "Twitter", from: "alice_crypto", queryType: "username" }
    ]
  });

  const json = graph.toJSON();
  assert.ok(json.nodeCount >= 4, "Should contain root, profile, email, website, and lead nodes");
  assert.ok(json.edgeCount >= 3, "Should contain ownership and correlation edges");

  const edgeTypes = json.edges.map(e => e.relation);
  assert.ok(edgeTypes.includes("owns_account"));
  assert.ok(edgeTypes.includes("associated_email"));
  assert.ok(edgeTypes.includes("links_website"));

  // Check multi-tier level classification
  const rootNode = json.nodes.find(n => n.id === "root:username:alice_crypto");
  assert.equal(rootNode.level, 0, "Root node must be level 0");

  const profileNode = json.nodes.find(n => n.id === "profile:github:alice_crypto");
  assert.equal(profileNode.level, 1, "Direct match profile must be level 1");

  const emailNode = json.nodes.find(n => n.id === "email:alice@cryptocorp.io");
  assert.equal(emailNode.level, 2, "Email node must be level 2");

  // Ingest recursive Level 3 branch profile
  graph.ingestProfile({
    platform: "Twitter",
    username: "alice_tweets",
    displayName: "Alice on X",
    profileUrl: "https://twitter.com/alice_tweets"
  });

  const updatedJson = graph.toJSON();
  const branchProfileNode = updatedJson.nodes.find(n => n.id === "profile:twitter:alice_tweets");
  assert.ok(branchProfileNode, "Branch profile must be ingested");
  assert.equal(branchProfileNode.level, 3, "Recursive branch profile must be level 3");
});

test("Stealth Headers generator sets modern browser headers and client hints", () => {
  const headers = buildStealthHeaders({ "X-Custom": "test" });
  assert.ok(headers.get("user-agent").includes("Mozilla/5.0"));
  assert.ok(headers.get("sec-ch-ua") !== null);
  assert.equal(headers.get("x-custom"), "test");
});

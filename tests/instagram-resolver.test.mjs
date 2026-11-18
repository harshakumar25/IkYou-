import test from "node:test";
import assert from "node:assert/strict";
import { probeInstagramUser, findInstagramAccountsFromEmail } from "../src/engine/instagram-resolver.mjs";
import { executeReaScenario } from "../src/rea-bridge.mjs";

test("Instagram probe accurately distinguishes existing accounts from non-existent accounts", async () => {
  // Test existing public profile
  const existing = await probeInstagramUser("zuck");
  assert.equal(existing.exists, true, "zuck must exist on Instagram");
  assert.equal(existing.platform, "Instagram");
  assert.equal(existing.username, "zuck");
  assert.ok(existing.displayName.includes("Mark"), `Display name should include Mark, got ${existing.displayName}`);
  assert.ok(existing.userId, "Must extract Instagram internal user ID");
  assert.ok(existing.followers !== null, "Must extract followers count");

  // Test non-existent handle
  const nonExisting = await probeInstagramUser("this_user_definitely_does_not_exist_9988112233");
  assert.equal(nonExisting.exists, false, "Non-existent handle must return exists: false");
});

test("Instagram resolver discovers target account from email address", async () => {
  const email = "jhah1225@gmail.com";
  const accounts = await findInstagramAccountsFromEmail(email, {
    fullName: "Harsh Kumar",
    additionalCandidates: ["harshakumar25"],
    deepRea: false
  });

  assert.ok(Array.isArray(accounts), "Should return array of accounts");
  assert.ok(accounts.length > 0, "Should resolve at least 1 account from email");

  const targetAccount = accounts.find(a => a.username === "harshakumar25");
  assert.ok(targetAccount, "Must find user's Instagram account 'harshakumar25'");
  assert.equal(targetAccount.displayName, "Harsha Kumar");
  assert.equal(targetAccount.userId, "8652939026");
  assert.equal(targetAccount.profileUrl, "https://www.instagram.com/harshakumar25");
  assert.ok(targetAccount.pfpUrl.includes("scontent.cdninstagram.com"), "Must have CDN avatar URL");
});

test("Instagram handle format validation rejects invalid handles", async () => {
  const invalidShort = await probeInstagramUser("");
  assert.equal(invalidShort.exists, false);

  const invalidLong = await probeInstagramUser("a".repeat(35));
  assert.equal(invalidLong.exists, false);
});

test("REA browser scenario inspection extracts Instagram metadata and viewport screenshot without reference errors", async () => {
  const reaResult = await executeReaScenario("https://www.instagram.com/harshakumar25/", { waitMs: 1500 });
  assert.equal(reaResult.success, true, "REA execution must succeed");
  assert.ok(reaResult.screenshotUrl, "Must capture viewport screenshot");
  assert.ok(reaResult.screenshotSha256, "Must generate screenshot SHA256");
  assert.ok(reaResult.instagramMeta, "instagramMeta must be defined and returned");
  assert.equal(reaResult.instagramMeta.displayName, "Harsha Kumar");
  assert.equal(reaResult.instagramMeta.userId, "8652939026");
  assert.equal(reaResult.instagramMeta.followers, "63");
});

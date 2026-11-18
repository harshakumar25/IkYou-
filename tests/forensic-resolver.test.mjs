import test from "node:test";
import assert from "node:assert/strict";
import { resolveMailProvider, analyzeEmailForensics, expandSeedsWithForensics } from "../src/engine/forensic-resolver.mjs";

test("Mail provider resolver discovers MX records and fingerprints major providers", async () => {
  const gmailInfo = await resolveMailProvider("gmail.com");
  assert.equal(gmailInfo.provider, "Google Workspace / Gmail");
  assert.ok(gmailInfo.mxRecords.length >= 1);

  const outlookInfo = await resolveMailProvider("outlook.com");
  assert.equal(outlookInfo.provider, "Microsoft 365 / Outlook");
  assert.ok(outlookInfo.mxRecords.length >= 1);
});

test("Email forensics analyzer extracts Gravatar hash and decomposes semantic tokens", async () => {
  const forensics = await analyzeEmailForensics("jhah1225@gmail.com");
  assert.equal(forensics.localPart, "jhah1225");
  assert.equal(forensics.domain, "gmail.com");
  assert.equal(forensics.mailProvider, "Google Workspace / Gmail");
  assert.equal(forensics.gravatarHash, "01e49317f468aaf309f97dba68b9c8e0");

  assert.ok(forensics.extractedTokens.numbers.includes("1225"), "Must extract numeric token 1225");
  assert.ok(forensics.extractedTokens.alpha.includes("jhah"), "Must extract alphabetic token jhah");
});

test("Seed expansion feedback loop enriches target seeds from recovered leads", () => {
  const baseSeeds = {
    firstName: "Harsh",
    lastName: "Kumar",
    nicknames: ["harshu"],
    numbers: ["25"]
  };

  const recoveredLeads = [
    { username: "jhah1225@gmail.com", queryType: "email" },
    { username: "jhah1225", queryType: "username" }
  ];

  const enriched = expandSeedsWithForensics(baseSeeds, recoveredLeads);
  assert.ok(enriched.nicknames.includes("jhah1225"), "Must add recovered handle as nickname lead");
  assert.ok(enriched.numbers.includes("1225"), "Must add extracted number 1225");
  assert.ok(enriched.numbers.includes("25"), "Must preserve original number 25");
});

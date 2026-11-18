import test from "node:test";
import assert from "node:assert/strict";
import { generatePermutationMatrix, isCandidateAllowedOnPlatform } from "../src/engine/seed-permutator.mjs";
import { disambiguateProfile, clusterDisambiguatedProfiles } from "../src/engine/entity-disambiguator.mjs";
import { checkReaAvailability } from "../src/rea-bridge.mjs";

test("Seed Permutator generates high-confidence candidate matrix with phonetic expansion", () => {
  const seeds = {
    firstName: "Harsh",
    lastName: "Kumar",
    nicknames: ["harshu"],
    numbers: ["25", "1998"],
    keywords: ["dev"]
  };

  const candidates = generatePermutationMatrix(seeds);
  assert.ok(candidates.length >= 10, "Should generate a rich candidate matrix");

  const usernames = candidates.map(c => c.username);

  // Must contain user's exact account pattern: harshakumar25 (phonetic vowel expansion + number)
  assert.ok(usernames.includes("harshakumar25"), "Must generate phonetic expansion 'harshakumar25'");
  assert.ok(usernames.includes("harshkumar25"), "Must generate standard 'harshkumar25'");
  assert.ok(usernames.includes("harshk25"), "Must generate initial pattern 'harshk25'");
  assert.ok(usernames.includes("harshu25"), "Must generate nickname pattern 'harshu25'");
  assert.ok(usernames.includes("harsh_kumar25"), "Must generate separator pattern 'harsh_kumar25'");

  // Verify prior weights
  const targetCand = candidates.find(c => c.username === "harshakumar25");
  assert.ok(targetCand.priorWeight >= 0.90, "Target combination must have high prior weight");
  assert.equal(targetCand.isHomonymRisk, false, "Specific number combination must NOT be homonym risk");

  // Verify generic candidate is flagged as homonym risk
  const genericCand = candidates.find(c => c.username === "harshkumar");
  assert.ok(genericCand, "Must generate generic handle");
  assert.equal(genericCand.isHomonymRisk, true, "Generic 'harshkumar' must be flagged as homonym risk");
});

test("Platform constraint validator filters candidates per site rules", () => {
  // GitHub disallows underscores
  assert.equal(isCandidateAllowedOnPlatform("harsh_kumar25", { name: "GitHub" }), false);
  assert.equal(isCandidateAllowedOnPlatform("harsh-kumar25", { name: "GitHub" }), true);

  // Twitter disallows dots and has 15-char max
  assert.equal(isCandidateAllowedOnPlatform("harsh.kumar", { name: "Twitter" }), false);
  assert.equal(isCandidateAllowedOnPlatform("this_is_a_very_long_handle_exceeding_15", { name: "Twitter" }), false);
  assert.equal(isCandidateAllowedOnPlatform("harsh_k25", { name: "Twitter" }), true);

  // Telegram requires min 5 chars
  assert.equal(isCandidateAllowedOnPlatform("hk25", { name: "Telegram" }), false);
  assert.equal(isCandidateAllowedOnPlatform("harshkumar25", { name: "Telegram" }), true);
});

test("Entity Disambiguator successfully separates Target from Unrelated Homonym", () => {
  const seeds = {
    firstName: "Harsh",
    lastName: "Kumar",
    nicknames: ["harshu"],
    numbers: ["25"],
    keywords: ["developer", "tech"],
    location: "India"
  };

  // Case 1: Real Target Account (Harsh Kumar with birth day 25, developer in India)
  const targetProfile = {
    platform: "GitHub",
    username: "harshakumar25",
    displayName: "Harsh Kumar",
    bio: "Full stack developer & cybersecurity student from Delhi",
    location: "Delhi, India",
    website: "https://harshkumar.dev",
    extras: {}
  };

  const targetDisambiguation = disambiguateProfile(targetProfile, seeds);
  assert.equal(targetDisambiguation.verdict, "TARGET_MATCH", "Target profile must be classified as TARGET_MATCH");
  assert.ok(targetDisambiguation.confidenceScore >= 0.80, `Confidence score must be >= 0.80, got ${targetDisambiguation.confidenceScore}`);
  assert.equal(targetDisambiguation.isTargetMatch, true);
  assert.equal(targetDisambiguation.isHomonym, false);

  // Case 2: Unrelated Homonym (Different person sharing name "Harsh Kumar" in UK / Medical doctor)
  const homonymDoctor = {
    platform: "Twitter",
    username: "harshkumar",
    displayName: "Dr. Harsh Kumar",
    bio: "Consultant Orthopedic Surgeon at NHS London. Tweets on healthcare and surgery.",
    location: "London, UK",
    extras: {}
  };

  const homonymDisambiguation = disambiguateProfile(homonymDoctor, seeds);
  assert.equal(homonymDisambiguation.verdict, "UNRELATED_HOMONYM", "Doctor in UK must be classified as UNRELATED_HOMONYM");
  assert.ok(homonymDisambiguation.confidenceScore < 0.50);
  assert.equal(homonymDisambiguation.isHomonym, true);

  // Case 3: Complete stranger who took "harshkumar" on Steam
  const steamStranger = {
    platform: "Steam",
    username: "harshkumar",
    displayName: "NaraKa_Gamer",
    bio: "CS:GO only",
    location: "Bern, Switzerland",
    extras: {}
  };

  const strangerDisambiguation = disambiguateProfile(steamStranger, seeds);
  assert.equal(strangerDisambiguation.verdict, "UNRELATED_HOMONYM");
  assert.equal(strangerDisambiguation.isHomonym, true);
});

test("Cluster engine partitions profiles into Target Accounts and Filtered Homonyms", () => {
  const seeds = {
    firstName: "Harsh",
    lastName: "Kumar",
    numbers: ["25"],
    keywords: ["developer"],
    location: "India"
  };

  const results = [
    {
      platform: "GitHub",
      username: "harshakumar25",
      displayName: "Harsh Kumar",
      bio: "Developer",
      location: "India"
    },
    {
      platform: "Twitter",
      username: "harshkumar",
      displayName: "Dr. Harsh Kumar",
      bio: "Surgeon in UK",
      location: "London, UK"
    },
    {
      platform: "DockerHub",
      username: "harshkumar",
      displayName: "harshkumar",
      location: "Italy"
    }
  ];

  const clustered = clusterDisambiguatedProfiles(results, seeds);
  assert.equal(clustered.targetAccounts.length, 1, "Must have exactly 1 target account");
  assert.equal(clustered.targetAccounts[0].username, "harshakumar25");
  assert.equal(clustered.filteredHomonyms.length, 2, "Must filter out 2 unrelated homonyms");
  assert.equal(clustered.stats.confirmedTargetCount, 1);
  assert.equal(clustered.stats.filteredHomonymCount, 2);
});

test("REA Toolchain Bridge is verified and operational", async () => {
  const rea = await checkReaAvailability();
  assert.equal(rea.available, true, "REA toolchain must be available in repository");
  assert.equal(rea.version, "6.9.0");
});

test("Disambiguator utilizes VCS provenance and project repositories to reach 95%+ confidence", () => {
  const seeds = {
    firstName: "Harsh",
    lastName: "Kumar",
    numbers: ["25", "1225", "2025"],
    nicknames: ["jhah1225", "harsha"],
    keywords: ["Veriqo", "DOCVEX"],
    location: "Delhi"
  };

  const candidates = generatePermutationMatrix(seeds);
  const candUsernames = candidates.map(c => c.username);
  assert.ok(candUsernames.includes("jhah1225"), "Must include literal nickname 'jhah1225'");
  assert.ok(candUsernames.includes("kumar-harsh2025"), "Must include reverse name order 'kumar-harsh2025'");
  assert.ok(candUsernames.includes("harshakumar25"), "Must include phonetic expansion 'harshakumar25'");

  // Profile with Git provenance
  const profileWithProv = {
    platform: "GitHub",
    username: "harshakumar25",
    displayName: "Harsh Kumar",
    location: "Delhi",
    bio: "Cybersecurity & Open Source Contributor",
    provenance: {
      commitEmails: ["jhah1225@gmail.com"],
      timezone: { rawOffset: "+0530", name: "IST" },
      repos: ["Veriqo", "DOCVEX", "AdvocateVox"]
    }
  };

  const cand = candidates.find(c => c.username === "harshakumar25");
  const verdict = disambiguateProfile(profileWithProv, seeds, cand);

  assert.equal(verdict.verdict, "TARGET_MATCH");
  assert.ok(verdict.confidenceScore >= 0.95, `Confidence score must be >= 0.95, got ${verdict.confidenceScore}`);
  assert.ok(verdict.reasons.some(r => r.includes("Veriqo")), "Must cite Veriqo repository");
  assert.ok(verdict.reasons.some(r => r.includes("jhah1225@gmail.com")), "Must cite commit email anchor");
  assert.equal(verdict.flags.length, 0, "Target profile must have 0 conflict flags");
});

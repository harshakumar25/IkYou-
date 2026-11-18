import test from "node:test";
import assert from "node:assert/strict";
import { installNetworkMocks, restoreNetworkMocks } from "./helpers/mock-network.mjs";
import { probeInstagramUser, findInstagramAccountsFromEmail } from "../src/engine/instagram-resolver.mjs";
import { checkUsername } from "../src/engine/username-checker.mjs";
import { checkEmail, validateEmail } from "../src/engine/email-checker.mjs";
import { extractDigLeads } from "../src/engine/dig-engine.mjs";
import { IdentityGraph } from "../src/engine/identity-graph.mjs";
import { executeSearch } from "../src/engine/search-orchestrator.mjs";
import { MAJOR_PLATFORMS } from "../src/platforms/definitions.mjs";

test.before(() => {
  installNetworkMocks();
});

test.after(() => {
  restoreNetworkMocks();
});

test("R2 - Instagram Deep Extraction captures real bio, outlinks, userId, verified status, and Threads handle", async () => {
  const profile = await probeInstagramUser("harshakumar25");

  assert.equal(profile.exists, true, "Profile must exist");
  assert.equal(profile.platform, "Instagram");
  assert.equal(profile.username, "harshakumar25");
  assert.equal(profile.displayName, "Harsha Kumar");
  assert.equal(profile.userId, "8652939026");

  // Verify follower metrics are NOT in biography
  assert.ok(!profile.bio.includes("63 Followers"), "Bio must not contain follower count text");
  assert.ok(
    profile.bio.includes("Security researcher, builder, and open source developer"),
    `Expected actual biography text, got: "${profile.bio}"`
  );

  // Verify follower counts are extracted cleanly as metrics
  assert.equal(profile.followers, "63");
  assert.equal(profile.following, "26");
  assert.equal(profile.posts, "0");

  // Verify verification & privacy
  assert.equal(profile.isVerified, true, "isVerified must be true from embedded JSON");
  assert.equal(profile.isPrivate, false, "isPrivate must be false");

  // Verify external outlinks & website
  assert.equal(profile.website, "https://linktr.ee/harshakumar");
  assert.ok(Array.isArray(profile.extras.outlinks), "extras.outlinks must be an array");
  assert.ok(profile.extras.outlinks.includes("https://linktr.ee/harshakumar"), "Must contain Linktree outlink");
  assert.ok(profile.extras.outlinks.includes("https://harshakumar25.in"), "Must contain personal website outlink");

  // Verify category & Threads handle
  assert.equal(profile.extras.category, "Creator");
  assert.equal(profile.extras.threadsHandle, "harshakumar25");

  // Verify discovered username leads
  assert.ok(Array.isArray(profile.discoveredUsernames), "discoveredUsernames must be an array");
  const leads = profile.discoveredUsernames.map(l => l.username);
  assert.ok(leads.includes("harshakumar25"), "Must discover Threads handle lead");
  assert.ok(leads.includes("localfingerprint"), "Must discover bio @mention lead");
  assert.ok(leads.includes("harshakumar"), "Must discover Linktree outlink lead");
});

test("R2 - Instagram minimal and 404 profiles handle edge cases gracefully", async () => {
  const minimal = await probeInstagramUser("johndoe");
  assert.equal(minimal.exists, true);
  assert.equal(minimal.isPrivate, true);
  assert.equal(minimal.isVerified, false);
  assert.equal(minimal.bio, "", "No bio text should return empty string, not metrics");

  const notFound = await probeInstagramUser("this_user_definitely_does_not_exist");
  assert.equal(notFound.exists, false);
});

test("R2 - Key Social Platforms: Linktree extracts __NEXT_DATA__ outlinks and connected accounts", async () => {
  const linktreePlatform = MAJOR_PLATFORMS.find(p => p.name === "Linktree");
  assert.ok(linktreePlatform, "Linktree platform definition must exist");

  const results = await checkUsername("harshakumar", [linktreePlatform]);
  assert.equal(results.length, 1);
  const lt = results[0];

  assert.equal(lt.platform, "Linktree");
  assert.equal(lt.username, "harshakumar");
  assert.equal(lt.displayName, "Harsha Kumar");
  assert.equal(lt.bio, "Security Researcher & Open Source Builder");
  assert.equal(lt.website, "https://harshakumar25.in");

  // Verify extracted outlinks
  assert.ok(Array.isArray(lt.extras.outlinks), "Must have extras.outlinks array");
  assert.ok(lt.extras.outlinks.includes("https://harshakumar25.in"));
  assert.ok(lt.extras.outlinks.includes("https://github.com/harshakumar25"));
  assert.ok(lt.extras.outlinks.includes("https://instagram.com/harshakumar25"));
  assert.ok(lt.extras.outlinks.includes("https://x.com/harshakumar"));
  assert.ok(lt.extras.outlinks.includes("https://t.me/harshakumar"));

  // Verify discovered usernames
  const leads = (lt.discoveredUsernames || []).map(l => l.username);
  assert.ok(leads.includes("harshakumar25"), "Must discover Instagram/GitHub handle lead");
  assert.ok(leads.includes("harshakumar"), "Must discover Twitter/Telegram handle lead");
});

test("R2 - Key Social Platforms: GitHub HTML parsing extracts website, social outlinks, and leads", async () => {
  const githubPlatform = MAJOR_PLATFORMS.find(p => p.name === "GitHub");
  assert.ok(githubPlatform, "GitHub platform definition must exist");

  const results = await checkUsername("harshakumar25", [githubPlatform]);
  assert.equal(results.length, 1);
  const gh = results[0];

  assert.equal(gh.platform, "GitHub");
  assert.equal(gh.displayName, "Harsha Kumar");
  assert.equal(gh.location, "India");
  assert.equal(gh.website, "https://harshakumar25.in");
  assert.ok(gh.extras.outlinks.includes("https://harshakumar25.in"));
  assert.ok(gh.extras.outlinks.includes("https://x.com/harshakumar"));
  assert.ok(gh.extras.outlinks.includes("https://linkedin.com/in/harshakumar25"));

  const leads = (gh.discoveredUsernames || []).map(l => l.username);
  assert.ok(leads.includes("harshakumar"), "Must discover Twitter lead");
  assert.ok(leads.includes("harshakumar25"), "Must discover LinkedIn lead");
});

test("R2 - Key Social Platforms: Reddit & Telegram extract outlinks, mentions, and leads", async () => {
  const redditPlatform = MAJOR_PLATFORMS.find(p => p.name === "Reddit");
  const telegramPlatform = MAJOR_PLATFORMS.find(p => p.name === "Telegram");

  const [redditRes] = await checkUsername("harshakumar25", [redditPlatform]);
  assert.ok(redditRes, "Reddit profile should exist");
  assert.ok(redditRes.extras.outlinks.includes("https://x.com/harshakumar"));
  assert.ok(redditRes.extras.outlinks.includes("https://github.com/harshakumar25"));

  const [tgRes] = await checkUsername("harshakumar", [telegramPlatform]);
  assert.ok(tgRes, "Telegram profile should exist");
  assert.equal(tgRes.website, "https://harshakumar25.in");
  assert.ok(tgRes.emails.includes("harsha@example.com"));
  const tgLeads = (tgRes.discoveredUsernames || []).map(l => l.username);
  assert.ok(tgLeads.includes("harshadev"), "Must discover backup @mention lead");
});

test("R3 - Dig Engine entity extraction fixes: HTML entities decoded and email domains not matched as mentions", () => {
  const profileWithEntities = {
    platform: "TestPlatform",
    username: "alice",
    bio: "Contact me at &#064;alice_dev or reach dev&#064;company.org. Also follow https://x.com/alice_tw and https://x.com/alice_alt",
    website: "https://alice.dev",
    extras: {}
  };

  const leads = extractDigLeads(profileWithEntities);
  const handles = leads.map(l => l.username);

  // Verify HTML entity &#064; was decoded to @alice_dev and extracted
  assert.ok(handles.includes("alice_dev"), "Must decode &#064; and extract mention");

  // Verify email address was extracted as email
  const emails = leads.filter(l => l.queryType === "email").map(l => l.username);
  assert.ok(emails.includes("dev@company.org"), "Must extract email address");

  // Verify email domain 'company' was NOT erroneously extracted as a bio mention
  assert.ok(!handles.includes("company"), "Email domain 'company' must not be extracted as bio mention lead");

  // Verify global regex matching: multiple twitter handles extracted
  assert.ok(handles.includes("alice_tw"), "Must extract first Twitter handle");
  assert.ok(handles.includes("alice_alt"), "Must extract second Twitter handle via global match");
});

test("R3 - Email Resolution emits localpart lead, Gravatar outlinks/accounts, GitHub, and Instagram candidates", async () => {
  const results = [];
  const leadsEmitted = [];

  await checkEmail(
    "jhah1225@gmail.com",
    (r) => results.push(r),
    () => {},
    {
      onDig: (lead) => leadsEmitted.push(lead),
      fullName: "Harsh Kumar"
    }
  );

  assert.ok(results.length >= 4, `Expected at least 4 profiles, got ${results.length}`);

  // 1. Mail Server profile & localpart lead emission
  const mailServer = results.find(r => r.platform === "Mail Server");
  assert.ok(mailServer, "Must emit Mail Server profile");
  assert.equal(mailServer.extras.provider, "Google Workspace / Gmail");
  assert.ok(
    mailServer.discoveredUsernames.some(l => l.username === "jhah1225"),
    "Mail server profile must emit raw localpart 'jhah1225' lead"
  );
  assert.ok(
    leadsEmitted.some(l => l.username === "jhah1225"),
    "onDig callback must receive raw localpart 'jhah1225'"
  );

  // 2. Gravatar profile deep outlinks and accounts
  const gravatar = results.find(r => r.platform === "Gravatar");
  assert.ok(gravatar, "Must emit Gravatar profile");
  assert.equal(gravatar.displayName, "Harsha Kumar");
  assert.ok(Array.isArray(gravatar.extras.outlinks), "Gravatar must have outlinks");
  assert.ok(gravatar.extras.outlinks.includes("https://harshakumar25.in"));
  assert.ok(gravatar.extras.outlinks.includes("https://linktr.ee/harshakumar"));
  const gravatarLeads = gravatar.discoveredUsernames.map(l => l.username);
  assert.ok(gravatarLeads.includes("harshakumar_tw"), "Gravatar must emit Twitter account lead");
  assert.ok(gravatarLeads.includes("harshakumar25"), "Gravatar must emit GitHub account lead");

  // 3. GitHub user by email
  const github = results.find(r => r.platform === "GitHub");
  assert.ok(github, "Must emit GitHub profile");
  assert.equal(github.username, "harshakumar25");

  // 4. Autonomous Instagram discovery
  const instagram = results.find(r => r.platform === "Instagram" && r.username === "harshakumar25");
  assert.ok(instagram, "Must discover target Instagram profile 'harshakumar25'");
  assert.equal(instagram.username, "harshakumar25");
  assert.equal(instagram.userId, "8652939026");
});

test("R3 - Identity Graph models outlink and linked_account nodes and preserves provenance chains", () => {
  const graph = new IdentityGraph("jhah1225@gmail.com", "email");

  // Ingest Mail Server with localpart lead
  graph.ingestProfile({
    platform: "Mail Server",
    username: "jhah1225@gmail.com",
    displayName: "jhah1225 (gmail.com)",
    profileUrl: "https://gmail.com",
    emails: ["jhah1225@gmail.com"],
    discoveredUsernames: [
      { username: "harshakumar25", foundOn: "Email Permutation", from: "jhah1225@gmail.com", queryType: "username" }
    ]
  });

  // Ingest Instagram profile with outlinks and linked accounts
  graph.ingestProfile({
    platform: "Instagram",
    username: "harshakumar25",
    displayName: "Harsha Kumar",
    profileUrl: "https://www.instagram.com/harshakumar25",
    website: "https://harshakumar25.in",
    extras: {
      outlinks: ["https://linktr.ee/harshakumar", "https://harshakumar25.in"],
      linkedAccounts: [
        { platform: "Threads", username: "harshakumar25", url: "https://threads.net/@harshakumar25", verified: true }
      ]
    }
  });

  const json = graph.toJSON();

  // Verify outlink node
  const outlinkNode = json.nodes.find(n => n.type === "outlink");
  assert.ok(outlinkNode, "Graph must contain outlink node");
  assert.ok(outlinkNode.metadata.url.includes("linktr.ee"), "Outlink node must store URL");

  // Verify linked_account node
  const linkedNode = json.nodes.find(n => n.type === "linked_account");
  assert.ok(linkedNode, "Graph must contain linked_account node");
  assert.equal(linkedNode.metadata.platform, "Threads");

  // Verify edge relations
  assert.ok(json.edges.some(e => e.relation === "links_to_external"), "Graph must contain links_to_external edge");
  assert.ok(json.edges.some(e => e.relation === "verified_identity_proof"), "Graph must contain verified_identity_proof edge");

  // Verify provenance chain tracking from email to discovered username
  const origin = graph.findOriginatingNode("harshakumar25");
  assert.ok(origin, "findOriginatingNode must resolve originating node for harshakumar25");
});

test("R3 - End-to-End Search Orchestrator performs bidirectional cross-vector pivoting", async () => {
  const events = [];
  const searchResult = await executeSearch({
    query: "jhah1225@gmail.com",
    type: "email",
    dig: true,
    digDepth: 1,
    sendEvent: (name, data) => events.push({ name, data })
  });

  assert.ok(searchResult.totalFound > 0, "Search must return results");
  assert.ok(searchResult.results.length >= 4, "Must find primary email results and pivoted social accounts");

  // Verify dig events were streamed for discovered leads
  const digEvents = events.filter(e => e.name === "dig");
  assert.ok(digEvents.length > 0, "Must stream dig events for discovered leads");

  const digLeadUsernames = digEvents.map(e => e.data.username);
  assert.ok(
    digLeadUsernames.includes("jhah1225") || digLeadUsernames.includes("harshakumar25"),
    "Dig events must include discovered username leads"
  );

  // Verify results include cross-vector pivoted platforms
  const platformsFound = searchResult.results.map(r => r.platform);
  assert.ok(platformsFound.includes("Mail Server"), "Must include Mail Server");
  assert.ok(platformsFound.includes("Gravatar"), "Must include Gravatar");
  assert.ok(platformsFound.includes("GitHub"), "Must include GitHub");
  assert.ok(platformsFound.includes("Instagram"), "Must include Instagram");

  // Verify done event
  const doneEvent = events.find(e => e.name === "done");
  assert.ok(doneEvent, "Must emit done event");
  assert.ok(doneEvent.data.totalFound > 0, "totalFound must be positive");
});

test("R4 - Offline test fixtures and mock router determinism & performance check", async () => {
  const startTime = Date.now();

  // Run 10 rapid concurrent Instagram and email resolution checks
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(probeInstagramUser("harshakumar25"));
    promises.push(checkUsername("harshakumar", [MAJOR_PLATFORMS.find(p => p.name === "Linktree")]));
  }

  const batchResults = await Promise.all(promises);
  const elapsed = Date.now() - startTime;

  assert.equal(batchResults.length, 10, "All 10 probes must resolve");
  assert.ok(elapsed < 200, `Expected batch execution < 200ms, took ${elapsed}ms`);
});

test("R3 - Multi-hop Identity Graph provenance & bidirectional edge relations", () => {
  const graph = new IdentityGraph("target@example.com", "email");

  // Step 1: Ingest email root
  graph.ingestProfile({
    platform: "Mail Server",
    username: "target@example.com",
    displayName: "target (example.com)",
    profileUrl: "https://example.com",
    emails: ["target@example.com"],
    discoveredUsernames: [
      { username: "target_dev", foundOn: "Email Localpart", from: "target@example.com", queryType: "username" }
    ]
  });

  // Step 2: Ingest pivoted GitHub profile
  graph.ingestProfile({
    platform: "GitHub",
    username: "target_dev",
    displayName: "Target Developer",
    profileUrl: "https://github.com/target_dev",
    website: "https://target.dev",
    emails: ["target.work@example.org"],
    extras: {
      outlinks: ["https://target.dev", "https://linktr.ee/target_links"],
      linkedAccounts: [
        { platform: "Twitter", username: "target_tw", url: "https://x.com/target_tw", verified: true }
      ]
    },
    discoveredUsernames: [
      { username: "target.work@example.org", foundOn: "GitHub Commit", from: "target_dev", queryType: "email" }
    ]
  });

  const json = graph.toJSON();

  // Verify nodes: target (level 0), profile (level 1 or 3), email (level 2), outlink (level 2), linked_account (level 2)
  assert.ok(json.nodes.some(n => n.type === "target" && n.level === 0));
  assert.ok(json.nodes.some(n => n.type === "profile" && n.metadata.username === "target_dev"));
  assert.ok(json.nodes.some(n => n.type === "email" && n.metadata.email === "target.work@example.org"));
  assert.ok(json.nodes.some(n => n.type === "outlink" && n.metadata.url === "https://linktr.ee/target_links"));
  assert.ok(json.nodes.some(n => n.type === "linked_account" && n.metadata.platform === "Twitter"));

  // Verify provenance chain
  const originatingForDev = graph.findOriginatingNode("target_dev");
  assert.ok(originatingForDev, "Must resolve originating node for target_dev");
});


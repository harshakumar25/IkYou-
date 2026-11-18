# Diagnostic Audit and Architectural Execution Plan: LocalFingerprint Deep Intelligence & Cross-Vector Pivoting

**Document ID**: LF-AUDIT-2026-M1  
**Project**: LocalFingerprint OSINT Investigation Platform  
**Target Version**: 1.0.0 (Milestone 1 Enhanced)  
**Author**: Deep Intelligence & Resolution Engineering  
**Scope**: Username, Email, and Instagram Resolution Modules; Cross-Vector Pivoting; Verification Infrastructure  

---

## 1. Executive Summary

LocalFingerprint was engineered as an open-source, zero-dependency, high-performance OSINT digital footprint investigation platform reverse-engineered from `fingerprint.to`. Operating on pure ES Modules (ESM) with native Node.js and Cloudflare Workers (edge) runtime compatibility, the platform provides real-time Server-Sent Events (SSE) streaming search, parallel platform probing, and recursive identity graph construction.

While the baseline engine successfully probes 31 major platforms and 3,000+ extended Maigret targets, a diagnostic audit identified critical information bottlenecks across the ingestion, extraction, and correlation layers:
1. **Instagram Resolution Bottleneck**: Follower statistics are erroneously captured as biography text, discarding real user biographies; profile outlinks (`external_url`, `bio_links`) and Threads handles are completely ignored; and verification statuses are hardcoded to `false`.
2. **Email Resolution Bottleneck**: Direct email searches fail to emit the email localpart as a baseline username lead, terminating without exploring the social username space when third-party lookup APIs yield no results; Gravatar profiles discard secondary verified accounts and portfolio URLs.
3. **Key Social Platforms Bottleneck**: Authoritative platforms (Linktree, GitHub, Reddit, Telegram) discard external outlinks and connected social profiles embedded in structured JSON or semantic HTML.
4. **Correlation & Pivoting Bottleneck**: Username and email search vectors operate in silos, requiring manual recursive flags with arbitrary queue truncation; the identity knowledge graph does not model external outlinks or preserve custody chains across cross-vector pivots.
5. **Verification Flakiness**: The test suite relies on live network requests to Instagram, GitHub, Gravatar, and DNS servers, introducing rate-limiting vulnerabilities and violating offline hermetic test requirements.

This document details the root causes of these bottlenecks, defines formal interface contracts and data models, and outlines the architectural execution plan implemented in Milestone 1.

---

## 2. In-Depth Root Cause Analysis

### 2.1 Instagram Resolution & Metadata Extraction

#### 2.1.1 Follower Metrics vs. Biography Conflation
- **Location**: `src/engine/instagram-resolver.mjs` (lines 59–89) and `src/platforms/definitions.mjs` (lines 153–183).
- **Observed Code**:
  ```javascript
  const ogDescMatch = text.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i);
  const ogDesc = ogDescMatch ? ogDescMatch[1].replace(/&amp;/g, "&") : "";
  ...
  bio: ogDesc ? ogDesc.split(" - See Instagram photos")[0] : "",
  ```
- **Root Cause**: Instagram's OpenGraph description tag (`og:description`) contains two distinct variants depending on whether the user has set a public biography:
  1. *Standard/No Bio*: `"63 Followers, 26 Following, 0 Posts - See Instagram photos and videos from Harsha Kumar (@harshakumar25)"`
  2. *With Bio*: `"63 Followers, 26 Following, 0 Posts - Harsha Kumar (@harshakumar25) on Instagram: \"Software engineer & security researcher\""`
  Executing `ogDesc.split(" - See Instagram photos")[0]` on Variant 1 isolates `"63 Followers, 26 Following, 0 Posts"` and sets it as the biography. When Variant 2 is returned, splitting on `" - See Instagram photos"` fails to isolate the bio, capturing the metrics prefix instead. The actual biography text following `"on Instagram: \""` is lost.
- **Architectural Solution**:
  Implement a multi-tier fallback cascade:
  1. Parse embedded `<script type="application/json">` tags for structured keys (`"biography"`, `xig_user_by_igid_v2`).
  2. Fall back to regex extraction targeting `/on Instagram:\s*"([\s\S]*?)"?\s*$/i`.
  3. If no custom bio text exists, set `bio: ""` rather than injecting metrics strings.

#### 2.1.2 Omission of External Outlinks & Bio URLs
- **Root Cause**: Instagram renders external links in SSR JSON under `"external_url"` and `"bio_links": [{"url": "..."}]`. The legacy extractors in `definitions.mjs` and `instagram-resolver.mjs` hardcoded `website: ""` and failed to inspect these properties. Linktree, personal domains, and Beacons URLs remained uncaptured.
- **Architectural Solution**:
  Extract both `"external_url"` and `"bio_links"`, normalize Lynx redirects, populate `profile.website` with the primary URL, and aggregate all URLs into `profile.extras.outlinks`.

#### 2.1.3 Hardcoded Verification Status & Missing IDs
- **Root Cause**: Both extractors hardcoded `isVerified: false`, ignoring the `"is_verified": true` property present in JSON payloads and verified badge markers in the DOM. Furthermore, internal numeric user IDs (`pk` / `profile_id`) and connected Threads handles (`threads.net/@handle`) were unparsed.
- **Architectural Solution**:
  Extract `"is_verified"` boolean, internal `userId` (`pk` or `id`), category (`category_name`), and linked Threads handles.

---

### 2.2 Email Resolution & Cross-Vector Pivoting

#### 2.2.1 Deterministic Localpart Emission Failure
- **Location**: `src/engine/email-checker.mjs` (lines 51–228).
- **Root Cause**: When searching an email address (e.g. `target123@example.com`), `checkEmail` queried Mail Server, Gravatar, GitHub, and Instagram. If Gravatar and GitHub returned no matches, `checkEmail` terminated without emitting `target123` as a candidate handle. Because email users overwhelmingly reuse their email localpart across social platforms, failing to emit the localpart stopped cross-vector investigations at Phase 1.
- **Architectural Solution**:
  Immediately upon email validation, emit a baseline lead:
  ```javascript
  {
    username: localPart,
    foundOn: "Email Localpart",
    from: cleanEmail,
    queryType: "username",
    confidence: 0.95,
    entityType: "localpart"
  }
  ```
  Decompose alphanumeric tokens (e.g., `target123` -> `target`, `123`) to feed phonetic and seed candidate permutation.

#### 2.2.2 Truncated Gravatar Outlink & Profile Parsing
- **Root Cause**: `checkEmail` only inspected `e.accounts` for handles and only read `e.urls[0]` for a website string. Gravatar's `entry.accounts` (verified proofs for GitHub, Twitter, WordPress, Vimeo, etc.) and `entry.urls` (full portfolio links) were discarded rather than converted to graph leads.
- **Architectural Solution**:
  Iterate over all `e.accounts`, extracting handles into `discoveredUsernames` and structured objects into `extras.linkedAccounts`. Iterate over all `e.urls`, adding each URL to `extras.outlinks` and scanning them for social handles.

#### 2.2.3 Unidirectional Pivoting in Search Orchestration
- **Location**: `src/engine/search-orchestrator.mjs` (lines 238–285).
- **Root Cause**: Searching by email did not trigger username probing unless `--dig` was manually enabled. Furthermore, `search-orchestrator.mjs` did not wire `checkEmail`'s leads into the Dig queue. Conversely, commit emails discovered via GitHub VCS provenance (`git-provenance.mjs`) were never fed back into email resolution.
- **Architectural Solution**:
  Establish bidirectional lead routing:
  - Email resolution leads -> queued for social platform username checks.
  - Username resolution leads (commit emails, bio emails) -> queued for email forensics and DNS checks.

---

### 2.3 Social Platform Catalog Outlink Bottlenecks

#### 2.3.1 Linktree Outlink Dropping
- **Location**: `src/platforms/definitions.mjs` (lines 916–938).
- **Root Cause**: Linktree's server-rendered HTML embeds a comprehensive Next.js payload inside `<script id="__NEXT_DATA__">`. This payload contains `pageProps.links` (title, URL) and `pageProps.socialLinks` (type, URL). The legacy parser only read OpenGraph title and image tags.
- **Architectural Solution**:
  Parse `__NEXT_DATA__` JSON (with fallback to DOM anchor scanning), extract all destination links into `extras.outlinks`, and resolve social handles (Instagram, Twitter/X, YouTube, Telegram, TikTok, Spotify) into `discoveredUsernames`.

#### 2.3.2 GitHub HTML Fallback Outlink Dropping
- **Location**: `src/platforms/definitions.mjs` (lines 55–115).
- **Root Cause**: When GitHub API rate limits occur (HTTP 403), the engine falls back to HTML scraping. While name and avatar were parsed, `itemprop="url"` (personal website) and `itemprop="social"` (Twitter, LinkedIn, Bluesky) were ignored, setting `website: ""` and `emails: []`.
- **Architectural Solution**:
  Extract `itemprop="url"` and `itemprop="social"`, populating `profile.website`, `profile.extras.outlinks`, and `discoveredUsernames`.

#### 2.3.3 Dig Engine Entity Extraction Deficiencies
- **Location**: `src/engine/dig-engine.mjs` (lines 98–117).
- **Root Causes**:
  1. `textCorpus.match(regex)` used non-global matching, extracting at most one handle per social platform.
  2. The bio mention regex `/@([a-zA-Z0-9_]{3,30})\b/g` matched email domain components (`me@example.com` -> `@example`).
  3. HTML entities like `&#064;` were not unescaped, preventing email detection.
  4. Arbitrary external URLs (personal blogs, custom domains) were not extracted.
- **Architectural Solution**:
  1. Convert all pattern matching to global `matchAll`.
  2. Implement negative lookbehind/prefix check `(?<![a-zA-Z0-9._%+-])@([a-zA-Z0-9_]{3,30})\b` to prevent matching email domains.
  3. Unescape HTML entities prior to regex evaluation.
  4. Extract all valid `https?://` URLs into profile outlinks.

---

### 2.4 Verification Infrastructure & Hermetic Testing Bottleneck

- **Observed Behavior**: Running `npm test` executed live network calls against external servers:
  - `tests/instagram-resolver.test.mjs` fetched `https://www.instagram.com/zuck/` and spawned a live Chromium browser via REA.
  - `tests/forensic-resolver.test.mjs` made live DNS queries (`dns.resolveMx`) and fetched Gravatar.
  - `tests/git-provenance.test.mjs` fetched `github.com/harshakumar25.keys` and commit patches.
- **Impact**: Test runs consumed 6.5+ seconds, were prone to network timeouts and 429/403 rate limits, and could not run in air-gapped CI environments.
- **Architectural Solution**:
  1. Build a native mock network helper (`tests/helpers/mock-network.mjs`) that intercepts `globalThis.fetch` and `dns.promises.resolveMx`.
  2. Create a static fixture library (`tests/fixtures/`) with synthetic HTML/JSON for Instagram, GitHub, Gravatar, Linktree, DNS MX, and REA.
  3. Implement `tests/offline-resolution.test.mjs` validating deep extraction and cross-vector correlation in < 500ms with zero network calls.

---

## 3. Architecture & Interface Specifications

### 3.1 Enhanced Profile Data Model (`EnhancedProfile`)

```typescript
interface EnhancedProfile {
  platform: string;                 // Platform identifier (e.g., "Instagram", "GitHub", "Linktree")
  username: string;                 // Canonical platform handle
  displayName: string;              // Full display name
  userId: string;                   // Internal platform identifier (e.g., "8652939026")
  sourceQuery: string;              // Query that originated this discovery
  profileUrl: string;               // Direct URL to profile page
  platformUrl: string;              // Base platform URL
  pfpUrl: string;                   // Avatar / profile picture URL
  bannerUrl: string;                // Header / banner image URL
  isVerified: boolean;              // Verification badge status
  isPrivate: boolean;               // Locked / private profile flag
  followers: number | string | null;// Follower metric
  following: number | string | null;// Following metric
  posts: number | string | null;    // Posts / repository count
  likes: number | string | null;    // Likes / stars count
  location: string;                 // Geographic location
  emails: string[];                 // Direct public emails
  phones: string[];                 // Direct phone numbers
  website: string;                  // Primary external website / link-in-bio URL
  createdAt: string;                // Account creation date
  lastActive: string;               // Last activity timestamp
  bio: string;                      // Clean biography text (sanitized of HTML entities & metrics)
  extras: {
    outlinks?: string[];            // Extracted destination URLs (Linktree, portfolio, etc.)
    linkedAccounts?: Array<{        // Verified external linked accounts
      platform: string;
      username: string;
      url: string;
      verified?: boolean;
    }>;
    category?: string;              // Business/creator category
    threadsHandle?: string;         // Connected Threads handle
    bioMetadata?: object;           // Platform-specific structured properties
    [key: string]: any;
  };
  discoveredUsernames?: Array<{     // Pivot leads emitted for recursive Dig
    username: string;
    foundOn: string;
    from: string;
    queryType: "username" | "email" | "crypto";
    confidence: number;
    entityType: "handle" | "social_link" | "bio_mention" | "email" | "crypto_wallet" | "localpart";
  }>;
  error: null | string;
}
```

### 3.2 Bidirectional Cross-Vector Pivot Flowchart

```
┌────────────────────────────────────────────────────────┐
│                   Target Investigation                 │
└───────────────────────────┬────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
    [Email Search Vector]         [Username Search Vector]
            │                               │
            ├─► Validate RFC 5322           ├─► Parallel Platform Probes
            ├─► Emit Localpart Lead         │   (GitHub, Instagram, Linktree,
            ├─► Resolve DNS MX Provider     │    Reddit, Telegram, etc.)
            ├─► Query Gravatar Profile      ├─► Extract Deep Metadata:
            │   (Extract Accounts & URLs)   │   - True Bio & Verified Status
            ├─► Query GitHub Email API      │   - Outlinks (Linktree, personal)
            └─► Autonomous Instagram Pivot  │   - Linked Accounts & Threads
                            │               └─► VCS Provenance Forensics:
                            │                   - SSH Key Fingerprints
                            │                   - Commit Author Emails
                            │                               │
                            └───────────────┬───────────────┘
                                            ▼
                           ┌─────────────────────────────────┐
                           │   Bidirectional Pivot Router    │
                           │     (search-orchestrator)       │
                           └────────────────┬────────────────┘
                                            │
                     ┌──────────────────────┴──────────────────────┐
                     ▼                                             ▼
            Discovered Usernames                          Discovered Emails
         (Localparts, Gravatar accs,                 (Commit emails, bio emails,
          Instagram & Linktree handles)                 REA-extracted contacts)
                     │                                             │
                     ▼                                             ▼
          Recursive BFS Dig Queue                       Recursive BFS Dig Queue
             (Social Probing)                              (Email Forensics)
```

---

## 4. Execution Plan & Implementation Steps

| Step | Milestone | Files Modified | Description |
|---|---|---|---|
| **1** | M1.1 | `docs/DIAGNOSTIC_AUDIT.md` | Formal audit report detailing bottlenecks, root causes, schemas, and execution plan. |
| **2** | M1.2 | `tests/fixtures/**`, `tests/helpers/mock-network.mjs` | Creation of offline mock fixture library and native Node.js mock interception layer. |
| **3** | M1.3 | `src/engine/username-checker.mjs`, `src/platforms/definitions.mjs`, `src/engine/instagram-resolver.mjs` | Implementation of deep profile metadata extraction, clean bios, outlinks, and linked accounts. |
| **4** | M1.4 | `src/engine/dig-engine.mjs`, `src/engine/email-checker.mjs`, `src/engine/search-orchestrator.mjs`, `src/engine/identity-graph.mjs` | Localpart emission, Gravatar deep extraction, outlink modeling, and bidirectional pivoting. |
| **5** | M1.5 | `tests/offline-resolution.test.mjs` | Automated unit and integration test suite running completely offline in < 500ms. |
| **6** | M1.6 | Full Suite Verification | Execution of `npm test` ensuring 100% pass rate across existing and new test suites. |

---

## 5. Verification & Validation Framework

### 5.1 Verification Commands
1. **Full Test Suite**:
   ```bash
   npm test
   ```
   *Expected Result*: All 30 existing tests and all new offline tests pass cleanly.
2. **Dedicated Offline Suite**:
   ```bash
   node --test tests/offline-resolution.test.mjs
   ```
   *Expected Result*: All offline tests execute and pass in < 500ms with zero live network requests.

### 5.2 Invalidation Conditions
- Any failure in the existing 30 tests in `tests/*.test.mjs`.
- Failure to separate follower metrics from biography text on Instagram profiles.
- Any network request escaping the mock layer during offline test runs.
- Introducing external npm dependencies into `package.json`.
- Dropping external outlinks or linked accounts from Linktree, GitHub, or Gravatar.

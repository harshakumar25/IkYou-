# LocalFingerprint 🕵️‍♂️
> **Ultra-Fast, Offline & Local OSINT Identity Investigation Platform**  
> Reverse-engineered, recreated and enhanced from `fingerprint.to` (Software for Private & Fraud Investigators).

---

## 🌟 Overview

**LocalFingerprint** is a fully local, self-hosted, high-performance OSINT digital footprint investigation platform and browser fingerprinting suite. It replicates all capabilities of the commercial service [fingerprint.to](https://fingerprint.to/), eliminating external subscription fees, token caps, rate limits, and Cloudflare Turnstile blocks.

### Key Capabilities:
- **Username Search**: Asynchronous concurrent multi-platform reconnaissance across GitHub, Reddit, Telegram, Steam, Twitch, Spotify, GitLab, Keybase, Duolingo, DockerHub, DevTo, Medium, Pinterest, and 3,000+ extended platforms.
- **Email Search**: RFC 5322 syntax validation, DNS MX exchange discovery (Google Workspace, Microsoft 365, Proton, etc.), disposable domain risk scoring, Gravatar identity profile resolution, and GitHub commit author correlation.
- **Phone Search**: E.164 normalization, ITU-T country calling code deduction (+1, +44, +91, etc.), WhatsApp click-to-chat active gateway resolution, and Telegram contact link generation.
- **Recursive Identity Correlation ("Dig")**: Automatically parses biographies, websites, and profile fields for other social handles (`@handle`, `t.me/...`, `twitter.com/...`, emails), dynamically scheduling sub-investigations to link connected accounts into a cohesive digital identity dossier.
- **Real-Time Streaming API (SSE)**: Complete Server-Sent Events implementation (`/api/search`, `/api/demo-search`) matching `fingerprint.to`'s protocol (`connected`, `start`, `checked`, `result`, `dig`, `done`, `error`).
- **REST API & Direct Probing**: `GET /v1/:platform/:username` for zero-latency programmatic profile resolution.
- **Client Device Fingerprinting Module**: Native browser entropy extraction (Canvas 2D, WebGL vendor/renderer, AudioContext harmonics, Font detection, Screen, Navigator, Intl) generating deterministic 64-character SHA-256 visitor IDs.
- **Sleek Dark-Mode Investigator Dashboard**: Live progress bars, follower counts, verified badges, direct links, and one-click JSON/CSV/TXT dossier exports.

---

## 🚀 Quick Start

### 1. Start the Web Dashboard & API Server
```bash
cd localfingerprint
npm start
# Server listens at http://localhost:3333
```

Open `http://localhost:3333` in any browser to access the live dashboard.

### 2. Terminal CLI Investigation

#### Username Search
```bash
# Basic username search
node bin/localfingerprint.mjs search torvalds

# Username search with Recursive Dig enabled
node bin/localfingerprint.mjs search torvalds --type username --dig --depth 2

# Search with full 3,000+ platform catalog & save dossier
node bin/localfingerprint.mjs search torvalds --extended --out linus_dossier.txt
```

#### Email Search
```bash
node bin/localfingerprint.mjs search contact@github.com --type email
```

#### Phone Search
```bash
node bin/localfingerprint.mjs search +14155550123 --type phone
```

#### Single Platform Probe
```bash
node bin/localfingerprint.mjs probe github torvalds
```

---

## 🔌 API Endpoints

### 1. Streaming Search (SSE)
```http
GET /api/search?query=torvalds&type=username&dig=true&dig_depth=1
Accept: text/event-stream
```

**SSE Stream Lifecycle:**
```text
event: connected
data: {"ok": true, "timestamp": 1794765624828}

event: ratelimit
data: {"limit": 999999, "remaining": 999999, "reset": 1794852024}

event: start
data: {"total": 30, "usernamePlatforms": 30, "emailPlatforms": 3, "phonePlatforms": 3}

event: checked
data: {"total": 1, "counts": {"GitHub": 1}}

event: result
data: {
  "platform": "GitHub",
  "username": "torvalds",
  "displayName": "Linus Torvalds",
  "userId": "1024025",
  "profileUrl": "https://github.com/torvalds",
  "pfpUrl": "https://avatars.githubusercontent.com/u/1024025?v=4",
  "isVerified": false,
  "followers": 332100,
  "location": "Portland, OR",
  "bio": "",
  "extras": {"company": "Linux Foundation", "publicRepos": 12}
}

event: dig
data: {
  "username": "torvalds_dev",
  "foundOn": "GitHub Bio",
  "from": "torvalds",
  "queryType": "username"
}

event: done
data: {
  "refundedTokens": 0,
  "digDepth": 1,
  "digDepthReached": 1,
  "totalFound": 15,
  "elapsedMs": 1420
}
```

### 2. Direct Platform Query
```http
GET /v1/github/torvalds
```
Returns:
```json
{
  "platform": "GitHub",
  "username": "torvalds",
  "profileUrl": "https://github.com/torvalds",
  "displayName": "Linus Torvalds",
  "isVerified": false,
  "followers": 332100,
  "pfpUrl": "https://avatars.githubusercontent.com/u/1024025?v=4",
  "location": "Portland, OR",
  "website": "",
  "extras": {
    "publicRepos": 12,
    "company": "Linux Foundation"
  }
}
```

### 3. Device Fingerprint Registration
```http
POST /api/device-fingerprint
Content-Type: application/json

{
  "canvasHash": "...",
  "webglRenderer": "...",
  "audioHash": "...",
  "hardwareConcurrency": 8,
  "screenResolution": "1920x1080"
}
```
Returns:
```json
{
  "visitorId": "3a48e7188b48f95c0dc2f8384918e974e64f9ad3d8d73b06bc9178ad0419d854",
  "confidenceScore": 0.99,
  "isBot": false,
  "incognitoProbable": false
}
```

---

## 🏗️ Architecture & Reverse Engineering Findings

During the reverse engineering of `https://fingerprint.to/`, we identified and extracted:
1. **Frontend Architecture**: Next.js 16 (Turbopack) with React 19 transition states, server-sent streaming consumer hook `openSearchStream`, and Cloudflare Turnstile token validation via `/api/auth/turnstile`.
2. **Result Data Contract**: The exact 23-property entity model: `platform`, `username`, `displayName`, `userId`, `sourceQuery`, `profileUrl`, `platformUrl`, `pfpUrl`, `bannerUrl`, `isVerified`, `isPrivate`, `followers`, `following`, `posts`, `likes`, `location`, `emails`, `phones`, `website`, `createdAt`, `lastActive`, `bio`, `extras`.
3. **The "Dig" Mechanism**: When profile results return metadata containing linked handles or emails, the client receives `dig` events and can recursively query discovered identities.
4. **Validation Logic**: Recovered exact regexes and ITU-T E.164 phone normalization rules from chunk module `795018`.
5. **Zero-Lockout Local Engine**: `localfingerprint` removes all Cloudflare Turnstile barriers, session token deductions, and commercial limits.

---

## 🧪 Testing

Run the automated test suite:
```bash
npm test
```
All unit and integration tests run using Node.js built-in test runner with zero dependencies.

import { checkUsername } from "./username-checker.mjs";
import { checkEmail, validateEmail } from "./email-checker.mjs";
import { checkPhone, normalizePhone } from "./phone-checker.mjs";
import { getPlatforms } from "../platforms/catalog.mjs";
import { generatePermutationMatrix, isCandidateAllowedOnPlatform } from "./seed-permutator.mjs";
import { disambiguateProfile, clusterDisambiguatedProfiles } from "./entity-disambiguator.mjs";
import { extractGitProvenance } from "./git-provenance.mjs";
import { computeAvatarFingerprint, correlateAvatars } from "./avatar-hasher.mjs";
import { executeReaScenario } from "../rea-bridge.mjs";

/**
 * Orchestrates multi-platform OSINT queries, streaming real-time SSE events
 * and recursively resolving correlated identities ("Dig").
 */
export async function executeSearch({
  query,
  type = "username",
  seedProfile = null,
  dig = false,
  digDepth = 1,
  digType = "both",
  extended = false,
  deepRea = false,
  sendEvent = () => {},
  signal = null
}) {
  const startTime = Date.now();
  const allPlatforms = getPlatforms(extended);

  // Send connected
  sendEvent("connected", { ok: true, timestamp: Date.now() });

  // Rate limit event (unlimited local engine)
  sendEvent("ratelimit", {
    limit: 999999,
    remaining: 999999,
    reset: Math.floor(Date.now() / 1000) + 86400
  });

  const allFoundResults = [];
  const queuedLeads = [];
  const processedQueries = new Set();

  // Parse Seed Profile if searching in "person" mode
  let activeSeedProfile = seedProfile;
  let personCandidates = [];

  if (type === "person") {
    if (!activeSeedProfile) {
      // Attempt JSON parse or structured token split from query string: "Harsh Kumar | 25, 1998 | harshu | developer, India"
      try {
        if (query.trim().startsWith("{")) {
          activeSeedProfile = JSON.parse(query);
        } else {
          const parts = query.split("|").map(p => p.trim());
          const nameParts = (parts[0] || "").split(/\s+/);
          const firstName = nameParts[0] || "";
          const lastName = nameParts.slice(1).join(" ") || "";
          const numbers = parts[1] ? parts[1].split(/[\s,]+/).filter(Boolean) : [];
          const nicknames = parts[2] ? parts[2].split(/[\s,]+/).filter(Boolean) : [];
          const keywords = parts[3] ? parts[3].split(/[\s,]+/).filter(Boolean) : [];

          activeSeedProfile = {
            firstName,
            lastName,
            numbers,
            nicknames,
            keywords,
            location: keywords.find(k => ["india", "delhi", "mumbai", "usa", "uk"].includes(k.toLowerCase())) || ""
          };
        }
      } catch {
        const nameParts = query.trim().split(/\s+/);
        activeSeedProfile = {
          firstName: nameParts[0] || "",
          lastName: nameParts.slice(1).join(" ") || "",
          numbers: [],
          nicknames: [],
          keywords: []
        };
      }
    }

    personCandidates = generatePermutationMatrix(activeSeedProfile).slice(0, 36);
  }

  let totalPlatformsCount = 0;
  if (type === "username") {
    totalPlatformsCount = allPlatforms.length;
  } else if (type === "person") {
    totalPlatformsCount = personCandidates.length * Math.min(15, allPlatforms.length);
  } else if (type === "email") {
    totalPlatformsCount = 5;
  } else if (type === "phone") {
    totalPlatformsCount = 6;
  }

  // Send start event
  sendEvent("start", {
    total: totalPlatformsCount,
    usernamePlatforms: allPlatforms.length,
    emailPlatforms: 5,
    phonePlatforms: 6,
    isPersonMode: type === "person",
    candidateCount: personCandidates.length
  });

  if (type === "person" && personCandidates.length > 0) {
    sendEvent("candidates", {
      total: personCandidates.length,
      candidates: personCandidates.slice(0, 16)
    });
  }

  const pendingResultPromises = [];

  const handleResult = async (result) => {
    // 1. Deep VCS Forensics: If GitHub profile, extract SSH keys, repos & real commit author emails
    if ((result.platform || "").toLowerCase() === "github" && !result.provenance) {
      try {
        const prov = await extractGitProvenance(result.username);
        result.provenance = prov;
        // Inject newly discovered commit emails & localparts into Dig queue
        if (Array.isArray(prov.pivotLeads)) {
          for (const lead of prov.pivotLeads) {
            handleDig(lead);
          }
        }
      } catch {}
    }

    // 2. Avatar Perceptual & Cryptographic Fingerprinting
    if (result.pfpUrl && !result.avatarFingerprint) {
      try {
        const fp = await computeAvatarFingerprint(result.pfpUrl);
        if (fp) result.avatarFingerprint = fp;
      } catch {}
    }

    // 3. Re-evaluate Disambiguation with complete VCS & Avatar Forensics
    if (activeSeedProfile) {
      result.disambiguation = disambiguateProfile(result, activeSeedProfile, result.matchedCandidateObj || null);
    }

    // 4. Automated Deep REA Verification Scenario:
    // If enabled, automatically capture full browser viewport screenshot, DOM and evidence
    if (deepRea && !result.reaEvidence && result.profileUrl) {
      const isTarget = result.disambiguation?.isTargetMatch;
      const isTopHandle = result.username?.toLowerCase() === query?.toLowerCase();
      if (isTarget || isTopHandle) {
        try {
          const reaEvidence = await executeReaScenario(result.profileUrl, { waitMs: 2000 });
          if (reaEvidence && reaEvidence.success) {
            result.reaEvidence = reaEvidence;
            if (reaEvidence.extractedEmails?.length) {
              result.emails = Array.from(new Set([...(result.emails || []), ...reaEvidence.extractedEmails]));
              for (const em of reaEvidence.extractedEmails) {
                handleDig({ username: em, foundOn: `${result.platform} (REA Verified)`, queryType: "email" });
              }
            }
            if (reaEvidence.extractedLinks?.length) {
              for (const link of reaEvidence.extractedLinks) {
                const match = link.match(/(?:x\.com|twitter\.com|linkedin\.com\/in)\/([a-zA-Z0-9_.-]+)/i);
                if (match) {
                  handleDig({ username: match[1], foundOn: `${result.platform} (REA Verified)`, queryType: "username" });
                }
              }
            }
          }
        } catch {}
      }
    }

    // 5. Ingest and route discovered username & email leads to Dig queue
    if (Array.isArray(result.discoveredUsernames)) {
      for (const lead of result.discoveredUsernames) {
        handleDig(lead);
      }
    }

    allFoundResults.push(result);
    sendEvent("result", result);
  };

  const safeHandleResult = (result) => {
    const p = Promise.resolve(handleResult(result)).catch(() => {});
    pendingResultPromises.push(p);
    return p;
  };

  const handleChecked = (progress) => {
    sendEvent("checked", progress);
  };

  const handleDig = (lead) => {
    // Determine platform scope for this new lead branch
    const branchPlatformCount = lead.queryType === "email" ? 3 : 15;
    sendEvent("dig", {
      ...lead,
      platformCount: branchPlatformCount
    });
    if (lead.queryType === "username" || lead.queryType === "email") {
      queuedLeads.push(lead);
    }
  };

  // Phase 1: Primary Search
  processedQueries.add(`${type}:${query.toLowerCase().trim()}`);

  if (type === "person") {
    // Probe candidates across top authoritative platforms
    const candidatePlatforms = allPlatforms.slice(0, 15);
    for (const cand of personCandidates) {
      if (signal?.aborted) break;
      const targetPlatforms = candidatePlatforms.filter(p => isCandidateAllowedOnPlatform(cand.username, p));
      await checkUsername(cand.username, targetPlatforms, {
        onResult: (res) => {
          const disambiguation = disambiguateProfile(res, activeSeedProfile, cand);
          safeHandleResult({
            ...res,
            matchedCandidate: cand.username,
            matchedCandidateObj: cand,
            disambiguation
          });
        },
        onChecked: handleChecked,
        onDig: handleDig,
        signal
      });
    }
  } else if (type === "username") {
    await checkUsername(query, allPlatforms, {
      onResult: (res) => {
        if (activeSeedProfile) {
          const disambiguation = disambiguateProfile(res, activeSeedProfile);
          safeHandleResult({ ...res, disambiguation });
        } else {
          safeHandleResult(res);
        }
      },
      onChecked: handleChecked,
      onDig: handleDig,
      signal
    });
  } else if (type === "email") {
    if (!validateEmail(query)) {
      sendEvent("error", { error: "Invalid email address format", verificationFailed: false });
      return;
    }
    const fullName = activeSeedProfile ? `${activeSeedProfile.firstName} ${activeSeedProfile.lastName}`.trim() : "";
    await checkEmail(query, safeHandleResult, handleChecked, {
      deepRea,
      fullName,
      onDig: handleDig
    });
  } else if (type === "phone") {
    const normalized = normalizePhone(query);
    if (!normalized) {
      sendEvent("error", { error: "Invalid phone number format", verificationFailed: false });
      return;
    }
    await checkPhone(normalized, safeHandleResult, handleChecked, {
      deepRea,
      onDig: handleDig,
      signal
    });
  }

  // Phase 2: Recursive Deep Dig Investigation
  let depthReached = 0;
  if (dig && digDepth > 0 && !signal?.aborted) {
    let currentDepth = 1;
    const maxDepth = Math.max(1, Math.min(parseInt(digDepth, 10) || 1, 3));

    while (currentDepth <= maxDepth && queuedLeads.length > 0 && !signal?.aborted) {
      depthReached = currentDepth;
      const leadsToProcess = [...queuedLeads];
      queuedLeads.length = 0; // Clear for next depth wave

      for (const lead of leadsToProcess.slice(0, 6)) { // Process up to 6 leads per depth level
        const key = `${lead.queryType}:${lead.username.toLowerCase()}`;
        if (processedQueries.has(key) || signal?.aborted) continue;
        processedQueries.add(key);

        if (lead.queryType === "username" && (digType === "both" || digType === "username")) {
          // Probe top 15 most authoritative social platforms for this discovered branch
          const branchPlatforms = allPlatforms.slice(0, 15);
          await checkUsername(lead.username, branchPlatforms, {
            onResult: safeHandleResult,
            onChecked: handleChecked,
            onDig: (newLead) => {
              if (currentDepth + 1 <= maxDepth) handleDig(newLead);
            },
            signal
          });
        } else if (lead.queryType === "email" && (digType === "both" || digType === "email")) {
          await checkEmail(lead.username, safeHandleResult, handleChecked, {
            deepRea,
            onDig: (newLead) => {
              if (currentDepth + 1 <= maxDepth) handleDig(newLead);
            }
          });
        }
      }
      currentDepth++;
    }
  }

  // Ensure all async forensics (avatars, VCS provenance, REA evidence) have settled before done
  await Promise.allSettled(pendingResultPromises);

  // Phase 3: Biometric Visual Twin Cross-Correlation
  const visualTwins = correlateAvatars(allFoundResults);
  for (const twin of visualTwins) {
    sendEvent("avatar_match", twin);
  }

  // Send done event
  const elapsedMs = Date.now() - startTime;
  const disambiguationStats = activeSeedProfile
    ? clusterDisambiguatedProfiles(allFoundResults, activeSeedProfile).stats
    : null;

  sendEvent("done", {
    refundedTokens: 0,
    digDepth: Number(digDepth) || 0,
    digDepthReached: depthReached,
    totalFound: allFoundResults.length,
    visualTwinsCount: visualTwins.length,
    visualTwins,
    disambiguationStats,
    elapsedMs
  });

  return {
    results: allFoundResults,
    totalFound: allFoundResults.length,
    elapsedMs
  };
}

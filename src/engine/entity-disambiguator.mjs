/**
 * Multi-Vector Entity Disambiguation & Identity Resolution Engine
 * Solves the Homonym & Ambiguity Problem in OSINT:
 * When searching common names (e.g. "Harsh Kumar"), separates accounts
 * belonging to the TARGET from unrelated individuals who share the same name.
 */

/**
 * Token-sort string similarity (Levenshtein-agnostic word token comparison)
 */
function tokenSimilarity(strA = "", strB = "") {
  const normA = strA.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  const normB = strB.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);

  if (normA.length === 0 || normB.length === 0) return 0;

  const setB = new Set(normB);
  let matches = 0;
  for (const token of normA) {
    if (setB.has(token)) {
      matches++;
    } else {
      // Check partial prefix (e.g. "k" matching "kumar")
      for (const b of normB) {
        if ((token.length === 1 && b.startsWith(token)) || (b.length === 1 && token.startsWith(b))) {
          matches += 0.5;
          break;
        }
      }
    }
  }

  return Math.min(1.0, (2 * matches) / (normA.length + normB.length));
}

/**
 * Disambiguate a discovered profile against target identity seeds.
 * @param {object} profile - Discovered platform profile
 * @param {object} seeds - Target identity seeds { firstName, lastName, nicknames, numbers, keywords, location }
 * @param {object} [matchedCandidate] - The permutation candidate object if invoked from permutator
 * @returns {object} Disambiguation verdict and scores
 */
export function disambiguateProfile(profile, seeds, matchedCandidate = null) {
  const targetFullName = `${seeds.firstName || ""} ${seeds.lastName || ""}`.trim();
  const reasons = [];
  const flags = [];

  // 1. Handle Prior Score (30% weight)
  let sHandle = 0.5;
  if (matchedCandidate) {
    sHandle = matchedCandidate.priorWeight;
    if (matchedCandidate.isHomonymRisk) {
      flags.push("High homonym risk handle (common name without distinguishing numbers/nicknames)");
      sHandle = Math.min(sHandle, 0.45);
    } else {
      reasons.push(`Matched specific personalized handle pattern: "${matchedCandidate.username}" (${matchedCandidate.pattern})`);
    }
  } else {
    // Check if profile username contains target numbers/nicknames
    const usernameLower = (profile.username || "").toLowerCase();
    const hasNumber = (seeds.numbers || []).some(num => usernameLower.includes(String(num)));
    const hasNick = (seeds.nicknames || []).some(n => usernameLower.includes(n.toLowerCase()));
    if (hasNumber && hasNick) {
      sHandle = 0.95;
      reasons.push("Username contains both target nickname and personal numbers/dates");
    } else if (hasNumber) {
      sHandle = 0.88;
      reasons.push(`Username contains target personal number: "${profile.username}"`);
    } else if (hasNick) {
      sHandle = 0.80;
      reasons.push(`Username matches target nickname: "${profile.username}"`);
    } else {
      sHandle = 0.40;
      flags.push("Generic handle match with no distinguishing seed numbers or nicknames");
    }
  }

  // 2. Display Name Similarity (25% weight)
  let sName = 0.2;
  const displayName = profile.displayName || "";
  if (displayName) {
    const nameSim = tokenSimilarity(displayName, targetFullName);
    if (nameSim >= 0.8) {
      sName = 1.0;
      reasons.push(`Display name "${displayName}" strongly matches target "${targetFullName}"`);
    } else if (nameSim >= 0.5) {
      sName = 0.7;
      reasons.push(`Display name "${displayName}" partially matches target`);
    } else {
      sName = 0.05;
      flags.push(`Display name "${displayName}" does not match target "${targetFullName}" (Likely someone else)`);
    }
  } else {
    // No display name available; neutral
    sName = 0.4;
  }

  // 3. Bio & Contextual Semantic Alignment (25% weight)
  let sBio = 0.3; // Default neutral
  const textCorpus = [
    profile.bio || "",
    profile.location || "",
    profile.website || "",
    JSON.stringify(profile.extras || {})
  ].join(" ").toLowerCase();

  const targetKeywords = (seeds.keywords || []).map(k => k.toLowerCase().trim()).filter(Boolean);
  let keywordHits = 0;

  for (const kw of targetKeywords) {
    if (textCorpus.includes(kw)) {
      keywordHits++;
      reasons.push(`Bio/metadata matches keyword: "${kw}"`);
    }
  }

  // Check repositories if available (e.g. from GitHub provenance)
  if (Array.isArray(profile.provenance?.repos)) {
    for (const repo of profile.provenance.repos) {
      const lowerRepo = repo.toLowerCase();
      for (const kw of targetKeywords) {
        if (lowerRepo.includes(kw) || kw.includes(lowerRepo)) {
          keywordHits += 2;
          reasons.push(`Public repository "${repo}" matches target keyword "${kw}"`);
        }
      }
    }
  }

  if (targetKeywords.length > 0) {
    if (keywordHits > 0) {
      sBio = Math.min(1.0, 0.6 + (keywordHits * 0.25));
    } else if (profile.bio && profile.bio.length > 40) {
      // Profile has an extensive bio but ZERO target keywords matched
      sBio = 0.25;
      flags.push("Bio presents non-matching topical context");
    }
  }

  // 4. Geographic & Timezone Consistency (10% weight)
  let sGeo = 0.5; // neutral
  const targetLocation = (seeds.location || "").toLowerCase().trim();
  const profileLocation = (profile.location || "").toLowerCase().trim();

  if (targetLocation && profileLocation) {
    if (profileLocation.includes(targetLocation) || targetLocation.includes(profileLocation)) {
      sGeo = 1.0;
      reasons.push(`Location "${profile.location}" matches target location "${seeds.location}"`);
    } else {
      sGeo = 0.0;
      flags.push(`Conflicting location: Profile is in "${profile.location}" vs target "${seeds.location}"`);
    }
  }

  // Check commit timezone against target location if Indian/South Asian
  if (profile.provenance?.timezone?.rawOffset) {
    const offset = profile.provenance.timezone.rawOffset;
    if (offset === "+0530" && (targetLocation.includes("delhi") || targetLocation.includes("india"))) {
      sGeo = 1.0;
      reasons.push(`Commit timestamp timezone (${profile.provenance.timezone.name}) matches target geographic region`);
    }
  }

  // 5. Hard Cross-Links / Mutual Proofs (10% weight)
  let sProof = 0.0;
  if (Array.isArray(profile.emails) && profile.emails.length > 0) {
    sProof += 0.5;
    reasons.push(`Profile has public email contacts: ${profile.emails.join(", ")}`);
  }
  if (profile.website && seeds.knownDomains) {
    const matchesDomain = seeds.knownDomains.some(d => profile.website.toLowerCase().includes(d.toLowerCase()));
    if (matchesDomain) {
      sProof = 1.0;
      reasons.push(`Profile website matches known target domain: ${profile.website}`);
    }
  }

  // Check commit author emails against known nicknames/handles
  if (Array.isArray(profile.provenance?.commitEmails)) {
    for (const email of profile.provenance.commitEmails) {
      const emailLower = email.toLowerCase();
      const localPart = emailLower.split("@")[0];
      const allNicknames = (seeds.nicknames || []).map(n => n.toLowerCase().trim());
      if (allNicknames.some(n => emailLower.includes(n) || localPart.includes(n))) {
        sProof = 1.0;
        reasons.push(`Commit author email "${email}" matches known target identity anchor`);
        break;
      }
    }
  }

  // Weighted Confidence Calculation
  const totalScore = Number((
    (sHandle * 0.30) +
    (sName * 0.25) +
    (sBio * 0.25) +
    (sGeo * 0.10) +
    (sProof * 0.10)
  ).toFixed(2));

  // Determine Final Verdict
  let verdict = "POSSIBLE_LEAD";
  let isTargetMatch = false;
  let isHomonym = false;

  // Severe conflicting flags force Homonym classification
  const hasSevereConflict = flags.some(f => f.includes("Conflicting location") || f.includes("Likely someone else"));

  if (totalScore >= 0.65 && !hasSevereConflict) {
    verdict = "TARGET_MATCH";
    isTargetMatch = true;
  } else if (totalScore < 0.40 || (hasSevereConflict && totalScore < 0.55)) {
    verdict = "UNRELATED_HOMONYM";
    isHomonym = true;
  } else {
    verdict = "POSSIBLE_LEAD";
  }

  return {
    verdict,            // "TARGET_MATCH" | "POSSIBLE_LEAD" | "UNRELATED_HOMONYM"
    confidenceScore: totalScore,
    isTargetMatch,
    isHomonym,
    scores: {
      handle: sHandle,
      name: sName,
      bio: sBio,
      geo: sGeo,
      proof: sProof
    },
    reasons,
    flags
  };
}

/**
 * Clusters a collection of discovered profiles into Disambiguated Groups.
 * @param {Array<object>} results - Raw found profiles
 * @param {object} seeds - Identity seeds
 * @returns {object} { targetAccounts, potentialLeads, filteredHomonyms }
 */
export function clusterDisambiguatedProfiles(results, seeds) {
  const targetAccounts = [];
  const potentialLeads = [];
  const filteredHomonyms = [];

  for (const r of results) {
    const disambiguation = r.disambiguation || disambiguateProfile(r, seeds);
    const enriched = { ...r, disambiguation };

    if (disambiguation.verdict === "TARGET_MATCH") {
      targetAccounts.push(enriched);
    } else if (disambiguation.verdict === "UNRELATED_HOMONYM") {
      filteredHomonyms.push(enriched);
    } else {
      potentialLeads.push(enriched);
    }
  }

  return {
    targetAccounts,
    potentialLeads,
    filteredHomonyms,
    stats: {
      total: results.length,
      confirmedTargetCount: targetAccounts.length,
      leadCount: potentialLeads.length,
      filteredHomonymCount: filteredHomonyms.length
    }
  };
}

/**
 * Combinatorial Seed Permutation Engine
 * Solves the OSINT Personal Identity Resolution Problem:
 * Given a seed profile (First Name, Last Name, Nicknames, Birth Dates/Numbers, Context),
 * generates a prioritized candidate handle matrix with platform-aware validation and prior weights.
 */

// Universal and cultural phonetic vowel expansions (e.g. Indian/South Asian: Harsh -> Harsha, Yash -> Yasha)
function getPhoneticExpansions(name) {
  if (!name) return [];
  const lower = name.toLowerCase().trim();
  const variants = new Set([lower]);

  // Vowel elongation (common in South Asian romanization)
  if (lower.endsWith("sh") || lower.endsWith("k") || lower.endsWith("d") || lower.endsWith("t") || lower.endsWith("m") || lower.endsWith("n")) {
    variants.add(lower + "a");
  }
  if (lower.endsWith("a")) {
    variants.add(lower.slice(0, -1)); // Harsha -> Harsh
  }

  // Double letters or leet-style phonetic mutations
  if (lower.includes("ee")) variants.add(lower.replace(/ee/g, "i"));
  if (lower.includes("oo")) variants.add(lower.replace(/oo/g, "u"));

  return Array.from(variants);
}

// Common abbreviations / short forms
function getNameShortForms(name) {
  if (!name) return [];
  const lower = name.toLowerCase().trim();
  const forms = new Set([lower]);

  if (lower === "kumar") {
    forms.add("k");
    forms.add("kr");
    forms.add("kmr");
  } else if (lower === "singh") {
    forms.add("s");
    forms.add("sgh");
  } else if (lower.length > 4) {
    forms.add(lower[0]); // initial
  }

  return Array.from(forms);
}

/**
 * Generate a prioritized list of username permutation candidates from identity seeds.
 * @param {object} seeds
 * @param {string} seeds.firstName - e.g. "Harsh"
 * @param {string} [seeds.lastName] - e.g. "Kumar"
 * @param {string[]} [seeds.nicknames] - e.g. ["harshu", "harry"]
 * @param {string[]} [seeds.numbers] - e.g. ["25", "1998", "07"]
 * @param {string[]} [seeds.phoneticVariants] - optional manual overrides
 * @param {string[]} [seeds.keywords] - e.g. ["dev", "tech"]
 * @returns {Array<{username: string, pattern: string, priorWeight: number, isHomonymRisk: boolean}>}
 */
export function generatePermutationMatrix(seeds) {
  const {
    firstName = "",
    lastName = "",
    nicknames = [],
    numbers = [],
    phoneticVariants = [],
    keywords = []
  } = seeds;

  if (!firstName && !lastName && nicknames.length === 0) {
    return [];
  }

  const firsts = Array.from(new Set([
    ...getPhoneticExpansions(firstName),
    ...phoneticVariants.map(v => v.toLowerCase().trim())
  ].filter(Boolean)));

  const lasts = Array.from(new Set([
    lastName.toLowerCase().trim(),
    ...getNameShortForms(lastName)
  ].filter(Boolean)));

  const nicks = Array.from(new Set([
    ...nicknames.map(n => n.toLowerCase().trim())
  ].filter(Boolean)));

  const cleanNumbers = Array.from(new Set(
    numbers.map(n => String(n).trim()).filter(Boolean)
  ));

  const candidates = new Map();

  const addCandidate = (username, pattern, priorWeight, isHomonymRisk = false) => {
    const clean = username.trim().toLowerCase();
    // Enforce basic sanity
    if (!clean || clean.length < 3 || clean.length > 30) return;
    if (!candidates.has(clean) || candidates.get(clean).priorWeight < priorWeight) {
      candidates.set(clean, {
        username: clean,
        pattern,
        priorWeight,
        isHomonymRisk
      });
    }
  };

  // --- Tier 0: Direct Literal Nicknames & Alternate Handles ---
  for (const nick of nicks) {
    addCandidate(nick, "literal_nickname", 0.99, false);
    // If nickname has letters + numbers like "jhah1225", also extract parts
    const match = nick.match(/^([a-z]+)(\d+)$/);
    if (match) {
      const [, prefix, num] = match;
      if (!cleanNumbers.includes(num)) cleanNumbers.push(num);
      for (const l of lasts) {
        addCandidate(`${prefix}${l}`, "nick_prefix+last", 0.93, false);
      }
    }
  }

  // --- Tier 1A: Full Phonetic Name + Numbers (Direct & Reverse) ---
  // High specificity, lowest homonym collision risk.
  // Examples: harshakumar25, harshkumar25, kumarharsh2025, kumar-harsh2025
  for (const f of firsts) {
    const fullLast = lastName.toLowerCase().trim();
    if (fullLast) {
      for (const num of cleanNumbers) {
        // Forward: harshakumar25, harshkumar25
        addCandidate(`${f}${fullLast}${num}`, "first+last+number", 0.97, false);
        addCandidate(`${f}_${fullLast}${num}`, "first+sep+last+number", 0.94, false);
        addCandidate(`${f}-${fullLast}${num}`, "first+hyphen+last+number", 0.94, false);
        addCandidate(`${f}.${fullLast}${num}`, "first+dot+last+number", 0.94, false);

        // Reverse: kumarharsh2025, kumar-harsh2025, kumar_harsh25
        addCandidate(`${fullLast}${f}${num}`, "last+first+number", 0.95, false);
        addCandidate(`${fullLast}-${f}${num}`, "last+hyphen+first+number", 0.95, false);
        addCandidate(`${fullLast}_${f}${num}`, "last+sep+first+number", 0.94, false);
      }
    }
  }

  // --- Tier 1B: Abbreviated Last Name + Numbers ---
  for (const f of firsts) {
    for (const l of lasts) {
      if (l === lastName.toLowerCase().trim()) continue; // already handled in Tier 1A
      for (const num of cleanNumbers) {
        // e.g. harshk25, harshak25
        addCandidate(`${f}${l}${num}`, "first+last_initial+number", 0.92, false);
        addCandidate(`${f}_${l}${num}`, "first+sep+last_initial+number", 0.90, false);
        addCandidate(`${f}-${l}${num}`, "first+hyphen+last_initial+number", 0.90, false);
      }
    }
  }

  // --- Tier 2: Nicknames with Numbers & Suffixes ---
  for (const nick of nicks) {
    for (const num of cleanNumbers) {
      addCandidate(`${nick}${num}`, "nickname+number", 0.93, false);
      addCandidate(`${nick}_${num}`, "nickname+sep+number", 0.90, false);
      addCandidate(`${nick}-${num}`, "nickname+hyphen+number", 0.90, false);
    }
    for (const l of lasts) {
      addCandidate(`${nick}${l}`, "nickname+last", 0.86, false);
      addCandidate(`${nick}_${l}`, "nickname+sep+last", 0.84, false);
    }
  }

  // --- Tier 3: First Name + Numbers (No Last Name) ---
  for (const f of firsts) {
    for (const num of cleanNumbers) {
      // e.g. harsh25, harsha25
      addCandidate(`${f}${num}`, "first+number", 0.87, false);
      addCandidate(`${f}_${num}`, "first+sep+number", 0.85, false);
    }
  }

  // --- Tier 4: First + Last Initial or First Initial + Last ---
  for (const f of firsts) {
    for (const l of lasts) {
      for (const num of cleanNumbers) {
        if (f.length > 1) {
          addCandidate(`${f[0]}${l}${num}`, "first_initial+last+number", 0.89, false);
          addCandidate(`${f[0]}_${l}${num}`, "first_initial+sep+last+number", 0.87, false);
        }
      }
    }
  }

  // --- Tier 5: Contextual Affixes (e.g. dev, tech, real, iam, the) ---
  const affixes = ["dev", "tech", "real", "iam", "the", ...keywords.map(k => k.toLowerCase().trim())];
  for (const f of firsts) {
    for (const affix of affixes.slice(0, 5)) {
      if (!affix || affix.length > 10) continue;
      addCandidate(`${f}_${affix}`, "first+affix", 0.72, false);
      addCandidate(`${affix}_${f}`, "affix+first", 0.70, false);
      addCandidate(`${f}${affix}`, "first+affix_joined", 0.69, false);
    }
  }

  // --- Tier 6: Bare Name Combinations without Numbers (Homonym Risk) ---
  for (const f of firsts) {
    for (const l of lasts) {
      addCandidate(`${f}${l}`, "first+last", 0.65, true);
      addCandidate(`${f}_${l}`, "first+sep+last", 0.68, true);
      addCandidate(`${f}.${l}`, "first+dot+last", 0.67, true);
      if (l.length > 1) addCandidate(`${f}${l[0]}`, "first+last_initial", 0.60, true);
      if (f.length > 1) addCandidate(`${f[0]}${l}`, "first_initial+last", 0.60, true);
    }
  }

  // Sort candidates by prior weight descending
  return Array.from(candidates.values()).sort((a, b) => b.priorWeight - a.priorWeight);
}

/**
 * Validates whether a candidate handle is structurally permitted on a specific platform.
 * @param {string} username
 * @param {object} platform - Catalog platform definition
 * @returns {boolean}
 */
export function isCandidateAllowedOnPlatform(username, platform) {
  const pName = (platform.name || "").toLowerCase();

  // GitHub: alphanumeric or single hyphen, cannot start/end with hyphen, no underscore
  if (pName.includes("github")) {
    if (username.includes("_") || username.includes(".")) return false;
    return /^[a-zA-Z0-9]([a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/.test(username);
  }

  // Twitter/X: letters, numbers, underscores only, max 15 chars
  if (pName.includes("twitter") || pName.includes("x.com")) {
    if (username.includes(".") || username.includes("-")) return false;
    return /^[a-zA-Z0-9_]{1,15}$/.test(username);
  }

  // Telegram: min 5 chars, letters, numbers, underscores only
  if (pName.includes("telegram")) {
    if (username.length < 5 || username.includes(".") || username.includes("-")) return false;
    return /^[a-zA-Z0-9_]{5,32}$/.test(username);
  }

  // Reddit: letters, numbers, underscores, hyphens, min 3, max 20, no dots
  if (pName.includes("reddit")) {
    if (username.includes(".")) return false;
    return /^[a-zA-Z0-9_-]{3,20}$/.test(username);
  }

  // Default: basic URL-safe ASCII
  return /^[a-zA-Z0-9_.-]{2,40}$/.test(username);
}

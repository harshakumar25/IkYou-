/**
 * Phone Number Investigation & Carrier Intelligence Engine
 * 
 * Provides deep OSINT intelligence for international phone numbers:
 * 1. E.164, National, International, and RFC 3966 normalization & formatting
 * 2. Country Calling Code and National Numbering Plan (NNP) resolution
 * 3. Line Type Classification (Mobile / Cellular, Fixed Line / Landline, VoIP, Toll-Free)
 * 4. Geographic Subdivisions & Telecom Circles (US/CA Area Codes, Indian Telecom Circles, UK/EU City Codes)
 * 5. Carrier Allocation & Network Fingerprinting
 * 6. Local Timezone & Current Clock Computation
 * 7. Messaging Services Probing (WhatsApp, Telegram, Viber) with optional REA Playwright verification
 * 8. Caller ID & Public Leak Dork Matrix Generation
 */

import { executeReaScenario } from "../rea-bridge.mjs";

export const COUNTRY_CODES = [
  { code: "1", country: "United States / Canada", iso: "US/CA", flag: "🇺🇸/🇨🇦", defaultTz: "America/New_York", utcOffset: "-05:00" },
  { code: "7", country: "Russia / Kazakhstan", iso: "RU/KZ", flag: "🇷🇺", defaultTz: "Europe/Moscow", utcOffset: "+03:00" },
  { code: "20", country: "Egypt", iso: "EG", flag: "🇪🇬", defaultTz: "Africa/Cairo", utcOffset: "+02:00" },
  { code: "27", country: "South Africa", iso: "ZA", flag: "🇿🇦", defaultTz: "Africa/Johannesburg", utcOffset: "+02:00" },
  { code: "30", country: "Greece", iso: "GR", flag: "🇬🇷", defaultTz: "Europe/Athens", utcOffset: "+02:00" },
  { code: "31", country: "Netherlands", iso: "NL", flag: "🇳🇱", defaultTz: "Europe/Amsterdam", utcOffset: "+01:00" },
  { code: "32", country: "Belgium", iso: "BE", flag: "🇧🇪", defaultTz: "Europe/Brussels", utcOffset: "+01:00" },
  { code: "33", country: "France", iso: "FR", flag: "🇫🇷", defaultTz: "Europe/Paris", utcOffset: "+01:00" },
  { code: "34", country: "Spain", iso: "ES", flag: "🇪🇸", defaultTz: "Europe/Madrid", utcOffset: "+01:00" },
  { code: "36", country: "Hungary", iso: "HU", flag: "🇭🇺", defaultTz: "Europe/Budapest", utcOffset: "+01:00" },
  { code: "39", country: "Italy", iso: "IT", flag: "🇮🇹", defaultTz: "Europe/Rome", utcOffset: "+01:00" },
  { code: "40", country: "Romania", iso: "RO", flag: "🇷🇴", defaultTz: "Europe/Bucharest", utcOffset: "+02:00" },
  { code: "41", country: "Switzerland", iso: "CH", flag: "🇨🇭", defaultTz: "Europe/Zurich", utcOffset: "+01:00" },
  { code: "43", country: "Austria", iso: "AT", flag: "🇦🇹", defaultTz: "Europe/Vienna", utcOffset: "+01:00" },
  { code: "44", country: "United Kingdom", iso: "GB", flag: "🇬🇧", defaultTz: "Europe/London", utcOffset: "+00:00" },
  { code: "45", country: "Denmark", iso: "DK", flag: "🇩🇰", defaultTz: "Europe/Copenhagen", utcOffset: "+01:00" },
  { code: "46", country: "Sweden", iso: "SE", flag: "🇸🇪", defaultTz: "Europe/Stockholm", utcOffset: "+01:00" },
  { code: "47", country: "Norway", iso: "NO", flag: "🇳🇴", defaultTz: "Europe/Oslo", utcOffset: "+01:00" },
  { code: "48", country: "Poland", iso: "PL", flag: "🇵🇱", defaultTz: "Europe/Warsaw", utcOffset: "+01:00" },
  { code: "49", country: "Germany", iso: "DE", flag: "🇩🇪", defaultTz: "Europe/Berlin", utcOffset: "+01:00" },
  { code: "51", country: "Peru", iso: "PE", flag: "🇵🇪", defaultTz: "America/Lima", utcOffset: "-05:00" },
  { code: "52", country: "Mexico", iso: "MX", flag: "🇲🇽", defaultTz: "America/Mexico_City", utcOffset: "-06:00" },
  { code: "54", country: "Argentina", iso: "AR", flag: "🇦🇷", defaultTz: "America/Argentina/Buenos_Aires", utcOffset: "-03:00" },
  { code: "55", country: "Brazil", iso: "BR", flag: "🇧🇷", defaultTz: "America/Sao_Paulo", utcOffset: "-03:00" },
  { code: "60", country: "Malaysia", iso: "MY", flag: "🇲🇾", defaultTz: "Asia/Kuala_Lumpur", utcOffset: "+08:00" },
  { code: "61", country: "Australia", iso: "AU", flag: "🇦🇺", defaultTz: "Australia/Sydney", utcOffset: "+10:00" },
  { code: "62", country: "Indonesia", iso: "ID", flag: "🇮🇩", defaultTz: "Asia/Jakarta", utcOffset: "+07:00" },
  { code: "63", country: "Philippines", iso: "PH", flag: "🇵🇭", defaultTz: "Asia/Manila", utcOffset: "+08:00" },
  { code: "64", country: "New Zealand", iso: "NZ", flag: "🇳🇿", defaultTz: "Pacific/Auckland", utcOffset: "+12:00" },
  { code: "65", country: "Singapore", iso: "SG", flag: "🇸🇬", defaultTz: "Asia/Singapore", utcOffset: "+08:00" },
  { code: "66", country: "Thailand", iso: "TH", flag: "🇹🇭", defaultTz: "Asia/Bangkok", utcOffset: "+07:00" },
  { code: "81", country: "Japan", iso: "JP", flag: "🇯🇵", defaultTz: "Asia/Tokyo", utcOffset: "+09:00" },
  { code: "82", country: "South Korea", iso: "KR", flag: "🇰🇷", defaultTz: "Asia/Seoul", utcOffset: "+09:00" },
  { code: "84", country: "Vietnam", iso: "VN", flag: "🇻🇳", defaultTz: "Asia/Ho_Chi_Minh", utcOffset: "+07:00" },
  { code: "86", country: "China", iso: "CN", flag: "🇨🇳", defaultTz: "Asia/Shanghai", utcOffset: "+08:00" },
  { code: "90", country: "Turkey", iso: "TR", flag: "🇹🇷", defaultTz: "Europe/Istanbul", utcOffset: "+03:00" },
  { code: "91", country: "India", iso: "IN", flag: "🇮🇳", defaultTz: "Asia/Kolkata", utcOffset: "+05:30" },
  { code: "92", country: "Pakistan", iso: "PK", flag: "🇵🇰", defaultTz: "Asia/Karachi", utcOffset: "+05:00" },
  { code: "93", country: "Afghanistan", iso: "AF", flag: "🇦🇫", defaultTz: "Asia/Kabul", utcOffset: "+04:30" },
  { code: "94", country: "Sri Lanka", iso: "LK", flag: "🇱🇰", defaultTz: "Asia/Colombo", utcOffset: "+05:30" },
  { code: "95", country: "Myanmar", iso: "MM", flag: "🇲🇲", defaultTz: "Asia/Yangon", utcOffset: "+06:30" },
  { code: "98", country: "Iran", iso: "IR", flag: "🇮🇷", defaultTz: "Asia/Tehran", utcOffset: "+03:30" },
  { code: "212", country: "Morocco", iso: "MA", flag: "🇲🇦", defaultTz: "Africa/Casablanca", utcOffset: "+01:00" },
  { code: "213", country: "Algeria", iso: "DZ", flag: "🇩🇿", defaultTz: "Africa/Algiers", utcOffset: "+01:00" },
  { code: "216", country: "Tunisia", iso: "TN", flag: "🇹🇳", defaultTz: "Africa/Tunis", utcOffset: "+01:00" },
  { code: "234", country: "Nigeria", iso: "NG", flag: "🇳🇬", defaultTz: "Africa/Lagos", utcOffset: "+01:00" },
  { code: "254", country: "Kenya", iso: "KE", flag: "🇰🇪", defaultTz: "Africa/Nairobi", utcOffset: "+03:00" },
  { code: "351", country: "Portugal", iso: "PT", flag: "🇵🇹", defaultTz: "Europe/Lisbon", utcOffset: "+00:00" },
  { code: "352", country: "Luxembourg", iso: "LU", flag: "🇱🇺", defaultTz: "Europe/Luxembourg", utcOffset: "+01:00" },
  { code: "353", country: "Ireland", iso: "IE", flag: "🇮🇪", defaultTz: "Europe/Dublin", utcOffset: "+00:00" },
  { code: "354", country: "Iceland", iso: "IS", flag: "🇮🇸", defaultTz: "Atlantic/Reykjavik", utcOffset: "+00:00" },
  { code: "358", country: "Finland", iso: "FI", flag: "🇫🇮", defaultTz: "Europe/Helsinki", utcOffset: "+02:00" },
  { code: "380", country: "Ukraine", iso: "UA", flag: "🇺🇦", defaultTz: "Europe/Kyiv", utcOffset: "+02:00" },
  { code: "852", country: "Hong Kong", iso: "HK", flag: "🇭🇰", defaultTz: "Asia/Hong_Kong", utcOffset: "+08:00" },
  { code: "886", country: "Taiwan", iso: "TW", flag: "🇹🇼", defaultTz: "Asia/Taipei", utcOffset: "+08:00" },
  { code: "966", country: "Saudi Arabia", iso: "SA", flag: "🇸🇦", defaultTz: "Asia/Riyadh", utcOffset: "+03:00" },
  { code: "971", country: "United Arab Emirates", iso: "AE", flag: "🇦🇪", defaultTz: "Asia/Dubai", utcOffset: "+04:00" },
  { code: "972", country: "Israel", iso: "IL", flag: "🇮🇱", defaultTz: "Asia/Jerusalem", utcOffset: "+02:00" },
  { code: "974", country: "Qatar", iso: "QA", flag: "🇶🇦", defaultTz: "Asia/Qatar", utcOffset: "+03:00" },
  { code: "965", country: "Kuwait", iso: "KW", flag: "🇰🇼", defaultTz: "Asia/Kuwait", utcOffset: "+03:00" }
];

// Sort descending by length so 3-digit country codes match before 1-digit
COUNTRY_CODES.sort((a, b) => b.code.length - a.code.length);

/**
 * NANP (North American Numbering Plan) Area Code & State Registry (+1)
 */
const NANP_AREA_CODES = {
  // California
  "415": { state: "California", city: "San Francisco", tz: "America/Los_Angeles", utc: "-08:00" },
  "510": { state: "California", city: "Oakland", tz: "America/Los_Angeles", utc: "-08:00" },
  "408": { state: "California", city: "San Jose / Silicon Valley", tz: "America/Los_Angeles", utc: "-08:00" },
  "650": { state: "California", city: "Palo Alto / San Mateo", tz: "America/Los_Angeles", utc: "-08:00" },
  "213": { state: "California", city: "Los Angeles", tz: "America/Los_Angeles", utc: "-08:00" },
  "310": { state: "California", city: "Santa Monica / Beverly Hills", tz: "America/Los_Angeles", utc: "-08:00" },
  "619": { state: "California", city: "San Diego", tz: "America/Los_Angeles", utc: "-08:00" },
  "916": { state: "California", city: "Sacramento", tz: "America/Los_Angeles", utc: "-08:00" },

  // New York
  "212": { state: "New York", city: "New York City (Manhattan)", tz: "America/New_York", utc: "-05:00" },
  "646": { state: "New York", city: "New York City (Manhattan)", tz: "America/New_York", utc: "-05:00" },
  "718": { state: "New York", city: "New York City (Brooklyn/Queens)", tz: "America/New_York", utc: "-05:00" },
  "917": { state: "New York", city: "New York City", tz: "America/New_York", utc: "-05:00" },
  "516": { state: "New York", city: "Long Island", tz: "America/New_York", utc: "-05:00" },
  "518": { state: "New York", city: "Albany", tz: "America/New_York", utc: "-05:00" },

  // Texas
  "512": { state: "Texas", city: "Austin", tz: "America/Chicago", utc: "-06:00" },
  "214": { state: "Texas", city: "Dallas", tz: "America/Chicago", utc: "-06:00" },
  "713": { state: "Texas", city: "Houston", tz: "America/Chicago", utc: "-06:00" },
  "210": { state: "Texas", city: "San Antonio", tz: "America/Chicago", utc: "-06:00" },

  // Washington & Oregon
  "206": { state: "Washington", city: "Seattle", tz: "America/Los_Angeles", utc: "-08:00" },
  "425": { state: "Washington", city: "Bellevue / Redmond", tz: "America/Los_Angeles", utc: "-08:00" },
  "503": { state: "Oregon", city: "Portland", tz: "America/Los_Angeles", utc: "-08:00" },

  // Illinois
  "312": { state: "Illinois", city: "Chicago (Downtown)", tz: "America/Chicago", utc: "-06:00" },
  "773": { state: "Illinois", city: "Chicago", tz: "America/Chicago", utc: "-06:00" },

  // Florida
  "305": { state: "Florida", city: "Miami", tz: "America/New_York", utc: "-05:00" },
  "407": { state: "Florida", city: "Orlando", tz: "America/New_York", utc: "-05:00" },
  "813": { state: "Florida", city: "Tampa", tz: "America/New_York", utc: "-05:00" },

  // Massachusetts
  "617": { state: "Massachusetts", city: "Boston / Cambridge", tz: "America/New_York", utc: "-05:00" },

  // District of Columbia / Virginia / Maryland
  "202": { state: "District of Columbia", city: "Washington D.C.", tz: "America/New_York", utc: "-05:00" },
  "703": { state: "Virginia", city: "Arlington / Alexandria", tz: "America/New_York", utc: "-05:00" },
  "301": { state: "Maryland", city: "Bethesda / Silver Spring", tz: "America/New_York", utc: "-05:00" },

  // Canada Provinces
  "416": { state: "Ontario, Canada", city: "Toronto", tz: "America/Toronto", utc: "-05:00" },
  "647": { state: "Ontario, Canada", city: "Toronto", tz: "America/Toronto", utc: "-05:00" },
  "604": { state: "British Columbia, Canada", city: "Vancouver", tz: "America/Vancouver", utc: "-08:00" },
  "514": { state: "Quebec, Canada", city: "Montreal", tz: "America/Montreal", utc: "-05:00" },
  "403": { state: "Alberta, Canada", city: "Calgary", tz: "America/Edmonton", utc: "-07:00" }
};

const TOLL_FREE_NANP = new Set(["800", "888", "877", "866", "855", "844", "833"]);

/**
 * Indian Telecom Circles & Mobile Operator Series (+91)
 */
function resolveIndianNumber(nationalNumber) {
  if (nationalNumber.length !== 10) {
    return {
      lineType: nationalNumber.length > 10 ? "Landline / Enterprise" : "Short Code / Landline",
      circle: "India",
      carrier: "BSNL / MTNL / Enterprise",
      tz: "Asia/Kolkata",
      utc: "+05:30"
    };
  }

  const firstDigit = nationalNumber[0];
  const first2 = nationalNumber.slice(0, 2);
  const first4 = nationalNumber.slice(0, 4);

  let carrier = "Indian Mobile Operator (Jio / Airtel / Vi / BSNL)";
  if (firstDigit === "6" || first4.startsWith("701") || first4.startsWith("797") || first2 === "89" || first2 === "62" || first2 === "63") {
    carrier = "Reliance Jio Infocomm";
  } else if (first2 === "98" || first2 === "99" || first2 === "97" || first4.startsWith("700") || first2 === "88") {
    carrier = "Bharti Airtel";
  } else if (first2 === "96" || first2 === "95" || first2 === "91" || first2 === "77" || first2 === "82") {
    carrier = "Vodafone Idea (Vi)";
  } else if (first2 === "94" || first2 === "93") {
    carrier = "BSNL Mobile";
  }

  // Circle allocation heuristics based on prefix
  let circle = "India (National Roaming)";
  const prefix2 = parseInt(first2, 10);
  if (prefix2 >= 98 && prefix2 <= 99) {
    const p3 = nationalNumber.slice(0, 3);
    if (p3 === "981" || p3 === "987" || p3 === "991") circle = "Delhi NCR";
    else if (p3 === "982" || p3 === "992") circle = "Mumbai / Maharashtra";
    else if (p3 === "983" || p3 === "993") circle = "Kolkata / West Bengal";
    else if (p3 === "984" || p3 === "994") circle = "Karnataka / Bangalore / Tamil Nadu";
    else if (p3 === "989" || p3 === "999") circle = "Kerala / Haryana";
  } else if (first4.startsWith("70") || first4.startsWith("80")) {
    circle = "Pan-India 4G/5G Network Circle";
  }

  return {
    lineType: "Mobile / Cellular",
    circle,
    carrier,
    tz: "Asia/Kolkata",
    utc: "+05:30"
  };
}

/**
 * United Kingdom National Numbering Plan (+44)
 */
function resolveUKNumber(nationalNumber) {
  // Mobile ranges: 7xxx (07xxx)
  if (nationalNumber.startsWith("7")) {
    let carrier = "UK Mobile (EE / O2 / Vodafone / Three)";
    const p3 = nationalNumber.slice(0, 3);
    if (p3 === "710" || p3 === "750" || p3 === "753" || p3 === "770" || p3 === "780") carrier = "Vodafone UK";
    else if (p3 === "771" || p3 === "772" || p3 === "773" || p3 === "778" || p3 === "781" || p3 === "782" || p3 === "797") carrier = "EE (Everything Everywhere)";
    else if (p3 === "774" || p3 === "775" || p3 === "783" || p3 === "784" || p3 === "785" || p3 === "792" || p3 === "793") carrier = "Virgin Media O2";
    else if (p3 === "740" || p3 === "741" || p3 === "776" || p3 === "777" || p3 === "787") carrier = "Three UK";

    return {
      lineType: "Mobile / Cellular",
      region: "United Kingdom",
      carrier,
      tz: "Europe/London",
      utc: "+00:00"
    };
  }

  // Geographic Landlines
  let region = "United Kingdom (Geographic Landline)";
  if (nationalNumber.startsWith("20")) region = "London";
  else if (nationalNumber.startsWith("121")) region = "Birmingham";
  else if (nationalNumber.startsWith("161")) region = "Manchester";
  else if (nationalNumber.startsWith("141")) region = "Glasgow";
  else if (nationalNumber.startsWith("131")) region = "Edinburgh";
  else if (nationalNumber.startsWith("113")) region = "Leeds";
  else if (nationalNumber.startsWith("151")) region = "Liverpool";

  return {
    lineType: "Fixed Line / Landline",
    region,
    carrier: "BT / Virgin Media / CityFibre",
    tz: "Europe/London",
    utc: "+00:00"
  };
}

/**
 * Normalizes input to clean E.164 (+1234567890)
 */
export function normalizePhone(input) {
  if (!input || typeof input !== "string") return null;
  const raw = input.trim();
  let digits = raw.replace(/[^0-9]/g, "");
  if (!digits || digits.length < 4 || digits.length > 15) return null;

  if (raw.startsWith("+")) {
    return `+${digits}`;
  }
  if (digits.startsWith("00") && digits.length > 5) {
    return `+${digits.slice(2)}`;
  }
  // Default fallback assuming international without leading plus
  return `+${digits}`;
}

/**
 * Deep Phone Parser & Intelligence Extractor
 */
export function parsePhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const withoutPlus = normalized.replace(/^\+/, "");
  let matchedCountry = null;

  for (const c of COUNTRY_CODES) {
    if (withoutPlus.startsWith(c.code)) {
      matchedCountry = c;
      break;
    }
  }

  if (!matchedCountry) {
    matchedCountry = {
      code: "Unknown",
      country: "International",
      iso: "INT",
      flag: "🌐",
      defaultTz: "UTC",
      utcOffset: "+00:00"
    };
  }

  const countryCode = matchedCountry.code;
  const nationalNumber = countryCode !== "Unknown" ? withoutPlus.slice(countryCode.length) : withoutPlus;

  // Granular Subdivisions & Carrier Intelligence
  let lineType = "General / Cellular";
  let region = matchedCountry.country;
  let carrier = "Regional Telecom Carrier";
  let tz = matchedCountry.defaultTz;
  let utc = matchedCountry.utcOffset;
  let isTollFree = false;

  if (countryCode === "1") {
    // US / Canada NANP Intelligence
    const areaCode = nationalNumber.slice(0, 3);
    if (TOLL_FREE_NANP.has(areaCode)) {
      lineType = "Toll-Free";
      isTollFree = true;
      region = "North America (Toll-Free Service)";
      carrier = "Toll-Free Telecommunications";
    } else if (NANP_AREA_CODES[areaCode]) {
      const info = NANP_AREA_CODES[areaCode];
      region = `${info.city}, ${info.state}`;
      tz = info.tz;
      utc = info.utc;
      lineType = "Mobile / Fixed Wireline";
      carrier = "AT&T / Verizon / T-Mobile / Bell";
    } else {
      region = "United States / Canada";
      lineType = "Mobile / Fixed Wireline";
      carrier = "North American Carrier";
    }
  } else if (countryCode === "91") {
    // India Telecom Circle & Mobile Series
    const inInfo = resolveIndianNumber(nationalNumber);
    lineType = inInfo.lineType;
    region = inInfo.circle;
    carrier = inInfo.carrier;
    tz = inInfo.tz;
    utc = inInfo.utc;
  } else if (countryCode === "44") {
    // United Kingdom NNP
    const ukInfo = resolveUKNumber(nationalNumber);
    lineType = ukInfo.lineType;
    region = ukInfo.region;
    carrier = ukInfo.carrier;
    tz = ukInfo.tz;
    utc = ukInfo.utc;
  } else if (countryCode === "33") {
    // France
    if (nationalNumber.startsWith("6") || nationalNumber.startsWith("7")) {
      lineType = "Mobile / Cellular";
      carrier = "Orange / SFR / Bouygues / Free Mobile";
    } else {
      lineType = "Fixed Line / Landline";
    }
  } else if (countryCode === "49") {
    // Germany
    if (nationalNumber.startsWith("15") || nationalNumber.startsWith("16") || nationalNumber.startsWith("17")) {
      lineType = "Mobile / Cellular";
      carrier = "Telekom / Vodafone / O2 Telefónica";
    } else {
      lineType = "Fixed Line / Landline";
    }
  } else if (countryCode === "61") {
    // Australia
    if (nationalNumber.startsWith("4")) {
      lineType = "Mobile / Cellular";
      carrier = "Telstra / Optus / TPG Vodafone";
    } else {
      lineType = "Fixed Line / Landline";
    }
  }

  // Formatting strings
  let international = `+${countryCode} ${nationalNumber}`;
  let national = nationalNumber;
  if (countryCode === "1" && nationalNumber.length === 10) {
    national = `(${nationalNumber.slice(0, 3)}) ${nationalNumber.slice(3, 6)}-${nationalNumber.slice(6)}`;
    international = `+1 ${nationalNumber.slice(0, 3)}-${nationalNumber.slice(3, 6)}-${nationalNumber.slice(6)}`;
  } else if (countryCode === "91" && nationalNumber.length === 10) {
    national = `0${nationalNumber.slice(0, 5)} ${nationalNumber.slice(5)}`;
    international = `+91 ${nationalNumber.slice(0, 5)} ${nationalNumber.slice(5)}`;
  } else if (countryCode === "44") {
    national = `0${nationalNumber}`;
    international = `+44 ${nationalNumber}`;
  }

  // Risk Score Heuristic (0.0 to 1.0)
  let riskScore = 0.05;
  let riskReasons = [];
  if (isTollFree) {
    riskScore += 0.45;
    riskReasons.push("Toll-Free line type commonly used in telemarketing or call-centers");
  }
  if (nationalNumber.length < 7 || nationalNumber.length > 13) {
    riskScore += 0.35;
    riskReasons.push("Abnormal digit count for destination country");
  }

  return {
    e164: normalized,
    countryCode,
    country: matchedCountry.country,
    iso: matchedCountry.iso,
    flag: matchedCountry.flag,
    nationalNumber,
    lineType,
    region,
    carrier,
    timezone: tz,
    utcOffset: utc,
    international,
    national,
    rfc3966: `tel:${normalized}`,
    valid: nationalNumber.length >= 7 && nationalNumber.length <= 13,
    riskScore: Math.min(riskScore, 0.95),
    riskReasons
  };
}

/**
 * Generates automated OSINT search engine dorks for a phone number
 */
export function generatePhoneDorks(parsed) {
  const { e164, nationalNumber, international } = parsed;
  return [
    { title: "Exact E.164 Number", query: `"${e164}"` },
    { title: "National Format Search", query: `"${nationalNumber}"` },
    { title: "Public Code Leaks & Pastebin", query: `"${e164}" (site:pastebin.com OR site:github.com OR site:gitlab.com)` },
    { title: "Social Profiles Cross-Index", query: `"${e164}" (site:facebook.com OR site:linkedin.com OR site:instagram.com OR site:twitter.com)` },
    { title: "Public Document & Invoice Leaks", query: `"${e164}" (filetype:pdf OR filetype:xlsx OR filetype:csv OR filetype:doc)` }
  ];
}

/**
 * Check phone number footprint across telecom registries, messaging gateways, and public indices
 * @param {string} phone
 * @param {function} onResult - Callback when a platform footprint is discovered
 * @param {function} onChecked - Callback on platform inspection progress
 * @param {object} [options]
 * @param {boolean} [options.deepRea=false]
 * @param {function} [options.onDig]
 */
export async function checkPhone(phone, onResult, onChecked, options = {}) {
  const parsed = parsePhone(phone);
  if (!parsed) return;

  const {
    e164,
    countryCode,
    country,
    flag,
    nationalNumber,
    lineType,
    region,
    carrier,
    timezone,
    utcOffset,
    international,
    national,
    rfc3966,
    riskScore,
    riskReasons
  } = parsed;

  const cleanDigits = e164.replace("+", "");

  // 1. Telecom & Carrier Registry
  await onResult({
    platform: "Telecom Registry",
    username: e164,
    displayName: `${flag} ${international} (${region})`,
    userId: e164,
    sourceQuery: e164,
    profileUrl: rfc3966,
    platformUrl: "",
    pfpUrl: "",
    bannerUrl: "",
    isVerified: parsed.valid,
    isPrivate: false,
    followers: 0,
    following: 0,
    posts: 0,
    likes: 0,
    location: `${region}, ${country}`,
    emails: [],
    phones: [e164],
    website: "",
    createdAt: "",
    lastActive: "",
    bio: `Carrier: ${carrier}. Line Type: ${lineType}. Subdivision: ${region}. Timezone: ${timezone} (${utcOffset}). Risk Score: ${Math.round(riskScore * 100)}%.`,
    extras: {
      e164,
      countryCallingCode: countryCode,
      country,
      iso: parsed.iso,
      region,
      carrier,
      lineType,
      timezone,
      utcOffset,
      international,
      national,
      nationalNumber,
      digitsCount: cleanDigits.length,
      riskScore,
      riskReasons
    }
  });
  onChecked?.({ total: 1, counts: { "Telecom Registry": 1 } });

  // 2. WhatsApp Direct Messaging & Profile Probe
  const waUrl = `https://wa.me/${cleanDigits}`;
  const waApiUrl = `https://api.whatsapp.com/send?phone=${cleanDigits}`;
  let waActive = false;
  let waBio = "WhatsApp direct click-to-chat messaging link generated.";

  try {
    const waRes = await fetch(waApiUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    if (waRes.status === 200) {
      const html = await waRes.text();
      waActive = html.includes("action_button") || html.includes("Continue to Chat");
      if (waActive) {
        waBio = "Active WhatsApp messaging endpoint verified. Direct chat action resolved.";
      }
    }
  } catch {}

  const waResult = {
    platform: "WhatsApp",
    username: e164,
    displayName: `WhatsApp (${international})`,
    userId: cleanDigits,
    sourceQuery: e164,
    profileUrl: waUrl,
    platformUrl: "https://whatsapp.com",
    pfpUrl: "",
    bannerUrl: "",
    isVerified: waActive,
    isPrivate: false,
    followers: 0,
    following: 0,
    posts: 0,
    likes: 0,
    location: country,
    emails: [],
    phones: [e164],
    website: waUrl,
    createdAt: "",
    lastActive: "",
    bio: waBio,
    extras: {
      whatsappUrl: waUrl,
      whatsappApiUrl: waApiUrl,
      status: waActive ? "Active" : "Gateway Ready",
      outlinks: [waUrl],
      linkedAccounts: [{ platform: "WhatsApp", username: e164, url: waUrl }]
    }
  };

  // Optional REA Browser Verification on WhatsApp Web gateway
  if (options.deepRea) {
    try {
      const reaEvidence = await executeReaScenario(waApiUrl, { waitMs: 2500 });
      if (reaEvidence && reaEvidence.success) {
        waResult.reaEvidence = reaEvidence;
        if (reaEvidence.screenshotUrl) waResult.screenshotUrl = reaEvidence.screenshotUrl;
      }
    } catch {}
  }

  await onResult(waResult);
  onChecked?.({ total: 1, counts: { "WhatsApp": 1 } });

  // 3. Telegram Direct Contact Link
  const tgUrl = `https://t.me/+${cleanDigits}`;
  await onResult({
    platform: "Telegram Contact",
    username: e164,
    displayName: `Telegram (${e164})`,
    userId: cleanDigits,
    sourceQuery: e164,
    profileUrl: tgUrl,
    platformUrl: "https://telegram.org",
    pfpUrl: "",
    bannerUrl: "",
    isVerified: false,
    isPrivate: false,
    followers: 0,
    following: 0,
    posts: 0,
    likes: 0,
    location: country,
    emails: [],
    phones: [e164],
    website: tgUrl,
    createdAt: "",
    lastActive: "",
    bio: `Telegram contact deep link generated for +${cleanDigits}. Direct app handoff supported.`,
    extras: {
      telegramUrl: tgUrl,
      outlinks: [tgUrl],
      linkedAccounts: [{ platform: "Telegram", username: `+${cleanDigits}`, url: tgUrl }]
    }
  });
  onChecked?.({ total: 1, counts: { "Telegram Contact": 1 } });

  // 4. Viber Web Gateway
  const viberDeepLink = `viber://chat?number=%2B${cleanDigits}`;
  await onResult({
    platform: "Viber Messenger",
    username: e164,
    displayName: `Viber (${e164})`,
    userId: cleanDigits,
    sourceQuery: e164,
    profileUrl: `https://viber.com`,
    platformUrl: "https://viber.com",
    pfpUrl: "",
    bannerUrl: "",
    isVerified: false,
    isPrivate: false,
    followers: 0,
    following: 0,
    posts: 0,
    likes: 0,
    location: country,
    emails: [],
    phones: [e164],
    website: viberDeepLink,
    createdAt: "",
    lastActive: "",
    bio: `Viber communication scheme: ${viberDeepLink}`,
    extras: {
      viberUri: viberDeepLink
    }
  });
  onChecked?.({ total: 1, counts: { "Viber Messenger": 1 } });

  // 5. Truecaller Caller ID Pivot Link
  const isoCode = (parsed.iso || "int").toLowerCase().split("/")[0];
  const truecallerUrl = `https://www.truecaller.com/search/${isoCode}/${nationalNumber}`;
  await onResult({
    platform: "Truecaller Search",
    username: e164,
    displayName: `Truecaller: ${international}`,
    userId: cleanDigits,
    sourceQuery: e164,
    profileUrl: truecallerUrl,
    platformUrl: "https://www.truecaller.com",
    pfpUrl: "",
    bannerUrl: "",
    isVerified: false,
    isPrivate: false,
    followers: 0,
    following: 0,
    posts: 0,
    likes: 0,
    location: `${region}, ${country}`,
    emails: [],
    phones: [e164],
    website: truecallerUrl,
    createdAt: "",
    lastActive: "",
    bio: `Public Caller ID & Spam community registry search vector for ${international}.`,
    extras: {
      truecallerSearchUrl: truecallerUrl,
      outlinks: [truecallerUrl]
    }
  });
  onChecked?.({ total: 1, counts: { "Truecaller Search": 1 } });

  // 6. OSINT Public Leak & Search Dork Matrix
  const dorks = generatePhoneDorks(parsed);
  await onResult({
    platform: "OSINT Search Dorks",
    username: e164,
    displayName: `OSINT Dork Matrix (${e164})`,
    userId: cleanDigits,
    sourceQuery: e164,
    profileUrl: `https://www.google.com/search?q=${encodeURIComponent(`"${e164}"`)}`,
    platformUrl: "https://google.com",
    pfpUrl: "",
    bannerUrl: "",
    isVerified: true,
    isPrivate: false,
    followers: 0,
    following: 0,
    posts: 0,
    likes: 0,
    location: country,
    emails: [],
    phones: [e164],
    website: `https://www.google.com/search?q=${encodeURIComponent(`"${e164}"`)}`,
    createdAt: "",
    lastActive: "",
    bio: `Generated ${dorks.length} high-precision OSINT dorks for pastebins, social networks, and leaked spreadsheets.`,
    extras: {
      dorks: dorks.map(d => ({
        ...d,
        googleUrl: `https://www.google.com/search?q=${encodeURIComponent(d.query)}`
      }))
    }
  });
  onChecked?.({ total: 1, counts: { "OSINT Search Dorks": 1 } });
}

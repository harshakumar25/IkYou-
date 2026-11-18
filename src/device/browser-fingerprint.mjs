import crypto from "node:crypto";

/**
 * Server-side helper to normalize and hash client device components into a persistent Visitor ID.
 * @param {object} components - Dictionary of raw client fingerprinting components
 * @returns {object} { visitorId, confidenceScore, components }
 */
export function computeVisitorIdentifier(components) {
  const entropyBag = [
    components.canvasHash || "",
    components.webglVendor || "",
    components.webglRenderer || "",
    components.audioHash || "",
    components.hardwareConcurrency || "",
    components.deviceMemory || "",
    components.screenResolution || "",
    components.colorDepth || "",
    components.timezone || "",
    components.language || "",
    components.platform || "",
    components.installedFontsHash || ""
  ].join("|#|");

  const visitorId = crypto.createHash("sha256").update(entropyBag).digest("hex");

  // Confidence calculation based on entropy completeness
  let filledSignals = 0;
  const criticalKeys = [
    "canvasHash", "webglRenderer", "audioHash", "hardwareConcurrency",
    "screenResolution", "timezone", "platform"
  ];

  for (const k of criticalKeys) {
    if (components[k]) filledSignals++;
  }

  const confidenceScore = Math.min(0.99, Number((0.4 + (filledSignals / criticalKeys.length) * 0.59).toFixed(2)));

  return {
    visitorId,
    confidenceScore,
    isBot: Boolean(components.webdriver || components.headless),
    incognitoProbable: Boolean(components.incognitoProbable),
    components
  };
}

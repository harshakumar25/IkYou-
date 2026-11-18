/**
 * LocalFingerprint - Main Entry Point & SDK
 */

export { createServer } from "./server.mjs";
export { executeSearch } from "./engine/search-orchestrator.mjs";
export { checkUsername } from "./engine/username-checker.mjs";
export { checkEmail, validateEmail } from "./engine/email-checker.mjs";
export { checkPhone, normalizePhone, parsePhone } from "./engine/phone-checker.mjs";
export { extractDigLeads } from "./engine/dig-engine.mjs";
export { getPlatforms } from "./platforms/catalog.mjs";
export { computeVisitorIdentifier } from "./device/browser-fingerprint.mjs";
export { exportToJson, exportToCsv, exportToTextDossier } from "./exporters/export-service.mjs";

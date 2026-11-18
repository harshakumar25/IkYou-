import test from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, parsePhone, generatePhoneDorks, checkPhone } from "../src/engine/phone-checker.mjs";

test("Phone Intelligence - Normalizes various international input representations", () => {
  assert.equal(normalizePhone("+1 (415) 555-0123"), "+14155550123");
  assert.equal(normalizePhone("0091 98765 43210"), "+919876543210");
  assert.equal(normalizePhone("+44 7911 123456"), "+447911123456");
  assert.equal(normalizePhone("  +91-98101-23456  "), "+919810123456");
  assert.equal(normalizePhone("123"), null, "Too short numbers must be rejected");
  assert.equal(normalizePhone(""), null, "Empty input must be rejected");
});

test("Phone Intelligence - US NANP Area Code, State, and Toll-Free Detection", () => {
  const sfPhone = parsePhone("+14155550123");
  assert.equal(sfPhone.countryCode, "1");
  assert.equal(sfPhone.country, "United States / Canada");
  assert.equal(sfPhone.region, "San Francisco, California");
  assert.equal(sfPhone.timezone, "America/Los_Angeles");
  assert.equal(sfPhone.utcOffset, "-08:00");
  assert.equal(sfPhone.lineType, "Mobile / Fixed Wireline");
  assert.ok(sfPhone.national.includes("(415) 555-0123"));

  const nycPhone = parsePhone("+12125550199");
  assert.equal(nycPhone.region, "New York City (Manhattan), New York");
  assert.equal(nycPhone.timezone, "America/New_York");

  const tollFree = parsePhone("+18005550122");
  assert.equal(tollFree.lineType, "Toll-Free");
  assert.ok(tollFree.riskScore > 0.4, "Toll-free numbers must have elevated risk score");
  assert.ok(tollFree.riskReasons.some(r => r.includes("Toll-Free")));
});

test("Phone Intelligence - India Telecom Circles, Operators, and Formats", () => {
  const delhiPhone = parsePhone("+919810123456");
  assert.equal(delhiPhone.countryCode, "91");
  assert.equal(delhiPhone.country, "India");
  assert.equal(delhiPhone.region, "Delhi NCR");
  assert.equal(delhiPhone.carrier, "Bharti Airtel");
  assert.equal(delhiPhone.timezone, "Asia/Kolkata");
  assert.equal(delhiPhone.utcOffset, "+05:30");
  assert.equal(delhiPhone.lineType, "Mobile / Cellular");
  assert.equal(delhiPhone.national, "098101 23456");
  assert.equal(delhiPhone.international, "+91 98101 23456");

  const jioPhone = parsePhone("+916200123456");
  assert.equal(jioPhone.carrier, "Reliance Jio Infocomm");
  assert.equal(jioPhone.lineType, "Mobile / Cellular");
});

test("Phone Intelligence - UK and European Regional Numbering Plans", () => {
  const ukMobile = parsePhone("+447911123456");
  assert.equal(ukMobile.countryCode, "44");
  assert.equal(ukMobile.country, "United Kingdom");
  assert.equal(ukMobile.lineType, "Mobile / Cellular");
  assert.ok(ukMobile.carrier.includes("EE") || ukMobile.carrier.includes("UK Mobile"));
  assert.equal(ukMobile.timezone, "Europe/London");

  const ukLondon = parsePhone("+442079460991");
  assert.equal(ukLondon.region, "London");
  assert.equal(ukLondon.lineType, "Fixed Line / Landline");

  const franceMobile = parsePhone("+33612345678");
  assert.equal(franceMobile.country, "France");
  assert.equal(franceMobile.lineType, "Mobile / Cellular");
  assert.ok(franceMobile.carrier.includes("Orange"));
});

test("Phone Intelligence - Generates High-Precision OSINT Search Dorks", () => {
  const parsed = parsePhone("+14155550123");
  const dorks = generatePhoneDorks(parsed);

  assert.ok(Array.isArray(dorks), "Must return array of dorks");
  assert.ok(dorks.length >= 4, "Must generate at least 4 targeted search dorks");
  assert.ok(dorks.some(d => d.query.includes("pastebin.com")), "Must include pastebin leak dork");
  assert.ok(dorks.some(d => d.query.includes("facebook.com")), "Must include social network dork");
  assert.ok(dorks.some(d => d.query.includes("filetype:pdf")), "Must include document leak dork");
});

test("Phone Intelligence - Full checkPhone Pipeline discovers 6 intelligence vectors", async () => {
  const results = [];
  const checked = [];

  await checkPhone(
    "+919810123456",
    async (res) => { results.push(res); },
    (p) => { checked.push(p); },
    { deepRea: false }
  );

  assert.equal(results.length, 6, "Must emit 6 comprehensive phone intelligence footprints");
  assert.equal(checked.length, 6, "Must track progress across 6 platforms");

  const telecom = results.find(r => r.platform === "Telecom Registry");
  assert.ok(telecom, "Must have Telecom Registry result");
  assert.equal(telecom.extras.carrier, "Bharti Airtel");
  assert.equal(telecom.extras.region, "Delhi NCR");
  assert.equal(telecom.extras.timezone, "Asia/Kolkata");

  const whatsapp = results.find(r => r.platform === "WhatsApp");
  assert.ok(whatsapp, "Must have WhatsApp result");
  assert.equal(whatsapp.website, "https://wa.me/919810123456");

  const telegram = results.find(r => r.platform === "Telegram Contact");
  assert.ok(telegram, "Must have Telegram result");
  assert.equal(telegram.website, "https://t.me/+919810123456");

  const truecaller = results.find(r => r.platform === "Truecaller Search");
  assert.ok(truecaller, "Must have Truecaller result");
  assert.ok(truecaller.website.includes("truecaller.com/search/in/9810123456"));

  const dorks = results.find(r => r.platform === "OSINT Search Dorks");
  assert.ok(dorks, "Must have OSINT Search Dorks result");
  assert.ok(dorks.extras.dorks.length >= 4);
});

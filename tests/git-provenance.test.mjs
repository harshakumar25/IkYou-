import test from "node:test";
import assert from "node:assert/strict";
import { computeSshFingerprint, extractGitProvenance } from "../src/engine/git-provenance.mjs";

test("SSH Key Fingerprint computation generates standard OpenSSH SHA256 base64 digest", () => {
  const sampleKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDBhFcRrANQ7YOj7OtxCH0iAgbnHof9iuWT/+ICFTqmQ harsh@macbook";
  const fp = computeSshFingerprint(sampleKey);
  assert.ok(fp.startsWith("SHA256:"));
  assert.ok(fp.length > 20);
});

test("Git Provenance extractor extracts public SSH keys and commits from active profile", async () => {
  const prov = await extractGitProvenance("harshakumar25", { timeoutMs: 6000 });
  assert.equal(prov.username, "harshakumar25");

  // Verify public SSH key was captured
  assert.ok(prov.sshKeys.length >= 1, "Must capture at least 1 SSH key for harshakumar25");
  assert.equal(prov.sshKeys[0].type, "ssh-ed25519");
  assert.ok(prov.sshKeys[0].fingerprint.startsWith("SHA256:"));

  // Verify commit email was recovered from public patch
  assert.ok(prov.commitEmails.includes("jhah1225@gmail.com"), "Must recover commit author email 'jhah1225@gmail.com'");

  // Verify timezone offset was extracted
  assert.ok(prov.timezone !== null, "Must extract timezone");
  assert.equal(prov.timezone.rawOffset, "+0530", "Must detect IST (+0530)");
  assert.ok(prov.timezone.name.includes("India Standard Time"));

  // Verify pivot leads were generated for Dig engine
  const leadUsernames = prov.pivotLeads.map(l => l.username);
  assert.ok(leadUsernames.includes("jhah1225@gmail.com"));
  assert.ok(leadUsernames.includes("jhah1225"));
});

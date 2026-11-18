import test from "node:test";
import assert from "node:assert/strict";
import { calculateHammingDistance, compareAvatarFingerprints } from "../src/engine/avatar-hasher.mjs";

test("Hamming distance calculator correctly measures bit divergence between perceptual hashes", () => {
  const hashA = "ffff0000ffff0000";
  const hashB = "ffff0000ffff0000"; // identical
  const hashC = "ffff0000ffff0001"; // 1 bit different in last nibble (0 vs 1)
  const hashD = "0000ffff0000ffff"; // completely inverted

  assert.equal(calculateHammingDistance(hashA, hashB), 0);
  assert.equal(calculateHammingDistance(hashA, hashC), 1);
  assert.equal(calculateHammingDistance(hashA, hashD), 64);
});

test("Avatar comparator accurately matches exact and perceptual profile pictures", () => {
  const fpA = {
    avatarUrl: "https://example.com/pfp1.png",
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    md5: "d41d8cd98f00b204e9800998ecf8427e",
    perceptualHash: "a1b2c3d4e5f60718"
  };

  const fpExact = {
    avatarUrl: "https://another.com/avatar.jpg",
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    md5: "d41d8cd98f00b204e9800998ecf8427e",
    perceptualHash: "a1b2c3d4e5f60718"
  };

  const exactMatch = compareAvatarFingerprints(fpA, fpExact);
  assert.equal(exactMatch.match, true);
  assert.equal(exactMatch.similarity, 1.0);
  assert.ok(exactMatch.reason.includes("Cryptographically identical"));

  const fpNear = {
    avatarUrl: "https://third.com/pfp.webp",
    sha256: "different_sha256",
    md5: "different_md5",
    perceptualHash: "a1b2c3d4e5f60719" // 1 bit difference
  };

  const nearMatch = compareAvatarFingerprints(fpA, fpNear);
  assert.equal(nearMatch.match, true);
  assert.ok(nearMatch.similarity >= 0.95);
  assert.ok(nearMatch.reason.includes("High perceptual visual match"));
});

// Two things are pinned here: that the identity detector works, and that every
// tracked file at HEAD is clean under it.
//
// The order matters. A leak sweep that has never been shown to fire is a green
// light wired to nothing, so the control case comes first in this file and
// again inside every scanIdentity() call. Nothing in here trusts a `hits: []`
// that the scanner did not earn.
//
// The generated-bundle half of the sweep lives in server/pipeline/pipeline.test.mjs,
// beside the code that already knows how to produce and walk a bundle.

import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  identityHits,
  scanIdentity,
  selfTest,
  describeHits,
  fingerprint,
  CONTROL_TOKEN,
  CONTROL_DIGEST,
  NIL_UUID,
  VacuousScanError,
} from "./identity.mjs";
import { MACHINE_PATH } from "./repo-path.mjs";

const REPO = fileURLToPath(new URL("../../", import.meta.url));

// --- the control: the scanner proves itself before anything else ------------

test("the control token is detected — the proof every clean verdict rests on", () => {
  const hits = identityHits(`prior run by ${CONTROL_TOKEN}, replayed`);
  const known = hits.filter((h) => h.kind === "known");
  assert.equal(known.length, 1, `the control was not detected: ${JSON.stringify(hits)}`);
  assert.equal(known[0].digest, CONTROL_DIGEST);
  assert.match(known[0].why, /CONTROL/);
  // Not a private shortcut: the control is matched by the same fingerprint map,
  // through the same regex, as a real identifier.
  assert.equal(fingerprint(CONTROL_TOKEN.toUpperCase()), CONTROL_DIGEST, "normalisation is part of the path under test");
});

test("the self-test probes both rules, so neither can die behind the other", () => {
  assert.doesNotThrow(selfTest);
  // Measured, and the reason there are two probes: with a single probe shaped
  // `{"user_id": "<control>"}`, deleting the control from the fingerprint map
  // still produced a hit — from the OTHER rule — carrying the same digest, and
  // the scan pronounced itself healthy over a corpus it could no longer read
  // properly. The bare-prose probe is the one that cannot be answered by shape.
  assert.equal(identityHits(`prior run by ${CONTROL_TOKEN}, replayed`).length, 1);
  assert.equal(identityHits(`prior run by ${CONTROL_TOKEN}, replayed`)[0].kind, "known");
});

test("this file's own control literal never appears whole in a tracked file", () => {
  // The token is assembled from pieces in identity.mjs and interpolated here.
  // If either file ever spelled it out, the sweep below would flag its own
  // scaffolding and the next person to hit that would delete the guard.
  for (const f of ["server/lib/identity.mjs", "server/lib/identity.test.mjs"])
    assert.ok(
      !readFileSync(join(REPO, f), "utf8").includes(CONTROL_TOKEN),
      `${f} spells out the control token — the sweep will flag itself`,
    );
});

// --- fail closed, never vacuous ---------------------------------------------

test("a scan of nothing refuses to report clean", () => {
  assert.throws(() => scanIdentity([]), VacuousScanError);
  assert.throws(() => scanIdentity([{ name: "a", text: "" }, { name: "b", text: null }]), VacuousScanError);
  // and a corpus with content does return, with the control recorded in the verdict
  const v = scanIdentity([{ name: "a", text: "nothing to see" }]);
  assert.deepEqual(v.hits, []);
  assert.equal(v.entries, 1);
  assert.equal(v.controlDigest, CONTROL_DIGEST);
  assert.ok(v.bytes > 0);
});

// --- the shape rule: the half that covers identifiers nobody has seen yet ----

test("an account uuid nobody has fingerprinted is still caught, by the field it sits in", () => {
  // A fixture captured tomorrow from some other Zoo account. Its digest is
  // unknown, so only the shape rule can see it.
  const stranger = "7c9f2a41-3b8e-4d55-9a12-6ef0c3b7d284";
  for (const field of ["user_id", "userId", "org_id", "account_id", "customer_id", "billing_id", "owner_id"]) {
    const hits = identityHits(`{"${field}": "${stranger}", "mass": 13.07}`);
    assert.equal(hits.length, 1, `"${field}" was not treated as account identity`);
    assert.equal(hits[0].kind, "account-field");
    // The failure message locates the leak without reprinting it: a CI log is
    // one more place the identifier would then live.
    assert.ok(hits[0].hint.length < stranger.length, `the hint republished the identifier: ${hits[0].hint}`);
    assert.ok(stranger.startsWith(hits[0].hint.slice(0, 8)), "the hint must still be greppable");
  }
});

test("job, run and metering handles are artifact ids, not people — no false alarm", () => {
  // Every one of these is a real shape this repo carries in tracked files. If
  // the detector fired on them it would be switched off within a day.
  for (const clean of [
    '{"id": "848cc603-623b-4620-acf8-75d5aea15f10", "status": "completed"}',
    '{"request_id": "7708aacc-f18b-4794-b67d-8e980bae63f6"}',
    '{"session_data":{"api_call_id":"3b1f0a52-9c1e-4f7a-8d2b-5e6c7a8b9c0d"}}',
    '{"conversation_id":{"conversation_id":"9d8c7b6a-5f4e-4d3c-b2a1-0f9e8d7c6b5a"}}',
    '{"textToCadId": "86102d0e-ccbf-40bd-a60e-3bc79e38cfd2"}',
    '{"requester": "shop-floor@example.com"}',
    "email makeathon@zoo.dev for top-offs",
    "job 4cf9b809-15ca-4287-8547-d09373605a78 parked at WAITING_FOR_HUMAN_REVIEW",
  ])
    assert.deepEqual(identityHits(clean), [], `the detector cried wolf on: ${clean}`);
});

test("the nil placeholder is the scrub marker, not a leak", () => {
  assert.deepEqual(identityHits(`{"user_id": "${NIL_UUID}"}`), []);
  // and it is what the two replay fixtures actually carry now
  for (const f of ["samples/plain-plate/validation.json", "samples/plain-plate-stl/validation.json"]) {
    const fixture = JSON.parse(readFileSync(join(REPO, f), "utf8"));
    assert.equal(fixture.user_id, NIL_UUID, `${f} lost the synthetic placeholder`);
    assert.equal(typeof fixture.user_id, "string", `${f} changed the field's type`);
    assert.equal(fixture.status, "completed", `${f} lost the rest of the replayed record`);
  }
});

// --- why this is a second detector and not a case in the first one ----------

test("the path detector is blind to account identity, which is why this file exists", () => {
  // Interpolated, not spelled out: a literal `"user_id": "<uuid>"` pair in a
  // tracked file is precisely what the shape rule flags, so writing the fixture
  // out longhand would make the sweep below fail on its own test data.
  const invented = "a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
  const leak = `"user_id": "${invented}"`;
  assert.doesNotMatch(leak, MACHINE_PATH, "if MACHINE_PATH caught this, one detector would do");
  assert.equal(identityHits(leak).length, 1);
});

// --- the sweep --------------------------------------------------------------

// git ls-files IS the definition of "tracked at HEAD", which is exactly the
// claim this test makes. README's setup step is `git clone`, so git is present
// on the supported path; if it is not, the claim cannot be checked and the
// honest outcome is a loud failure rather than a green light over an unknown
// corpus.
function trackedFiles() {
  const r = spawnSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(
    r.status,
    0,
    `git ls-files failed (${r.status}): the tracked-file sweep cannot verify what it cannot list.\n${r.stderr ?? ""}`,
  );
  return r.stdout.split("\0").filter(Boolean);
}

test("no tracked file at HEAD carries the operator's account identity", () => {
  const files = trackedFiles();
  // Read as latin1 so binaries (stl, png, gltf, pdf) are scanned as bytes
  // rather than skipped — a scan that silently drops the unreadable half of
  // the repo is the vacuous verdict this guard exists to refuse.
  const verdict = scanIdentity(files.map((f) => ({ name: f, text: readFileSync(join(REPO, f), "latin1") })));

  assert.deepEqual(verdict.hits, [], `tracked files carry account identity:\n${describeHits(verdict.hits)}`);

  // The corpus has to be shown to be the real one. A sweep over three files
  // reads identical to a sweep over all of them.
  for (const required of [
    "samples/plain-plate/validation.json",
    "samples/plain-plate-stl/validation.json",
    "server/pipeline/backends.mjs",
    "server/lib/identity.mjs",
    "package.json",
  ])
    assert.ok(files.includes(required), `the sweep never reached ${required}`);
  assert.ok(files.length >= 200, `expected the whole repo, listed only ${files.length} files`);
  assert.ok(verdict.bytes > 1_000_000, `expected the whole repo's bytes, read only ${verdict.bytes}`);
});

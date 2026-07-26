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
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  identityHits,
  scanIdentity,
  selfTest,
  describeHits,
  fingerprint,
  hintFor,
  CONTROL_TOKEN,
  CONTROL_DIGEST,
  NIL_UUID,
  VacuousScanError,
} from "./identity.mjs";
import { MACHINE_PATH } from "./repo-path.mjs";
import { trackedFiles, readTracked } from "./leak-audit.mjs";

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

test("the shape rule reads the key, not the punctuation around it", () => {
  // Measured against the first version of this rule, which anchored on the
  // opening quote: of these ten serialisations it caught two. Each one is a
  // shape this repo can actually emit — escaped JSON is what a captured record
  // looks like once it has been stringified into a ledger reason or a manifest
  // warning, and the unquoted form is what a field note or a YAML snippet uses.
  const stranger = "7c9f2a41-3b8e-4d55-9a12-6ef0c3b7d284";
  const forms = {
    json: `{"user_id": "${stranger}"}`,
    "escaped json": JSON.stringify(JSON.stringify({ user_id: stranger })),
    "double-escaped (pdf content stream)": `{\\\\"account_id\\\\":\\\\"${stranger}\\\\"}`,
    "unquoted key": `user_id: ${stranger}`,
    yaml: `user_id: "${stranger}"`,
    "single-quoted js": `{'user_id': '${stranger}'}`,
    hyphenated: `{"org-id": "${stranger}"}`,
    "dotted path": `user.id = ${stranger}`,
    "nested object": `{"user":{"id":"${stranger}"}}`,
    prefixed: `{"end_user_id": "${stranger}"}`,
    "vendor-prefixed": `{"zoo_user_id": "${stranger}"}`,
    "bare account word": `{"owner": "${stranger}"}`,
  };
  for (const [label, text] of Object.entries(forms)) {
    const hits = identityHits(text).filter((h) => h.kind === "account-field");
    assert.equal(hits.length, 1, `the shape rule is blind to ${label}: ${text}`);
    assert.equal(hits[0].digest, fingerprint(stranger));
  }
});

test("an email hint withholds the address; a uuid hint keeps its grep handle", () => {
  // The two token types get different treatment on purpose. 8 hex of a uuid
  // locates it and identifies nobody; 8 characters of an email is most of the
  // local part, and a red CI log on a public repo is one more place it lives.
  const stranger = "7c9f2a41-3b8e-4d55-9a12-6ef0c3b7d284";
  const uuidHit = identityHits(`{"user_id": "${stranger}"}`)[0];
  assert.equal(uuidHit.hint, "7c9f2a41…");
  assert.ok(stranger.startsWith(uuidHit.hint.slice(0, 8)), "the uuid hint must stay greppable");

  // The same function the two email entries in KNOWN would render through.
  const address = "not.a.real.person@example.invalid";
  const line = describeHits([
    { where: "some/file.json", why: "an operator email address", hint: hintFor(address), digest: fingerprint(address) },
  ]);
  assert.ok(!line.includes("not.a.real"), `the hint republished the local part: ${line}`);
  assert.ok(!line.includes(address), `the hint republished the address: ${line}`);
  assert.match(line, /withheld/);
  // Still locatable: the file, and the digest that says which known identifier fired.
  assert.match(line, /some\/file\.json/, "the failure must still say which file to look in");
  assert.ok(line.includes(fingerprint(address).slice(0, 12)), "the digest prefix must survive");
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
    '{"t2cId": "289cec14-f654-4afe-92dc-734c63e52896"}',
    // Walking backwards from a uuid is what makes the shape rule see through
    // escaping, and prose is the cost it has to not pay. A comma, a period or a
    // newline ends the walk, so an account word loose in a sentence cannot
    // reach forward and claim the next uuid it happens to precede.
    '{"note": "belongs to no owner", "id": "848cc603-623b-4620-acf8-75d5aea15f10"}',
    "belongs to no owner. Job 848cc603-623b-4620-acf8-75d5aea15f10 is unassigned",
    "the user who owns this job 848cc603-623b-4620-acf8-75d5aea15f10 was notified",
    // The account word has to BE the key, not merely start it.
    '{"org_name": "848cc603-623b-4620-acf8-75d5aea15f10"}',
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

// The corpus builder is IMPORTED, not restated. `trackedFiles` and
// `readTracked` used to live here as private copies; they now live in
// server/lib/leak-audit.mjs, which is the script that runs this same sweep
// outside the test runner. Two copies of "what the corpus is" is how one of
// them quietly stops covering a directory the other still covers — the exact
// drift the path detector already recorded across three suites.
//
// What that shared builder guarantees, and why: `git ls-files` lists the paths
// git TRACKS — it reads the index, not HEAD's trees — and the contents scanned
// are the ones on disk right now. So this sweep checks the working-tree
// contents of every tracked path. That is neither "HEAD" nor a plain directory
// walk, and the difference is deliberate in both directions.
//
// Against HEAD: a leak that has been written but not yet committed is still
// caught, which is the only version of this guard that can stop a bad commit
// rather than report one. It has already earned that — a `git checkout --` of
// an unstaged fixture silently restored the real uuid during development, and
// this test went red on the next run.
//
// Against a directory walk: gitignored files are excluded, so a stale local
// demo bundle under server/pipeline/data/ cannot turn the suite red for
// something that will never reach a judge.
//
// README's setup step is `git clone`, so git is present on the supported path;
// if it is not, the claim cannot be checked and the honest outcome is a loud
// failure rather than a green light over an unknown corpus.

test("no tracked file carries the operator's account identity", () => {
  const files = trackedFiles();
  const verdict = scanIdentity(files.map((f) => ({ name: f, text: readTracked(f) })));

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

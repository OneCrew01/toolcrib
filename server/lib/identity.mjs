// The second leak detector, and deliberately not the first one.
//
// server/lib/repo-path.mjs knows what a machine-rooted PATH looks like. It is
// blind to account identity by construction: a bare account uuid has no drive
// letter, no home root, no separators — nothing MACHINE_PATH matches. That
// blindness was measured, not assumed. The operator's real Zoo account uuid sat
// in samples/plain-plate/validation.json and samples/plain-plate-stl/
// validation.json, the replay backend read both fixtures into every generated
// bundle (logs/apiRun.json, via replayedRecords), and every path scan in the
// repo stayed green over all of it.
//
// The HTTP channel is the FILES route, not the detail payload — measured, with
// a synthetic uuid planted in samples/plain-plate-stl/validation.json and the
// real API driven end to end:
//
//   GET /api/jobs/:id                        7,929 bytes, 0 occurrences.
//                                            Keys: job, ledger, ledgerVerified,
//                                            gates, manifest, warnings — none of
//                                            which carries replayedRecords.
//   GET /api/jobs/:id/files/logs/apiRun.json 200, 1,520 bytes, 1 occurrence.
//
// and manifest.files (which the detail payload DOES carry) lists
// "logs/apiRun.json", so the route is one click from the console. server/api/
// server.mjs:288 serveFile streams any file inside the bundle dir verbatim: no
// scrub, no filter. An earlier version of this comment named the detail payload
// instead, inherited from the task brief and never checked. Both are pinned by
// tests in server/api/api.test.mjs now, so the correction cannot rot back.
//
// This file is the detector for the other kind of identity: WHO ran it, not
// WHERE. Two rules, because there are two ways an account handle arrives.
//
//   known      — an exact identifier we already know belongs to the operator,
//                matched by SHA-256 fingerprint (see below).
//   shape      — any uuid sitting in a field whose NAME means "account":
//                user_id, org_id, account_id, customer_id, billing_id,
//                owner_id. This is the forward-looking half. A fixture captured
//                tomorrow from a different Zoo account has a uuid nobody has
//                fingerprinted, and the fingerprint rule would wave it through.
//
// --- why fingerprints and not literals ------------------------------------
//
// A detector that spells out the identifier it hunts for has published it. The
// whole point is that no tracked file at HEAD contains the operator's account
// uuid — and this file is tracked, and is itself inside the corpus the sweep
// scans. So what is stored here is a one-way SHA-256 commitment to each
// identifier, never the identifier. A uuid carries ~122 bits of entropy, so the
// digest is a check, not a copy: it can confirm a candidate, and it cannot be
// run backwards to produce one.
//
// Same reason the control token below is assembled from pieces rather than
// written out: a literal here would flag its own definition and turn the sweep
// permanently red, which is how a guard gets deleted.
//
// --- what this file deliberately does NOT do -------------------------------
//
// It does not hunt for the operator's OS username as a bare substring. That
// name reaches a judge through exactly one channel — a filesystem path — and
// that channel already has a dedicated, mutation-tested detector next door.
// Meanwhile LICENSE names the author on purpose (MIT requires a copyright
// holder), so a substring pass would need a carve-out for the one file whose
// job is to carry the name, and a carve-out is a hole. Authorship credit is not
// an account leak.

import { createHash } from "node:crypto";

/** Normalise then commit: identifiers are compared case- and space-insensitively. */
export const fingerprint = (token) =>
  createHash("sha256").update(String(token).trim().toLowerCase(), "utf8").digest("hex");

// The control token. Assembled, never spelled: this file is scanned by the very
// sweep it powers. Its fingerprint is in the map below alongside the real ones,
// so the control travels the exact code path a real identifier would — a
// control that used a private shortcut would prove nothing about the path that
// matters.
export const CONTROL_TOKEN = ["0badc0de", "0bad", "4bad", "8bad", "0badc0de0bad"].join("-");

// --- what is fingerprinted, and what deliberately is not -------------------
//
// A fingerprint cannot be run backwards, but it CAN confirm a guess: anyone who
// already suspects a value can hash it and check. That is a fair trade for an
// identifier this repo's history actually carries — the guard is worth more than
// the oracle. It is a bad trade for one the history does not carry, because then
// this line is the only thing in the repo saying the value exists at all.
//
// One entry was removed on 2026-07-28 for exactly that reason: a second operator
// address, on a domain that appears nowhere in this repo or its history. Nothing
// leaked; the fingerprint was guarding a value that had never been anywhere near
// the corpus, and publishing it bought a confirmation oracle for no coverage.
// The entries below all commit to identifiers the history really holds.

/** fingerprint -> what it is. Digests only; no identifier is stored here. */
const KNOWN = new Map([
  ["330d5638ff98a18545e141985f270c924663c7e38b4d2d581598916cbd38b537", "the operator's Zoo account user_id"],
  ["12122db1f7d1d21624ea29170847cfc9738bd880aac4f9fcf9e4056533816637", "an operator email address"],
  [fingerprint(CONTROL_TOKEN), "CONTROL — a synthetic token that is nobody's account"],
]);

/** The fingerprint the self-test looks for. Exported so the proof is explicit. */
export const CONTROL_DIGEST = fingerprint(CONTROL_TOKEN);

const UUID = String.raw`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}`;
const EMAIL = String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`;
// Non-global by construction at the module level: /g regexes carry lastIndex
// between calls, so each scan builds its own.
const tokenRe = () => new RegExp(`${UUID}|${EMAIL}`, "g");
const uuidRe = () => new RegExp(UUID, "g");

/**
 * Enough of an identifier to LOCATE the leak, never enough to republish it —
 * a failing CI log on a public repo is one more place the value would live.
 *
 * The rule is not uniform, because the two token types are not. A uuid's first
 * 8 hex characters are 1/4 of a 122-bit random value: `git grep <hint>` finds
 * it, and the prefix alone identifies nobody. An email's first 8 characters are
 * most of the local part — the identifying half — so an address is withheld
 * entirely. Nothing is lost by that: `where` names the file and the digest
 * pins which known identifier fired, and
 * `git grep -nE '[A-Za-z0-9._%+-]+@' <file>` closes the last step.
 */
export const hintFor = (v) => (v.includes("@") ? "<an email address — withheld>" : `${v.slice(0, 8)}…`);

// RFC 9562's Nil UUID: "no such entity". This is the placeholder the two replay
// fixtures now carry in place of the real account, so the shape rule must not
// fire on it — an all-zero uuid is the signal that a value was scrubbed.
export const NIL_UUID = "00000000-0000-0000-0000-000000000000";

// A field name that means "this identifies an account or a person". The list is
// deliberately short, and deliberately excludes the id fields this codebase
// uses constantly — id, request_id, conversation_id, api_call_id, textToCadId,
// t2cId, jobId. Those name a job, a run, an HTTP request or one billed API
// turn: artifact handles that are meaningless outside this repo's own records.
// api_call_id is the one worth stating out loud, because it is described as a
// "metering/billing handle" (FN-028) and metering sounds like billing identity.
// It is not: it identifies one Zookeeper turn, and a new one is minted per turn.
const ACCOUNT_KEY = /(user|org|organisation|organization|account|customer|billing|owner)(id|uuid|guid)?$/;

// This rule does NOT match a key/value pair as written. It walks BACKWARDS from
// each uuid over the characters that can legally sit between a field name and
// its value, then strips the punctuation and asks what the key was.
//
// The reason is measured. The first version anchored on the opening quote —
// /"(user|org|...)_?id"\s*:\s*"([^"]*)"/ — and of ten serialisations probed it
// caught two. It missed escaped JSON (\"user_id\":\"…\", the shape a ledger
// reason or a manifest warning takes when a captured record is stringified into
// an error message), the unquoted key a field note or YAML snippet uses, the
// single-quoted JS form, hyphenated "org-id", nested {"user":{"id":…}}, and
// every prefixed variant such as "end_user_id" or "zoo_user_id". The old
// comment named ONE of those gaps ("end_user_id") and called a named gap one
// edit to close; it was six gaps, and the escaped-JSON one is the same lesson
// the path scan next door already learned the hard way (a backslash-escaped
// leak reads clean), which is why it normalises before scanning.
//
// Walking back collapses all six into one rule, because after the punctuation
// is stripped every one of those forms produces the same trail: "userid".
//
// The set below is what may sit between name and value: the characters a key is
// made of, the quotes of any of the three serialisations, the colon or equals
// that binds a pair, the brace of a nested object, the backslash of a string
// that was itself stringified, and whitespace. A comma or a newline is NOT in
// it, and that is what keeps prose out: `"note": "no owner", "id": "<uuid>"`
// stops the walk at the comma and reads "id", clean.
const KEY_TRAIL = /[0-9A-Za-z_.\-"'\\:= \t{]*$/;

// 48 characters is enough for the longest real nesting here
// (`{"session_data":{"api_call_id":"` is 32) and short enough that a run-on
// sentence cannot reach back to an unrelated word.
const TRAIL_WINDOW = 48;

/** The key a uuid at `index` is the value of, punctuation stripped — "" if none. */
function keyBefore(s, index) {
  const before = s.slice(Math.max(0, index - TRAIL_WINDOW), index);
  return (before.match(KEY_TRAIL)?.[0] ?? "").replace(/[^0-9A-Za-z]/g, "").toLowerCase();
}

/**
 * Every account identifier this text still carries.
 * @param {unknown} text  file contents, a payload, a ledger reason — anything
 * @returns {Array<{kind: "known"|"account-field", digest: string, hint: string, why: string}>}
 */
export function identityHits(text) {
  const s = typeof text === "string" ? text : String(text ?? "");
  const hits = [];

  for (const [token] of s.matchAll(tokenRe())) {
    const digest = fingerprint(token);
    const why = KNOWN.get(digest);
    if (why) hits.push({ kind: "known", digest, hint: hintFor(token), why });
  }

  for (const m of s.matchAll(uuidRe())) {
    if (m[0].toLowerCase() === NIL_UUID) continue; // the deliberate placeholder
    const key = keyBefore(s, m.index);
    if (!ACCOUNT_KEY.test(key)) continue;
    hits.push({
      kind: "account-field",
      digest: fingerprint(m[0]),
      hint: hintFor(m[0]),
      why: `a field reading "…${key}" carries a live-looking account uuid`,
    });
  }
  return hits;
}

/** Thrown instead of returning a verdict nobody earned. */
export class VacuousScanError extends Error {
  constructor(message) {
    super(message);
    this.name = "VacuousScanError";
  }
}

// A uuid for the shape probe. Not fingerprinted, so the ONLY rule that can see
// it is the field-name rule — which is the point: one probe per rule, or a
// mutation that kills one rule hides behind the other still firing. Measured:
// an earlier control asserted only "some hit carries the control digest", and
// deleting the control from KNOWN left the scan reporting itself healthy,
// because the shape rule had matched the same token and computed the same
// digest from it.
const SHAPE_PROBE = "5d3e9a17-24c8-4b6f-9e01-7ac35b8d0f42";

/**
 * Prove the scanner can still see, on both rules, before it is believed.
 * Three probes: one per detection rule, plus a negative so "flags everything"
 * cannot masquerade as "works".
 * @throws {VacuousScanError} if any probe comes back wrong
 */
export function selfTest() {
  const refuse = (why) =>
    new VacuousScanError(`identity scan: ${why} — the scanner is broken and no verdict from it is trustworthy`);

  const known = identityHits(`prior run by ${CONTROL_TOKEN}, replayed`).filter((h) => h.kind === "known");
  if (known.length !== 1 || known[0].digest !== CONTROL_DIGEST)
    throw refuse("the control token was not matched by fingerprint");

  const shaped = identityHits(`{"user_id": "${SHAPE_PROBE}"}`).filter((h) => h.kind === "account-field");
  if (shaped.length !== 1) throw refuse("an account uuid in a user_id field was not matched by shape");

  if (identityHits(`{"user_id": "${NIL_UUID}"} run by nobody`).length !== 0)
    throw refuse("the negative control fired, so a clean corpus is indistinguishable from a dirty one");
}

/**
 * Scan a corpus and return a verdict — or refuse to return one.
 *
 * A leak scanner's characteristic failure is not a false negative on a clever
 * input; it is passing over nothing at all and reporting green. A glob that
 * matched no files, a walk of a directory that was never created, a filter that
 * excluded everything: each of those reads exactly like "clean". So this
 * function fails closed three ways before any caller sees `hits: []`:
 *
 *   empty corpus   -> throw. Zero entries is not zero leaks.
 *   zero bytes     -> throw. Entries that all read empty are the same lie.
 *   control missed -> throw. Every call runs selfTest() first, over the same
 *                     regexes and the same digest map the corpus is about to
 *                     meet. If the scanner is broken, the scan says so instead
 *                     of reporting the corpus clean.
 *
 * @param {Iterable<{name: string, text: unknown}>} entries
 * @returns {{entries: number, bytes: number, controlDigest: string, hits: Array}}
 */
export function scanIdentity(entries) {
  const list = [...entries];
  if (list.length === 0)
    throw new VacuousScanError("identity scan: empty corpus — a scan of nothing is not a clean verdict");

  selfTest();

  let bytes = 0;
  const hits = [];
  for (const { name, text } of list) {
    const s = typeof text === "string" ? text : String(text ?? "");
    bytes += s.length;
    for (const h of identityHits(s)) hits.push({ ...h, where: name });
  }
  if (bytes === 0)
    throw new VacuousScanError(`identity scan: ${list.length} entries and not one byte of content — nothing was read`);

  return { entries: list.length, bytes, controlDigest: CONTROL_DIGEST, hits };
}

/** One line per hit, for an assertion message that says where to look. */
export const describeHits = (hits) =>
  hits.map((h) => `${h.where ?? "<text>"}: ${h.why} (${h.hint}, sha256 ${h.digest.slice(0, 12)}…)`).join("\n");

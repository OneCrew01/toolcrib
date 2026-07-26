// The second leak detector, and deliberately not the first one.
//
// server/lib/repo-path.mjs knows what a machine-rooted PATH looks like. It is
// blind to account identity by construction: a bare account uuid has no drive
// letter, no home root, no separators — nothing MACHINE_PATH matches. That
// blindness was measured, not assumed. The operator's real Zoo account uuid sat
// in samples/plain-plate/validation.json and samples/plain-plate-stl/
// validation.json, the replay backend read both fixtures into every generated
// bundle (logs/apiRun.json, via replayedRecords) and into the API's job-detail
// payload, and every path scan in the repo stayed green over all of it.
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

/** fingerprint -> what it is. Digests only; no identifier is stored here. */
const KNOWN = new Map([
  ["330d5638ff98a18545e141985f270c924663c7e38b4d2d581598916cbd38b537", "the operator's Zoo account user_id"],
  ["12122db1f7d1d21624ea29170847cfc9738bd880aac4f9fcf9e4056533816637", "an operator email address"],
  ["b7f39c11d2730206e2577bf4d37227e7956171fd13c869432856c4ddd3b26fa8", "an operator email address"],
  [fingerprint(CONTROL_TOKEN), "CONTROL — a synthetic token that is nobody's account"],
]);

/** The fingerprint the self-test looks for. Exported so the proof is explicit. */
export const CONTROL_DIGEST = fingerprint(CONTROL_TOKEN);

const UUID = String.raw`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}`;
const EMAIL = String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`;
// Non-global by construction at the module level: /g regexes carry lastIndex
// between calls, so each scan builds its own.
const tokenRe = () => new RegExp(`${UUID}|${EMAIL}`, "g");
const IS_UUID = new RegExp(`^${UUID}$`);

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
//
// The anchor is the opening quote, so this matches "user_id"/"userId" and not
// "end_user_id". Stated rather than hidden — a nested variant is a gap, and a
// gap named in one place is one edit to close.
const accountFieldRe = () =>
  /"(user|org|organization|account|customer|billing|owner)_?id"\s*:\s*"([^"]*)"/gi;

/**
 * Every account identifier this text still carries.
 * @param {unknown} text  file contents, a payload, a ledger reason — anything
 * @returns {Array<{kind: "known"|"account-field", digest: string, hint: string, why: string}>}
 *          `hint` is a truncated prefix, never the whole identifier: a failing
 *          CI log must locate the leak (`git grep <hint>`) without republishing
 *          the value the failure exists to keep private.
 */
export function identityHits(text) {
  const s = typeof text === "string" ? text : String(text ?? "");
  const hits = [];
  const hint = (v) => `${v.slice(0, 8)}…`;

  for (const [token] of s.matchAll(tokenRe())) {
    const digest = fingerprint(token);
    const why = KNOWN.get(digest);
    if (why) hits.push({ kind: "known", digest, hint: hint(token), why });
  }

  for (const [, field, value] of s.matchAll(accountFieldRe())) {
    if (!IS_UUID.test(value)) continue; // a non-uuid value is not an account handle
    if (value.toLowerCase() === NIL_UUID) continue; // the deliberate placeholder
    hits.push({
      kind: "account-field",
      digest: fingerprint(value),
      hint: hint(value),
      why: `"${field}_id" carries a live-looking account uuid`,
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

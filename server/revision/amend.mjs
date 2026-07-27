// Amendment proposals for flush-mount fit — the module that turns "I printed
// it, I put calipers on it, and the insert does not fit" into a PROPOSED
// amended request. The amendment is what makes a revision a revision rather
// than a counter-proposal: it is the parent request with the fit parameters
// changed and nothing else, plus the shown work for why.
//
// Pure and deterministic: no I/O, no network, no clock, no randomness. Same
// inputs, same object, every time. It does not touch the ledger, the state
// machine, the package or any API route — a caller decides what to do with the
// proposal it returns.
//
// ---------------------------------------------------------------------------
// THE PREMISE CHECK — read this before trusting the arithmetic
// ---------------------------------------------------------------------------
// The flush-mount-fit (FMF) table was read before this module was written, to
// find the row that authorises turning a measured deviation into a clearance.
// THERE IS NO SUCH ROW. What the table actually encodes:
//
//   FMF-001..006  per-side clearance BANDS for three fit classes (snug,
//                 sliding, loose) — fixed numbers, one row per band edge.
//   FMF-007/008   chamfer lead-in angle, and a minimum depth FORMULA.
//   FMF-009       insert dimension = opening − 2 × clearance per side.
//   FMF-010       explicitly states the opposite of what a compensation rule
//                 would say: "no separate numeric compensation is encoded —
//                 the clearance class absorbs the undersize only after coupon
//                 calibration on the target machine". Its value is 0.
//
// So the split this module ships is deliberate and is enforced by tests:
//
//   CITED     the clearance band. One encoded row, one rule id, one citation,
//             the table's own number passed through UNQUANTIZED so it stays
//             byte-identical to the row it came from.
//   COMPUTED  everything else. The process delta, the amended clearance and
//             the amended chamfer depth are OUR arithmetic. No row in the
//             reference authorises deriving a clearance from a caliper
//             reading; we do it anyway because it is the useful thing to do,
//             and we say so in the warnings rather than dressing it up.
//
// A midpoint is never cited. fitClearance() returns perSideNominalMm (0.225
// for the sliding class), and no row holds 0.225 — so this module never uses
// it as the band. Only an encoded band EDGE is ever labelled cited.
//
// ---------------------------------------------------------------------------
// THE MEASUREMENT CONTRACT — this is frozen at first use, so it is precise
// ---------------------------------------------------------------------------
// proposeAmendment takes { parentRequest, measurement, allowDraft }. The
// measurement is a plain object. Unknown keys are REJECTED, not ignored.
//
//   feature        "opening" | "insert"     which half of the pair went under
//                                           the calipers.
//   dimension      "width" | "height" | "diameter"   which dimension was read.
//                                           Recorded for provenance; v1 amends
//                                           the single per-side clearance,
//                                           which applies to both axes.
//   nominalMm      number  what the model says that dimension is. Finite,
//                          > 0, ≤ 1000.
//   measuredMm     number  what the calipers read. Finite, > 0, ≤ 1000.
//   fit            "interference" | "tight" | "loose" | "good"
//                          the seated fit the human observed. "good" is
//                          REJECTED: an amendment corrects a fit that did not
//                          work, and changing a fit the operator called good
//                          would be a counter-proposal, not a revision.
//   targetFitClass "snug" | "press" | "sliding" | "smooth-sliding" |
//                  "loose" | "service"      the fit the operator wanted. The
//                          FMF aliases are accepted; the canonical class is
//                          echoed back as fitClass. Note "loose" is both a
//                          fit outcome and a fit class — they are different
//                          fields and mean different things.
//   measuredBy     string  the named human who took the reading and who must
//                          accept the proposal. Non-empty.
//   instrument     string  OPTIONAL. e.g. "digital caliper, 0.01 mm".
//
// Absurd input is refused rather than amended: |measuredMm − nominalMm| must
// be no more than 2 mm AND no more than 10% of nominal. Past that it is not a
// process delta, it is the wrong part on the bench.
//
// ---------------------------------------------------------------------------
// THE ARITHMETIC
// ---------------------------------------------------------------------------
// An opening is an inner feature: printed small, it eats clearance. An insert
// is an outer feature: printed large, it eats clearance. Both reduce to one
// signed per-side number.
//
//   opening:  processDelta = (nominal − measured) / 2
//   insert:   processDelta = (measured − nominal) / 2
//
// Positive means the machine took clearance away; negative means it gave some
// back. Both directions are kept, because both happen.
//
//   amendedClearance = band + processDelta
//
// The band edge is chosen by the observed fit: a joint that interfered gets
// the roomy edge of the class it was aiming at (the MAX row), a joint that was
// sloppy gets the tight edge (the MIN row). That choice is ours too.
//
// QUANTIZATION: every millimetre value this module COMPUTES is rounded to 3
// decimal places (1 micron) — see MM_DECIMALS. 0.2 + 0.09 is
// 0.29000000000000004 in IEEE754 and nobody prints to the fourteenth decimal.
// The cited band is the one number NOT quantized: it is the table's, not ours,
// and rounding it would break the "cited means an encoded row holds exactly
// this number" invariant the tests check structurally.
//
// ---------------------------------------------------------------------------
// FAIL-CLOSED, ON BOTH LOOKUPS
// ---------------------------------------------------------------------------
// Every FMF row ships PENDING_OPERATOR. Composing an amendment consults TWO
// fail-closed lookups — fitClearance for the band and chamferFor for the
// lead-in — and allowDraft is threaded to BOTH. Without allowDraft this module
// throws UnverifiedRuleError. With it, the result carries the DRAFT watermark
// and the unverified-rule warning names every pending row it leaned on.
//
// Insert sizing (FMF-009) is deliberately NOT consulted: the generator sizes
// the insert from the opening and the clearance itself, so consulting it here
// would be a third gate on a number nobody reads.

import { validateGenerationRequest } from "../state/request.mjs";
import { DRAFT_WATERMARK } from "../reference/lookup.mjs";
import { PENDING_OPERATOR, VERIFIED } from "../reference/schema.mjs";
import { flushMountFit, fitClearance, chamferFor } from "../reference/tables/flush-mount-fit.mjs";

// --- the operator-flag wording ----------------------------------------------

/**
 * OPERATOR-FLAG ITEM. The public voice ruling is "aviation standard but not
 * grade. E for everyone." — we build to a published standard and we never
 * claim to have been graded against one. Plain English: the reader is a
 * stranger who owns a 3D printer.
 *
 * All three strings live here, in one place, so the operator can rewrite them
 * without reading the module. The tests assert MEANING (that a disclaimer
 * survives rule signing, that it names a human, that it does not claim
 * certification) against these constants rather than pinning the prose, so
 * editing the words below does not turn the suite red.
 *
 * {ruleIds} and {reviewer} are substituted at build time.
 */
export const OPERATOR_FLAG_WORDING = Object.freeze({
  /**
   * Present ONLY while a reference row this proposal leaned on is still
   * waiting for an operator signature. It correctly disappears when the rows
   * are signed.
   */
  unverifiedRule:
    "UNVERIFIED RULE: the reference rows behind this proposal ({ruleIds}) have not been " +
    "signed off by the operator yet. They are bench practice measured off printed fit " +
    "coupons, not a published number. Print a coupon pair and check it with calipers " +
    "before you lean on them.",

  /**
   * ALWAYS present. The reference gives a band and nothing else; turning a
   * caliper reading into a clearance is this tool's own reasoning.
   */
  derivationUncited:
    "OUR ARITHMETIC, NOT THE TABLE'S: the reference gives a clearance band and stops there. " +
    "Turning your caliper reading into a process delta, and adding that delta to the band, " +
    "is this tool's own reasoning — no row in the reference authorises it. The band is cited; " +
    "the correction is not.",

  /**
   * ALWAYS present, completely independent of rule-signing status. Signing the
   * FMF rows must never leave a dimensional correction standing unqualified.
   */
  amendmentDisclaimer:
    "PROPOSAL, NOT A CERTIFIED CORRECTION: this is a computed suggestion built from one " +
    "measurement. We build to a published standard; nothing here has been graded against " +
    "one. {reviewer} has to read this, agree with it, and accept it before any part is " +
    "printed from it.",
});

// --- the measurement contract, as data --------------------------------------

/** Decimal places every COMPUTED millimetre value is quantized to. */
export const MM_DECIMALS = 3;

export const MEASUREMENT_REQUIRED = Object.freeze([
  "feature",
  "dimension",
  "nominalMm",
  "measuredMm",
  "fit",
  "targetFitClass",
  "measuredBy",
]);
export const MEASUREMENT_OPTIONAL = Object.freeze(["instrument"]);

export const FEATURES = Object.freeze(["opening", "insert"]);
export const DIMENSIONS = Object.freeze(["width", "height", "diameter"]);
export const FIT_OUTCOMES = Object.freeze(["interference", "tight", "loose", "good"]);

/** Fit outcomes that mean "too tight" — these aim at the roomy band edge. */
const TOO_TIGHT = Object.freeze(new Set(["interference", "tight"]));

/** Absurd-input limits. Past these it is the wrong part, not a process delta. */
export const MAX_DIMENSION_MM = 1000;
export const MAX_DEVIATION_MM = 2;
export const MAX_DEVIATION_FRACTION = 0.1;

// --- small helpers ----------------------------------------------------------

const SCALE = 10 ** MM_DECIMALS;

/** Deliberate quantization to MM_DECIMALS, with -0 normalised to 0. */
export function quantizeMm(n) {
  const r = Math.round(n * SCALE) / SCALE;
  return Object.is(r, -0) ? 0 : r;
}

const mm = (n) => n.toFixed(MM_DECIMALS);
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function finiteInRange(v, name) {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new TypeError(`measurement.${name} must be a finite number, got ${JSON.stringify(v)}`);
  }
  if (v <= 0 || v > MAX_DIMENSION_MM) {
    throw new RangeError(`measurement.${name} must be > 0 and <= ${MAX_DIMENSION_MM} mm, got ${v}`);
  }
  return v;
}

function oneOf(v, allowed, name) {
  if (!allowed.includes(v)) {
    throw new RangeError(`measurement.${name} must be one of ${allowed.join(", ")}, got ${JSON.stringify(v)}`);
  }
  return v;
}

// --- measurement validation -------------------------------------------------

/**
 * Validate and normalise a measurement. Throws — this is a contract, and a
 * caliper reading nobody checked is exactly the input that must not reach the
 * arithmetic silently.
 *
 * @param {object} raw
 * @returns {{feature: string, dimension: string, nominalMm: number, measuredMm: number,
 *            fit: string, targetFitClass: string, measuredBy: string, instrument?: string}}
 */
export function validateMeasurement(raw) {
  if (!isPlainObject(raw)) throw new TypeError("measurement must be a plain object");

  const known = new Set([...MEASUREMENT_REQUIRED, ...MEASUREMENT_OPTIONAL]);
  const unknown = Object.keys(raw).filter((k) => !known.has(k));
  if (unknown.length > 0) {
    throw new RangeError(
      `measurement has unknown key(s): ${unknown.join(", ")}. ` +
        `Accepted: ${[...known].join(", ")}. A key this module does not read is a ` +
        `measurement the human thought they supplied and nobody used.`,
    );
  }
  const missing = MEASUREMENT_REQUIRED.filter((k) => raw[k] === undefined);
  if (missing.length > 0) throw new RangeError(`measurement is missing: ${missing.join(", ")}`);

  const feature = oneOf(raw.feature, FEATURES, "feature");
  const dimension = oneOf(raw.dimension, DIMENSIONS, "dimension");
  const fit = oneOf(raw.fit, FIT_OUTCOMES, "fit");
  if (fit === "good") {
    throw new RangeError(
      'measurement.fit "good" needs no amendment. An amendment corrects a fit that did not ' +
        "work; proposing a change to a fit the operator called good would be a counter-proposal, " +
        "not a revision.",
    );
  }

  const nominalMm = finiteInRange(raw.nominalMm, "nominalMm");
  const measuredMm = finiteInRange(raw.measuredMm, "measuredMm");
  const deviation = Math.abs(measuredMm - nominalMm);
  const cap = Math.min(MAX_DEVIATION_MM, MAX_DEVIATION_FRACTION * nominalMm);
  if (deviation > cap) {
    throw new RangeError(
      `measured ${mm(measuredMm)} mm against a modelled ${mm(nominalMm)} mm is ${mm(deviation)} mm out, ` +
        `over the ${mm(cap)} mm this module will treat as a process delta ` +
        `(cap = min(${MAX_DEVIATION_MM} mm, ${MAX_DEVIATION_FRACTION * 100}% of nominal)). ` +
        `That is the wrong part on the bench, or the wrong nominal, not a fit correction.`,
    );
  }

  if (typeof raw.targetFitClass !== "string" || raw.targetFitClass.trim() === "") {
    throw new RangeError("measurement.targetFitClass must be a non-empty fit-class name");
  }
  if (typeof raw.measuredBy !== "string" || raw.measuredBy.trim() === "") {
    throw new RangeError(
      "measurement.measuredBy must name the human who took the reading — every proposal is " +
        "addressed to a person who has to accept it",
    );
  }
  if (raw.instrument !== undefined && (typeof raw.instrument !== "string" || raw.instrument.trim() === "")) {
    throw new RangeError("measurement.instrument, when given, must be a non-empty string");
  }

  return {
    feature,
    dimension,
    nominalMm,
    measuredMm,
    fit,
    targetFitClass: raw.targetFitClass.trim(),
    measuredBy: raw.measuredBy.trim(),
    ...(raw.instrument === undefined ? {} : { instrument: raw.instrument.trim() }),
  };
}

// --- reading the parent request ---------------------------------------------

/**
 * Locate the flush-mount spec inside a validated request. Mirrors the shapes
 * the flushmount backend accepts (server/pipeline/backends.mjs:94-95) so an
 * amendment can be proposed for any request that backend would generate.
 */
function locateSpec(request) {
  const intent = request?.structuredIntent;
  if (isPlainObject(intent?.flushMount)) return { spec: intent.flushMount, nested: true };
  if (isPlainObject(intent?.panel) && isPlainObject(intent?.opening)) return { spec: intent, nested: false };
  throw new RangeError(
    "parentRequest has no flush-mount spec — expected structuredIntent.flushMount " +
      "(or a structuredIntent carrying panel + opening directly). There is nothing to amend.",
  );
}

/** The rule id behind a band edge, surfaced from the table (citations carry no id). */
function bandRuleId(table, fitClass, bound) {
  const rule = table.rules.find(
    (r) => r.parameter === `clearance-per-side-${bound}` && r.appliesTo?.fitClass === fitClass,
  );
  if (!rule) throw new Error(`no ${bound} clearance row for fit class ${fitClass} in table ${table.name}`);
  return rule.id;
}

// --- the proposal -----------------------------------------------------------

/**
 * Propose an amended request from a parent request and one bench measurement.
 *
 * @param {{parentRequest: object, measurement: object, allowDraft?: boolean}} args
 * @param {object} [table] the FMF table to consult. Injectable so a test can
 *        exercise a signed table without signing the real one.
 * @returns {{
 *   fitClass: string,
 *   measurement: object,
 *   band: {valueMm: number, bound: "min"|"max", ruleId: string, citation: string, basis: "cited"},
 *   processDeltaMm: {valueMm: number, basis: "computed", arithmetic: string},
 *   amendedClearanceMm: {valueMm: number, basis: "computed", arithmetic: string},
 *   amendedChamferDepthMm: {valueMm: number, basis: "computed", arithmetic: string},
 *   amendedRequest: object,
 *   warnings: string[],
 *   verification: {status: string, rules: object[]},
 *   watermark?: string
 * }}
 */
export function proposeAmendment({ parentRequest, measurement, allowDraft = false } = {}, table = flushMountFit) {
  // 1. The parent has to be a real request before anything can amend it.
  const parentCheck = validateGenerationRequest(parentRequest);
  if (!parentCheck.ok) {
    throw new RangeError(`parentRequest is not a valid generation request: ${parentCheck.errors.join("; ")}`);
  }
  const { spec, nested } = locateSpec(parentCheck.request);

  // 2. The measurement is a contract, checked before it is trusted.
  const m = validateMeasurement(measurement);

  // 3. CITED: the clearance band. Fail-closed — throws UnverifiedRuleError
  //    without allowDraft, because every FMF row is PENDING today.
  const clearance = fitClearance({ class: m.targetFitClass, allowDraft }, table);
  const bound = TOO_TIGHT.has(m.fit) ? "max" : "min";
  const band = Object.freeze({
    // NOT quantized: this is the table's number, passed through unchanged, so
    // "cited" keeps meaning "an encoded row holds exactly this".
    valueMm: bound === "max" ? clearance.perSideMaxMm : clearance.perSideMinMm,
    bound,
    ruleId: bandRuleId(table, clearance.class, bound),
    citation: bound === "max" ? clearance.citation.max : clearance.citation.min,
    basis: "cited",
  });

  // 4. COMPUTED: the process delta. Ours, from the measurement, uncited.
  const rawDelta =
    m.feature === "opening" ? (m.nominalMm - m.measuredMm) / 2 : (m.measuredMm - m.nominalMm) / 2;
  const processDeltaMm = Object.freeze({
    valueMm: quantizeMm(rawDelta),
    basis: "computed",
    arithmetic:
      `${m.feature} ${m.dimension}: modelled ${mm(m.nominalMm)} mm, measured ${mm(m.measuredMm)} mm; ` +
      (m.feature === "opening"
        ? `(${mm(m.nominalMm)} - ${mm(m.measuredMm)}) / 2`
        : `(${mm(m.measuredMm)} - ${mm(m.nominalMm)}) / 2`) +
      ` = ${mm(quantizeMm(rawDelta))} mm of clearance lost per side (negative = gained), ` +
      `quantized to ${MM_DECIMALS} dp`,
  });

  // 5. COMPUTED: the amended clearance. band + delta, and nothing else.
  const amendedValue = quantizeMm(band.valueMm + processDeltaMm.valueMm);
  if (amendedValue <= 0) {
    throw new RangeError(
      `the amended clearance works out at ${mm(amendedValue)} mm per side. A flush fit is a ` +
        `deliberate clearance, not zero — check the measurement before proposing this.`,
    );
  }
  const openingSpan = spec.opening?.shape === "round" ? spec.opening?.diameterMm : spec.opening?.widthMm;
  const openingShort = spec.opening?.shape === "round" ? spec.opening?.diameterMm : spec.opening?.heightMm;
  const smallestOpening = Math.min(
    ...[openingSpan, openingShort].filter((v) => typeof v === "number" && Number.isFinite(v)),
  );
  if (Number.isFinite(smallestOpening) && smallestOpening - 2 * amendedValue <= 0) {
    throw new RangeError(
      `an amended clearance of ${mm(amendedValue)} mm per side consumes the ${mm(smallestOpening)} mm ` +
        `opening — there would be no insert left.`,
    );
  }
  const amendedClearanceMm = Object.freeze({
    valueMm: amendedValue,
    basis: "computed",
    arithmetic:
      `band ${mm(band.valueMm)} mm/side (${band.ruleId}, ${clearance.class} ${bound}, cited) + ` +
      `process delta ${mm(processDeltaMm.valueMm)} mm/side (computed) = ${mm(amendedValue)} mm/side, ` +
      `quantized to ${MM_DECIMALS} dp`,
  });

  // 6. The chamfer lead-in has to keep up with the new clearance. SECOND
  //    fail-closed lookup — allowDraft is threaded here too. FMF-007/008 are
  //    PENDING like everything else, so an unthreaded flag throws right here,
  //    halfway through composing the amendment.
  const chamfer = chamferFor({ clearanceMm: amendedValue, allowDraft }, table);
  const parentDepth = typeof spec.chamfer?.depthMm === "number" ? spec.chamfer.depthMm : 0;
  const requiredDepth = quantizeMm(chamfer.depthMinMm);
  const amendedDepth = quantizeMm(Math.max(parentDepth, requiredDepth));
  const panelThicknessMm = spec.panel?.thicknessMm;
  if (typeof panelThicknessMm === "number" && amendedDepth > panelThicknessMm - 0.2) {
    throw new RangeError(
      `the lead-in this clearance needs (${mm(amendedDepth)} mm) would leave under 0.2 mm of straight ` +
        `opening wall in a ${mm(panelThicknessMm)} mm panel. Thicken the panel or aim at a tighter fit ` +
        `class; this proposal would not generate.`,
    );
  }
  const amendedChamferDepthMm = Object.freeze({
    valueMm: amendedDepth,
    basis: "computed",
    arithmetic:
      `FMF-008 minimum lead-in for ${mm(amendedValue)} mm/side is ${mm(requiredDepth)} mm; ` +
      `the parent's chamfer depth is ${mm(parentDepth)} mm, so the amendment ` +
      (amendedDepth > parentDepth ? `raises it to ${mm(amendedDepth)} mm` : `keeps it at ${mm(amendedDepth)} mm`),
  });

  // 7. The amended request: the parent, byte-for-byte, with the fit
  //    parameters changed. Keys this module does not understand ride along
  //    untouched; the result is re-validated so "valid request" is a checked
  //    claim rather than an assurance.
  const amendedRequest = structuredClone(parentRequest);
  const amendedIntent = nested ? amendedRequest.structuredIntent.flushMount : amendedRequest.structuredIntent;
  amendedIntent.clearancePerSideMm = amendedValue;
  amendedIntent.chamfer = { ...(amendedIntent.chamfer ?? {}), depthMm: amendedDepth };
  const amendedCheck = validateGenerationRequest(amendedRequest);
  if (!amendedCheck.ok) {
    throw new Error(`the amended request did not validate: ${amendedCheck.errors.join("; ")}`);
  }

  // 8. Verification over BOTH lookups, and the warnings that ride with it.
  const rules = [];
  for (const r of [...clearance.verification.rules, ...chamfer.verification.rules]) {
    if (!rules.some((x) => x.id === r.id)) rules.push(r);
  }
  const pending = rules.filter((r) => r.status !== VERIFIED);
  const draft = pending.length > 0;

  const warnings = [];
  if (draft) {
    warnings.push(
      OPERATOR_FLAG_WORDING.unverifiedRule.replace("{ruleIds}", pending.map((r) => r.id).join(", ")),
    );
  }
  warnings.push(OPERATOR_FLAG_WORDING.derivationUncited);
  warnings.push(OPERATOR_FLAG_WORDING.amendmentDisclaimer.replace("{reviewer}", m.measuredBy));

  return {
    fitClass: clearance.class,
    measurement: m,
    band,
    processDeltaMm,
    amendedClearanceMm,
    amendedChamferDepthMm,
    amendedRequest,
    warnings,
    verification: { status: draft ? PENDING_OPERATOR : VERIFIED, rules },
    ...(draft ? { watermark: DRAFT_WATERMARK } : {}),
  };
}

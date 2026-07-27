// Amendment proposals for flush-mount fit — the module that turns "I printed
// it, I put calipers on it, and the insert does not fit" into a PROPOSED
// amended request. The amendment is what makes a revision a revision rather
// than a counter-proposal: it is the parent request with the fit parameters
// changed and nothing else, plus the shown work for why.
//
// Pure and deterministic: no I/O, no network, no clock, no randomness. Same
// inputs, same object, every time. It does not touch the ledger, the state
// machine, the package or any API route — a caller decides what to do with the
// proposal it returns. The one module it calls outside the reference is the
// flush-mount generator, and only to ask "would you accept this?"; that
// generator is itself pure, import-free and non-mutating (flushmount.mjs:23).
//
// The returned proposal is DEEP FROZEN. It is the record of one reasoning
// chain — a measurement, a cited band, an uncited derivation and the caveats
// that ride with them — and a caller must not be able to keep the correction
// while deleting the qualification. structuredClone it if you need a mutable
// copy of the amended request.
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
// Every rule id this module quotes is DERIVED from the consulted table by
// parameter name, through one helper (uniqueRule), and the band's id is
// cross-checked against the value the lookup served. There is no hardcoded id
// anywhere below: a renumbered or duplicated row throws rather than quietly
// naming the wrong row in operator-facing shown work.
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
//                                           Must EXIST on the parent's opening
//                                           shape — "diameter" on a rect
//                                           opening is refused. Recorded for
//                                           provenance; v1 amends the single
//                                           per-side clearance, which applies
//                                           to both axes.
//   nominalMm      number  what the model says that dimension is. Finite,
//                          > 0, ≤ 1000, and it must AGREE WITH THE PARENT to
//                          within one quantization step — see below.
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
// NOMINAL IS CROSS-CHECKED AGAINST THE PARENT. The module holds both the
// reading and the model, so it checks that they describe the same feature:
//
//   opening + width|height|diameter  →  spec.opening.widthMm / heightMm /
//                                       diameterMm
//   insert  + width|height|diameter  →  that opening dimension
//                                       − 2 × spec.clearancePerSideMm
//
// A nominal that disagrees by more than one quantization step is refused. The
// failure this prevents: a 12 mm nominal against a 30 mm opening produces a
// delta, a clearance and a full page of shown work that is arithmetic about a
// different part, presented with no caveat at all.
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
// The amended clearance routinely lands OUTSIDE the band it cites — that is
// the point, not a defect: the modelled number moves off the band so the
// PRINTED part lands on it. The result says so out loud, both as a boolean
// (amendedClearanceMm.withinCitedBand) and as a warning.
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
//
// ---------------------------------------------------------------------------
// WOULD IT GENERATE? — the amended request is checked, not asserted
// ---------------------------------------------------------------------------
// generateFlushMountPair owns eight spec gates. This module duplicates NONE of
// them. It runs the real generator over the amended spec and reports the
// generator's own refusal verbatim, because a proposal the operator cannot
// build is worse than no proposal. Re-validating the envelope with
// validateGenerationRequest would be theatre — that validator never looks
// inside structuredIntent, which is the only thing an amendment changes, so it
// could never fail and is not called on the way out.
//
// When the amended spec is refused the parent is tried too, so the refusal can
// say which one is at fault: an unbuildable parent is the operator's existing
// problem, an unbuildable amendment is ours.

import { validateGenerationRequest } from "../state/request.mjs";
import { DRAFT_WATERMARK } from "../reference/lookup.mjs";
import { PENDING_OPERATOR, VERIFIED, ruleValue } from "../reference/schema.mjs";
import { flushMountFit, fitClearance, chamferFor } from "../reference/tables/flush-mount-fit.mjs";
import { generateFlushMountPair } from "../generators/flushmount.mjs";

// --- the operator-flag wording ----------------------------------------------

/**
 * OPERATOR-FLAG ITEM. The public voice ruling is "aviation standard but not
 * grade. E for everyone." — we build to a published standard and we never
 * claim to have been graded against one. Plain English: the reader is a
 * stranger who owns a 3D printer.
 *
 * Every operator-facing string lives here, in one place, so the operator can
 * rewrite them without reading the module. The tests assert MEANING (that a
 * disclaimer survives rule signing, that it names a human, that it does not
 * claim certification) against these constants rather than pinning the prose,
 * so editing the words below does not turn the suite red.
 *
 * {placeholders} are substituted by fillWording(), which replaces EVERY
 * occurrence and inserts values literally — so a rewrite that names the
 * reviewer twice is filled twice, and a name containing "$&" survives intact.
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

  /**
   * Present when the reading and the reported fit point opposite ways — the
   * operator says it binds but the part measured roomy, or vice versa. The
   * arithmetic still runs; it just moves the clearance away from the symptom.
   */
  deltaContradictsFit:
    "THE READING AND THE FIT DISAGREE: you reported the seated fit as \"{fit}\", but the " +
    "{feature} you measured says the machine {direction}. This proposal therefore moves the " +
    "modelled clearance the opposite way from the symptom you described. Measure the axis " +
    "that actually binds, on the feature that actually binds, before you accept it.",

  /**
   * Present when the amended clearance lands outside the band it cites. Common
   * and expected, not an error — but the operator should hear it said.
   */
  outsideCitedBand:
    "OUTSIDE THE BAND IT CITES: the amended clearance is {valueMm} mm per side, outside the " +
    "{fitClass} band of {minMm}-{maxMm} mm ({minRule}/{maxRule}). That is what compensation " +
    "looks like — the modelled number moves off the band so the PRINTED part lands on it — " +
    "but the number in the model is no longer a {fitClass} clearance by the table's own " +
    "definition. Print it and measure it.",
});

/**
 * Fill {placeholders} in an operator-facing string.
 *
 * A GLOBAL pattern with a FUNCTION replacement, deliberately, because the
 * obvious `template.replace("{reviewer}", name)` gets both halves wrong: it
 * fills only the FIRST occurrence — so an operator rewrite naming the reviewer
 * twice ships a literal "{reviewer}" to the reader — and it interprets $&, $',
 * $` and $$ in the VALUE, so a reviewer named "R. $& Vasquez" injects the
 * placeholder back into its own slot. A function replacement inserts the value
 * literally, and an unknown placeholder is left visible rather than filled
 * with "undefined".
 */
export function fillWording(template, values) {
  return template.replaceAll(/\{(\w+)\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole,
  );
}

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

/** Which opening dimensions exist on each opening shape. */
const DIMENSIONS_BY_SHAPE = Object.freeze({
  rect: Object.freeze(["width", "height"]),
  round: Object.freeze(["diameter"]),
});
const SPEC_KEY = Object.freeze({ width: "widthMm", height: "heightMm", diameter: "diameterMm" });

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

/** Two millimetre values agree if they are the same number at MM_DECIMALS. */
const AGREE_MM = 0.5 / SCALE;

const mm = (n) => n.toFixed(MM_DECIMALS);
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const positiveNumber = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;

/** Freeze the whole proposal, arrays and all. No cycles are produced here. */
function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const v of Object.values(value)) deepFreeze(v, seen);
  return Object.freeze(value);
}

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
 * Validate and normalise a measurement's SHAPE. Throws — this is a contract,
 * and a caliper reading nobody checked is exactly the input that must not
 * reach the arithmetic silently.
 *
 * This checks the measurement against itself. Checking it against the parent
 * request (does that nominal exist on that part?) needs the spec and happens
 * in proposeAmendment.
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
 * Locate the flush-mount spec inside a validated request. Deliberately mirrors
 * the flushmount backend's own detection (backends.mjs:95) rather than being
 * stricter, so this module amends exactly the requests that backend generates.
 * Whether the spec is COMPLETE is not decided here — the generator decides
 * that, on the amended spec, further down.
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

/**
 * The one place a rule id is derived. Uses the table's own parameter index and
 * insists on exactly one match, so a renumbered or duplicated row throws
 * instead of letting this module cite one row while reporting another's value.
 */
function uniqueRule(table, parameter, describe, extra = () => true) {
  const matches = (table.byParameter[parameter] ?? []).filter(extra);
  if (matches.length !== 1) {
    throw new Error(
      `${describe} matched ${matches.length} rows in table ${table.name} ` +
        `(${matches.map((r) => r.id).join(", ") || "none"}). A rule id quoted in operator-facing ` +
        `shown work has to name exactly one row.`,
    );
  }
  return matches[0];
}

/** Both edges of a fit class's band, with their ids, from the consulted table. */
function bandRules(table, fitClass) {
  const edge = (bound) =>
    uniqueRule(
      table,
      `clearance-per-side-${bound}`,
      `the ${bound} clearance row for fit class ${fitClass}`,
      (r) => r.appliesTo?.fitClass === fitClass,
    );
  return { min: edge("min"), max: edge("max") };
}

/**
 * The modelled value of the dimension the operator says they measured, read
 * out of the parent spec, so the reading can be checked against the part it
 * claims to describe.
 */
function modelledDimension(spec, m) {
  const shape = spec.opening?.shape;
  const allowed = DIMENSIONS_BY_SHAPE[shape];
  if (!allowed) {
    throw new RangeError(
      `the parent's opening does not state a shape ("rect" or "round"), so there is no modelled ` +
        `dimension to check your reading against. There is nothing to amend.`,
    );
  }
  if (!allowed.includes(m.dimension)) {
    throw new RangeError(
      `measurement.dimension "${m.dimension}" does not exist on a ${shape} opening — ` +
        `a ${shape} opening is measured across ${allowed.join(" or ")}.`,
    );
  }
  const key = SPEC_KEY[m.dimension];
  const openingMm = spec.opening[key];
  if (!positiveNumber(openingMm)) {
    throw new RangeError(
      `the parent's opening does not state a positive ${key}, so there is no modelled ` +
        `${m.dimension} to check your reading against.`,
    );
  }
  if (m.feature === "opening") {
    return { valueMm: openingMm, describedAs: `opening.${key} = ${mm(openingMm)} mm` };
  }
  const c = spec.clearancePerSideMm;
  if (!positiveNumber(c)) {
    throw new RangeError(
      `the parent spec does not state a positive clearancePerSideMm, so there is no modelled ` +
        `insert ${m.dimension} to check your reading against.`,
    );
  }
  return {
    valueMm: openingMm - 2 * c,
    describedAs: `insert ${m.dimension} = opening ${mm(openingMm)} mm - 2 x clearance ${mm(c)} mm`,
  };
}

// --- the proposal -----------------------------------------------------------

/**
 * Propose an amended request from a parent request and one bench measurement.
 *
 * Throws rather than returning a doubtful proposal: on an invalid parent, a
 * measurement that does not describe the parent, a PENDING reference row
 * without allowDraft, or an amended spec the generator would refuse.
 *
 * @param {{parentRequest: object, measurement: object, allowDraft?: boolean}} args
 * @param {object} [table] the FMF table to consult. Injectable so a test can
 *        exercise a signed table without signing the real one.
 * @returns {Readonly<{
 *   fitClass: string,
 *   measurement: object,
 *   band: {valueMm: number, bound: "min"|"max", ruleId: string, citation: string, basis: "cited"},
 *   processDeltaMm: {valueMm: number, basis: "computed", arithmetic: string},
 *   amendedClearanceMm: {valueMm: number, basis: "computed", arithmetic: string, withinCitedBand: boolean},
 *   amendedChamferDepthMm: {valueMm: number, basis: "computed", arithmetic: string},
 *   amendedRequest: object,
 *   warnings: string[],
 *   verification: {status: string, rules: object[]},
 *   watermark?: string
 * }>} deep frozen
 */
export function proposeAmendment({ parentRequest, measurement, allowDraft = false } = {}, table = flushMountFit) {
  // 1. The parent has to be a real request before anything can amend it.
  const parentCheck = validateGenerationRequest(parentRequest);
  if (!parentCheck.ok) {
    throw new RangeError(`parentRequest is not a valid generation request: ${parentCheck.errors.join("; ")}`);
  }
  const { spec, nested } = locateSpec(parentCheck.request);

  // 2. The measurement is a contract, checked before it is trusted — first
  //    against itself, then against the part it claims to describe. A nominal
  //    the parent does not hold is arithmetic about a different part.
  const m = validateMeasurement(measurement);
  const modelled = modelledDimension(spec, m);
  if (Math.abs(m.nominalMm - modelled.valueMm) > AGREE_MM) {
    throw new RangeError(
      `measurement.nominalMm is ${mm(m.nominalMm)} mm, but the parent models that ${m.feature} ` +
        `${m.dimension} at ${mm(modelled.valueMm)} mm (${modelled.describedAs}). A correction derived ` +
        `from a nominal the parent does not hold is arithmetic about a different part.`,
    );
  }

  // 3. CITED: the clearance band. Fail-closed — throws UnverifiedRuleError
  //    without allowDraft, because every FMF row is PENDING today.
  const clearance = fitClearance({ class: m.targetFitClass, allowDraft }, table);
  const bound = TOO_TIGHT.has(m.fit) ? "max" : "min";
  const edges = bandRules(table, clearance.class);
  const servedMm = bound === "max" ? clearance.perSideMaxMm : clearance.perSideMinMm;
  if (ruleValue(edges[bound]) !== servedMm) {
    throw new Error(
      `${edges[bound].id} holds ${ruleValue(edges[bound])} but the lookup served ${servedMm} for the ` +
        `${clearance.class} ${bound} band. A cited number and the id beside it must come from the same row.`,
    );
  }
  const band = {
    // NOT quantized: this is the table's number, passed through unchanged, so
    // "cited" keeps meaning "an encoded row holds exactly this".
    valueMm: servedMm,
    bound,
    ruleId: edges[bound].id,
    citation: bound === "max" ? clearance.citation.max : clearance.citation.min,
    basis: "cited",
  };

  // 4. COMPUTED: the process delta. Ours, from the measurement, uncited.
  const rawDelta =
    m.feature === "opening" ? (m.nominalMm - m.measuredMm) / 2 : (m.measuredMm - m.nominalMm) / 2;
  const processDeltaMm = {
    valueMm: quantizeMm(rawDelta),
    basis: "computed",
    arithmetic:
      `${m.feature} ${m.dimension}: modelled ${mm(m.nominalMm)} mm (${modelled.describedAs}), ` +
      `measured ${mm(m.measuredMm)} mm; ` +
      (m.feature === "opening"
        ? `(${mm(m.nominalMm)} - ${mm(m.measuredMm)}) / 2`
        : `(${mm(m.measuredMm)} - ${mm(m.nominalMm)}) / 2`) +
      ` = ${mm(quantizeMm(rawDelta))} mm of clearance lost per side (negative = gained), ` +
      `quantized to ${MM_DECIMALS} dp`,
  };

  // 5. COMPUTED: the amended clearance. band + delta, and nothing else.
  const amendedValue = quantizeMm(band.valueMm + processDeltaMm.valueMm);
  if (amendedValue <= 0) {
    throw new RangeError(
      `the amended clearance works out at ${mm(amendedValue)} mm per side. A flush fit is a ` +
        `deliberate clearance, not zero — check the measurement before proposing this.`,
    );
  }
  const withinCitedBand = amendedValue >= clearance.perSideMinMm && amendedValue <= clearance.perSideMaxMm;
  const amendedClearanceMm = {
    valueMm: amendedValue,
    basis: "computed",
    withinCitedBand,
    arithmetic:
      `band ${mm(band.valueMm)} mm/side (${band.ruleId}, ${clearance.class} ${bound}, cited) + ` +
      `process delta ${mm(processDeltaMm.valueMm)} mm/side (computed) = ${mm(amendedValue)} mm/side, ` +
      `quantized to ${MM_DECIMALS} dp`,
  };

  // 6. The chamfer lead-in has to keep up with the new clearance. SECOND
  //    fail-closed lookup — allowDraft is threaded here too. FMF-007/008 are
  //    PENDING like everything else, so an unthreaded flag throws right here,
  //    halfway through composing the amendment.
  const chamfer = chamferFor({ clearanceMm: amendedValue, allowDraft }, table);
  const depthRuleId = uniqueRule(table, "chamfer-lead-in-depth-min", "the chamfer depth row").id;
  const parentDepth = typeof spec.chamfer?.depthMm === "number" ? spec.chamfer.depthMm : 0;
  const requiredDepth = quantizeMm(chamfer.depthMinMm);
  const amendedDepth = quantizeMm(Math.max(parentDepth, requiredDepth));
  const amendedChamferDepthMm = {
    valueMm: amendedDepth,
    basis: "computed",
    arithmetic:
      `${depthRuleId} minimum lead-in for ${mm(amendedValue)} mm/side is ${mm(requiredDepth)} mm; ` +
      `the parent's chamfer depth is ${mm(parentDepth)} mm, so the amendment ` +
      (amendedDepth > parentDepth ? `raises it to ${mm(amendedDepth)} mm` : `keeps it at ${mm(amendedDepth)} mm`),
  };

  // 7. The amended request: the parent, byte-for-byte, with the fit
  //    parameters changed. Keys this module does not understand ride along
  //    untouched.
  const amendedRequest = structuredClone(parentRequest);
  const amendedSpec = nested ? amendedRequest.structuredIntent.flushMount : amendedRequest.structuredIntent;
  amendedSpec.clearancePerSideMm = amendedValue;
  amendedSpec.chamfer = { ...(amendedSpec.chamfer ?? {}), depthMm: amendedDepth };

  // 8. WOULD IT GENERATE? Asked of the real generator, not of a copy of two of
  //    its eight gates. If it refuses, the parent is tried too so the refusal
  //    names the party at fault instead of guessing at a cause.
  try {
    generateFlushMountPair(amendedSpec);
  } catch (amendedError) {
    let parentError = null;
    try {
      generateFlushMountPair(spec);
    } catch (e) {
      parentError = e;
    }
    if (parentError) {
      throw new RangeError(
        `the parent request does not generate as it stands, so there is nothing to amend: ` +
          `${parentError.message}`,
      );
    }
    throw new RangeError(
      `this amendment would not generate. The parent generates, but at ${mm(amendedValue)} mm/side ` +
        `clearance with a ${mm(amendedDepth)} mm lead-in the generator refuses it: ` +
        `${amendedError.message}. Aim at a tighter fit class, or change the parent geometry.`,
    );
  }

  // 9. Verification over BOTH lookups, and the warnings that ride with it.
  const rules = [];
  for (const r of [...clearance.verification.rules, ...chamfer.verification.rules]) {
    if (!rules.some((x) => x.id === r.id)) rules.push(r);
  }
  const pending = rules.filter((r) => r.status !== VERIFIED);
  const draft = pending.length > 0;

  const tooTight = TOO_TIGHT.has(m.fit);
  const contradicts =
    (tooTight && processDeltaMm.valueMm < 0) || (!tooTight && processDeltaMm.valueMm > 0);

  const warnings = [];
  if (draft) {
    warnings.push(fillWording(OPERATOR_FLAG_WORDING.unverifiedRule, { ruleIds: pending.map((r) => r.id).join(", ") }));
  }
  if (contradicts) {
    warnings.push(
      fillWording(OPERATOR_FLAG_WORDING.deltaContradictsFit, {
        fit: m.fit,
        feature: m.feature,
        direction: processDeltaMm.valueMm > 0 ? "took clearance away" : "gave clearance back",
      }),
    );
  }
  if (!withinCitedBand) {
    warnings.push(
      fillWording(OPERATOR_FLAG_WORDING.outsideCitedBand, {
        valueMm: mm(amendedValue),
        fitClass: clearance.class,
        minMm: mm(clearance.perSideMinMm),
        maxMm: mm(clearance.perSideMaxMm),
        minRule: edges.min.id,
        maxRule: edges.max.id,
      }),
    );
  }
  warnings.push(OPERATOR_FLAG_WORDING.derivationUncited);
  warnings.push(fillWording(OPERATOR_FLAG_WORDING.amendmentDisclaimer, { reviewer: m.measuredBy }));

  // 10. Frozen on the way out: the caveats are not the caller's to delete.
  return deepFreeze({
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
  });
}

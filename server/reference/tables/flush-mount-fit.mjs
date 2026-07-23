// FDM fit clearances and chamfer lead-in rules for flush-mount mating parts
// (panel opening + insert on a calibrated 0.4mm-nozzle machine).
//
// Provenance (2026-07-22): these values are BENCH PRACTICE from FDM fit
// coupons, not FAA data. No printed source exists to check them against —
// verification is a printed coupon pair and calipers, not a paragraph number.
// Every row ships PENDING_OPERATOR and the lookups below refuse to serve any
// of them without an explicit draft opt-in, same contract as lookup.mjs.
//
// This module exports its own fail-closed lookup helpers (fitClearance,
// chamferFor, insertSize) rather than extending the shared lookup.mjs.
// UnverifiedRuleError and the watermark are imported from lookup.mjs so error
// identity is shared; the small consult/finish gate is replicated locally
// because lookup.mjs does not export it and shared files are not edited here.

import { makeTable, citationOf, ruleValue, PENDING_OPERATOR, VERIFIED } from "../schema.mjs";
import { UnverifiedRuleError, DRAFT_WATERMARK } from "../lookup.mjs";

const TOPIC = "fdm-flush-mount-fit";

const BENCH = {
  document: "Bench practice — FDM fit coupons (Bambu P1S, 0.4mm nozzle)",
  chapter: "Flush-mount fit",
  paragraph: "UNCONFIRMED — verify with printed coupon + calipers",
};

const CLASSES_SEC = { ...BENCH, section: "Clearance classes" };
const CHAMFER_SEC = { ...BENCH, section: "Chamfer lead-in" };
const SIZING_SEC = { ...BENCH, section: "Insert sizing" };
const SHRINK_SEC = { ...BENCH, section: "FDM inner-dimension behavior" };

const PENDING = (notes) => ({ status: PENDING_OPERATOR, verifiedBy: null, date: null, notes });

const BENCH_NOTE = "Bench practice, no printed source; verify by printing the coupon pair and measuring the seated fit with calipers.";

const clearanceRule = (id, fitClass, bound, valueMm, basis) => ({
  id,
  topic: TOPIC,
  parameter: `clearance-per-side-${bound}`,
  appliesTo: { process: "FDM (0.4mm nozzle, calibrated)", joint: "flush-mount insert in panel opening", fitClass },
  value: valueMm,
  units: "mm",
  basis,
  source: CLASSES_SEC,
  verification: PENDING(BENCH_NOTE),
});

export const flushMountFit = makeTable("flush-mount-fit", [
  clearanceRule("FMF-001", "snug", "min", 0.1,
    "A snug (press/locational) fit starts at 0.10 mm per side; below that a calibrated FDM pair binds before seating."),
  clearanceRule("FMF-002", "snug", "max", 0.15,
    "A snug (press/locational) fit tops out near 0.15 mm per side; the insert seats with firm thumb pressure and does not rattle."),
  clearanceRule("FMF-003", "sliding", "min", 0.2,
    "A smooth-sliding fit starts at 0.20 mm per side; the insert drops in and out freely without forcing."),
  clearanceRule("FMF-004", "sliding", "max", 0.25,
    "A smooth-sliding fit tops out near 0.25 mm per side before perceptible side-to-side play appears."),
  clearanceRule("FMF-005", "loose", "min", 0.3,
    "A loose (service) fit starts at 0.30 mm per side; parts mate under paint, dust, or field conditions."),
  clearanceRule("FMF-006", "loose", "max", 0.35,
    "A loose (service) fit tops out near 0.35 mm per side; beyond that the flush face reads as a sloppy gap."),
  {
    id: "FMF-007",
    topic: TOPIC,
    parameter: "chamfer-lead-in-angle",
    appliesTo: { process: "FDM (0.4mm nozzle, calibrated)", joint: "flush-mount insert in panel opening", edge: "both mating edges" },
    value: 45,
    units: "deg",
    basis: "A 45-degree chamfer on both mating edges self-centers the insert and prints cleanly without support on either orientation.",
    source: CHAMFER_SEC,
    verification: PENDING(BENCH_NOTE),
  },
  {
    id: "FMF-008",
    topic: TOPIC,
    parameter: "chamfer-lead-in-depth-min",
    appliesTo: { process: "FDM (0.4mm nozzle, calibrated)", joint: "flush-mount insert in panel opening", edge: "both mating edges" },
    formula: {
      fn: ({ clearanceMm }) => Math.max(2 * clearanceMm, 0.6),
      text: "2 × clearance per side, with a 0.6 mm floor",
      inputs: ["clearanceMm"],
    },
    units: "mm",
    basis: "Chamfer depth of at least twice the per-side clearance, never under 0.6 mm, keeps the lead-in wider than the total gap so the parts find each other before the flats engage.",
    source: CHAMFER_SEC,
    verification: PENDING(BENCH_NOTE),
  },
  {
    id: "FMF-009",
    topic: TOPIC,
    parameter: "insert-dimension",
    appliesTo: { process: "FDM (0.4mm nozzle, calibrated)", joint: "flush-mount insert in panel opening" },
    formula: {
      fn: ({ openingDimMm, clearancePerSideMm }) => openingDimMm - 2 * clearancePerSideMm,
      text: "opening dimension − 2 × clearance per side",
      inputs: ["openingDimMm", "clearancePerSideMm"],
    },
    units: "mm",
    basis: "The insert is sized off the opening: each mating dimension gives up the per-side clearance on both opposing faces.",
    source: SIZING_SEC,
    verification: PENDING(BENCH_NOTE),
  },
  {
    id: "FMF-010",
    topic: TOPIC,
    parameter: "inner-dimension-compensation",
    appliesTo: { process: "FDM (0.4mm nozzle, calibrated)", joint: "flush-mount insert in panel opening", feature: "holes and inner openings" },
    value: 0,
    units: "mm",
    basis: "FDM holes and inner openings print undersize, so seated fits run tighter than modeled; no separate numeric compensation is encoded — the clearance class absorbs the undersize only after coupon calibration on the target machine.",
    source: SHRINK_SEC,
    verification: PENDING(BENCH_NOTE),
  },
]);

// ---------------------------------------------------------------------------
// Fail-closed lookups over this table. Same contract as lookup.mjs: any
// consulted PENDING_OPERATOR rule throws UnverifiedRuleError unless the caller
// opts into a draft, and every draft result carries the watermark.

const FIT_CLASS_ALIASES = Object.freeze({
  snug: "snug",
  press: "snug",
  sliding: "sliding",
  "smooth-sliding": "sliding",
  loose: "loose",
  service: "loose",
});

const FIT_CLASS_RULES = Object.freeze({
  snug: { min: "FMF-001", max: "FMF-002" },
  sliding: { min: "FMF-003", max: "FMF-004" },
  loose: { min: "FMF-005", max: "FMF-006" },
});

function getRule(table, id) {
  const rule = table.byId[id];
  if (!rule) throw new Error(`rule ${id} not found in table ${table.name}`);
  return rule;
}

function positive(n, name) {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
    throw new RangeError(`${name} must be a positive number`);
  }
}

// Replicated from lookup.mjs (not exported there): gate + verification summary
// for the exact rules a lookup consulted.
function consult(rules, allowDraft) {
  const pending = rules.filter((r) => r.verification.status !== VERIFIED);
  if (pending.length > 0 && !allowDraft) throw new UnverifiedRuleError(pending.map((r) => r.id));
  return {
    draft: pending.length > 0,
    verification: {
      status: pending.length > 0 ? PENDING_OPERATOR : VERIFIED,
      rules: rules.map((r) => ({ id: r.id, ...r.verification })),
    },
  };
}

function finish(result, gate) {
  result.verification = gate.verification;
  if (gate.draft) result.watermark = DRAFT_WATERMARK;
  return result;
}

/**
 * Per-side clearance band for a named fit class.
 * Accepts "snug"/"press", "sliding"/"smooth-sliding", "loose"/"service".
 * Nominal is the midpoint of the cited band, not a separate rule.
 * @returns {{class: string, perSideMinMm: number, perSideMaxMm: number, perSideNominalMm: number, citation: {min: string, max: string}, verification: object, watermark?: string}}
 */
export function fitClearance({ class: fitClass, allowDraft = false } = {}, table = flushMountFit) {
  const canonical = FIT_CLASS_ALIASES[fitClass];
  if (!canonical) {
    throw new RangeError(`class must be one of ${Object.keys(FIT_CLASS_ALIASES).join(", ")}, got ${JSON.stringify(fitClass)}`);
  }
  const ids = FIT_CLASS_RULES[canonical];
  const [minRule, maxRule] = [ids.min, ids.max].map((id) => getRule(table, id));
  const gate = consult([minRule, maxRule], allowDraft);
  const perSideMinMm = ruleValue(minRule);
  const perSideMaxMm = ruleValue(maxRule);
  return finish(
    {
      class: canonical,
      perSideMinMm,
      perSideMaxMm,
      perSideNominalMm: (perSideMinMm + perSideMaxMm) / 2,
      citation: { min: citationOf(minRule), max: citationOf(maxRule) },
    },
    gate,
  );
}

/**
 * Chamfer lead-in for a given per-side clearance: 45° standard, depth at
 * least 2 × clearance with a 0.6 mm floor.
 * @returns {{angleDeg: number, depthMinMm: number, citation: {angle: string, depth: string}, verification: object, watermark?: string}}
 */
export function chamferFor({ clearanceMm, allowDraft = false } = {}, table = flushMountFit) {
  positive(clearanceMm, "clearanceMm");
  const [angleRule, depthRule] = ["FMF-007", "FMF-008"].map((id) => getRule(table, id));
  const gate = consult([angleRule, depthRule], allowDraft);
  return finish(
    {
      angleDeg: ruleValue(angleRule),
      depthMinMm: ruleValue(depthRule, { clearanceMm }),
      citation: { angle: citationOf(angleRule), depth: citationOf(depthRule) },
    },
    gate,
  );
}

/**
 * Insert dimension from the opening dimension and per-side clearance.
 * @returns {{insertDimMm: number, citation: string, verification: object, watermark?: string}}
 */
export function insertSize({ openingDimMm, clearancePerSideMm, allowDraft = false } = {}, table = flushMountFit) {
  positive(openingDimMm, "openingDimMm");
  positive(clearancePerSideMm, "clearancePerSideMm");
  const rule = getRule(table, "FMF-009");
  const gate = consult([rule], allowDraft);
  const insertDimMm = ruleValue(rule, { openingDimMm, clearancePerSideMm });
  if (insertDimMm <= 0) {
    throw new RangeError(`clearance ${clearancePerSideMm} mm per side consumes the ${openingDimMm} mm opening`);
  }
  return finish({ insertDimMm, citation: citationOf(rule) }, gate);
}

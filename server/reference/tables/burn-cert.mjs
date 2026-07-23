// Burn-cert reference — design-for-flammability-compliance rules for
// FDM parts headed toward aircraft-interior use.
//
// Provenance (2026-07-23): FAA TC TN23-65 ("An Evaluation of the Flammability
// of 3D Printed Parts") could NOT be fetched for verbatim confirmation —
// fire.tc.faa.gov answered 503 and the ROSA-P mirror (rosap.ntl.bts.gov,
// dot/72825) answered 403 to automated fetch. Search-index snippets of the
// PDF corroborate the report title, the vertical-Bunsen-burner method, the
// "material / thickness / infill are the dominant variables" conclusion, and
// the "<20% infill → burn length beyond 3 in" finding, but corroboration is
// not confirmation: every TN23-65 row below ships with paragraph
// "UNCONFIRMED — verify against the printed source". The UL-94 thickness
// values WERE confirmed from a fetched secondary source (Forge Labs) on
// 2026-07-23; the authoritative record is the UL Yellow Card for the exact
// filament grade, so those rows stay PENDING_OPERATOR too. 14 CFR 25.853(a)
// text was fetched and confirmed via the Cornell LII mirror the same day.
//
// Hard boundaries this table never blurs:
//   1. Material chemistry sets the floor; geometry cannot overcome it.
//   2. Nothing here certifies anything. Real certification is a physical
//      coupon in a burn chamber per 14 CFR 25.853 / Appendix F. This table
//      delivers design-for-burn-cert: flag, don't certify.
//
// Same fail-closed contract as flush-mount-fit.mjs: every row ships
// PENDING_OPERATOR, lookups throw UnverifiedRuleError without an explicit
// draft opt-in, and every draft result carries the watermark.

import { makeTable, citationOf, ruleValue, PENDING_OPERATOR, VERIFIED } from "../schema.mjs";
import { UnverifiedRuleError, DRAFT_WATERMARK } from "../lookup.mjs";

const TOPIC = "burn-cert";

export const BURN_CERT_DISCLAIMER =
  "ADVISORY — design-for-burn-cert, not certification. Nothing in this output certifies a part: " +
  "compliance is demonstrated only by physical specimen burn testing per 14 CFR 25.853 / Appendix F. " +
  "Material chemistry sets the floor; geometry cannot overcome it. Flag, don't certify.";

const TN2365 = {
  document: "FAA TC TN23-65 — An Evaluation of the Flammability of 3D Printed Parts",
  chapter: "Results & conclusions",
};

const TN_UNCONFIRMED = "UNCONFIRMED — verify against the printed source";

const UL94 = {
  document: "UL-94 thickness data — Forge Labs, 'UL-94 Fire Safety Standards in Additive Manufacturing' (secondary source)",
  chapter: "UL-94",
  section: "Thickness-specific ratings",
  paragraph:
    "Fetched 2026-07-23 (forgelabs.com/blog/ul-94-fire-safety-standards-additive-manufacturing) — confirm against the UL Yellow Card for the exact filament grade",
};

const FAR25853 = {
  document: "14 CFR 25.853 — Compartment interiors (context only)",
  chapter: "Part 25, Subpart D",
  section: "25.853(a) + Appendix F part I",
  paragraph:
    "25.853(a) text fetched 2026-07-23 (law.cornell.edu/cfr/text/14/25.853); Appendix F test criteria UNCONFIRMED — verify against the printed source",
};

const PENDING = (notes) => ({ status: PENDING_OPERATOR, verifiedBy: null, date: null, notes });

const TN_NOTE =
  "TN23-65 could not be fetched (503/403, 2026-07-23); number carried from the operator-released backlog brief. Verify value AND section against the printed technical note.";
const UL_NOTE =
  "Confirmed from a fetched secondary source 2026-07-23; operator verifies against the UL Yellow Card for the exact filament grade before sign-off.";

export const burnCert = makeTable("burn-cert", [
  {
    id: "BC-001",
    topic: TOPIC,
    parameter: "min-wall-general-fr",
    appliesTo: { process: "FDM", part: "any FR part without a material-specific UL listing at thinner section" },
    value: 1.5,
    units: "mm",
    basis: "Most UL-94 certifications are issued at 1.5 mm or thicker, so a wall below 1.5 mm leaves the thickness range the material's rating was actually demonstrated at.",
    source: UL94,
    verification: PENDING(UL_NOTE),
  },
  {
    id: "BC-002",
    topic: TOPIC,
    parameter: "min-wall-material",
    appliesTo: { process: "FDM", material: "ULTEM 9085" },
    value: 0.508,
    units: "mm",
    basis: "ULTEM 9085 holds a UL-94 V-0 listing down to 0.508 mm, so its material-specific wall floor undercuts the general FR floor.",
    source: UL94,
    verification: PENDING(UL_NOTE),
  },
  {
    id: "BC-003",
    topic: TOPIC,
    parameter: "min-wall-material",
    appliesTo: { process: "FDM", material: "PC-ABS-FR" },
    value: 1.5,
    units: "mm",
    basis: "PC-ABS-FR holds its UL-94 V-0 listing at 1.5 mm; below that thickness the rating has not been demonstrated.",
    source: UL94,
    verification: PENDING(UL_NOTE),
  },
  {
    id: "BC-004",
    topic: TOPIC,
    parameter: "wall-flame-time-datum",
    appliesTo: { process: "FDM", test: "60-second vertical Bunsen burner" },
    value: 6.35,
    units: "mm",
    basis: "FAA TN23-65 reports that thickening walls from 0.10 in (2.54 mm) to 0.25 in (6.35 mm) at the same material and infill cut flame time from over 40 s to under 5 s — an ~8x improvement from geometry alone.",
    source: { ...TN2365, section: "Sample thickness vs flame time", paragraph: TN_UNCONFIRMED },
    verification: PENDING(TN_NOTE),
  },
  {
    id: "BC-005",
    topic: TOPIC,
    parameter: "min-infill-percent",
    appliesTo: { process: "FDM", enforcement: "print-time — package requirement, not CAD geometry" },
    value: 25,
    units: "%",
    basis: "TN23-65 ties infill below ~20% to burn lengths beyond 3 in under 60-second vertical burn testing while higher infill held 0.5–2.0 in; 25% keeps a margin above the failure band, and because infill is a print-time fact the CAD cannot enforce, the package must REQUIRE it.",
    source: { ...TN2365, section: "Infill percentage vs burn length", paragraph: TN_UNCONFIRMED },
    verification: PENDING(TN_NOTE),
  },
  {
    id: "BC-006",
    topic: TOPIC,
    parameter: "material-floor",
    appliesTo: { process: "FDM", scope: "every rule in this table" },
    value: 0,
    units: "advisory-note",
    basis: "Material chemistry sets the floor and geometry cannot overcome it: a flammable filament in a perfect shape still fails, and a rating held at 3 mm does not follow the material down to 1 mm.",
    source: UL94,
    verification: PENDING(UL_NOTE),
  },
  {
    id: "BC-007",
    topic: TOPIC,
    parameter: "design-uniform-wall",
    appliesTo: { process: "FDM", feature: "walls" },
    value: 0,
    units: "advisory-note",
    basis: "Keep wall thickness uniform at or above the floor — a part burns like its thinnest section, and thickness is one of the two dominant burn variables in the FAA's own findings.",
    source: { ...TN2365, section: "Dominant variables (material, thickness, infill)", paragraph: TN_UNCONFIRMED },
    verification: PENDING(TN_NOTE),
  },
  {
    id: "BC-008",
    topic: TOPIC,
    parameter: "design-no-thin-fins",
    appliesTo: { process: "FDM", feature: "fins, webs, ribs" },
    value: 0,
    units: "advisory-note",
    basis: "No free-standing fins or webs thinner than the floor — a thin web is a flame path; stiffen with ribs standing on full-thickness walls instead of spreading material into thin webs.",
    source: { ...TN2365, section: "Dominant variables (material, thickness, infill)", paragraph: TN_UNCONFIRMED },
    verification: PENDING(TN_NOTE),
  },
  {
    id: "BC-009",
    topic: TOPIC,
    parameter: "cert-context",
    appliesTo: { process: "any", scope: "every output of this library" },
    value: 0,
    units: "advisory-note",
    basis: "Nothing in this table certifies a part: 25.853(a) requires materials to meet the applicable test criteria prescribed in part I of appendix F — a physical specimen in a burn chamber — and this library only designs toward those findings.",
    source: FAR25853,
    verification: PENDING("25.853(a) wording confirmed from a fetched mirror 2026-07-23; operator confirms against the official CFR text."),
  },
]);

// ---------------------------------------------------------------------------
// Fail-closed lookups over this table. Same contract as lookup.mjs: any
// consulted PENDING_OPERATOR rule throws UnverifiedRuleError unless the
// caller opts into a draft, and every draft result carries the watermark.
// Every result additionally carries the advisory disclaimer — outputs of this
// table flag, they never certify.

const MATERIAL_RULES = Object.freeze({
  "ULTEM 9085": "BC-002",
  "PC-ABS-FR": "BC-003",
});

const MATERIAL_ALIASES = Object.freeze({
  "ultem 9085": "ULTEM 9085",
  "ultem-9085": "ULTEM 9085",
  "ultem9085": "ULTEM 9085",
  "pc-abs-fr": "PC-ABS-FR",
  "pc/abs-fr": "PC-ABS-FR",
  "pc-abs fr": "PC-ABS-FR",
  "pcabs-fr": "PC-ABS-FR",
});

/** Canonical material name, or null when the material has no listing here. */
export function canonicalMaterial(material) {
  if (typeof material !== "string" || !material.trim()) return null;
  return MATERIAL_ALIASES[material.trim().toLowerCase()] ?? null;
}

function getRule(table, id) {
  const rule = table.byId[id];
  if (!rule) throw new Error(`rule ${id} not found in table ${table.name}`);
  return rule;
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
  result.disclaimer = BURN_CERT_DISCLAIMER;
  result.verification = gate.verification;
  if (gate.draft) result.watermark = DRAFT_WATERMARK;
  return result;
}

/**
 * Minimum wall-thickness floor for a material. Materials with a UL listing in
 * this table get their listed floor (which may undercut the general floor —
 * that is the point of a material-specific listing); everything else gets the
 * general FR floor. The material-floor note (BC-006) always rides along:
 * chemistry first, geometry second.
 * @returns {{material: string, materialListed: boolean, floorMm: number, floorBasis: string, generalFloorMm: number, chemistryNote: string, citation: object, disclaimer: string, verification: object, watermark?: string}}
 */
export function minWallFloor({ material, allowDraft = false } = {}, table = burnCert) {
  const canonical = canonicalMaterial(material);
  const generalRule = getRule(table, "BC-001");
  const noteRule = getRule(table, "BC-006");
  const materialRule = canonical ? getRule(table, MATERIAL_RULES[canonical]) : null;
  const gate = consult(materialRule ? [generalRule, materialRule, noteRule] : [generalRule, noteRule], allowDraft);
  const generalFloorMm = ruleValue(generalRule);
  return finish(
    {
      material: canonical ?? (typeof material === "string" && material.trim() ? `${material.trim()} (unlisted)` : "unspecified"),
      materialListed: Boolean(materialRule),
      floorMm: materialRule ? ruleValue(materialRule) : generalFloorMm,
      floorBasis: materialRule
        ? `material-specific UL listing (${materialRule.id})`
        : "general FR floor — no material-specific listing in this table (BC-001)",
      generalFloorMm,
      chemistryNote: noteRule.basis,
      citation: {
        floor: citationOf(materialRule ?? generalRule),
        chemistry: citationOf(noteRule),
      },
    },
    gate,
  );
}

/**
 * Minimum infill percentage. Non-geometric: the CAD cannot enforce infill, so
 * this is a PACKAGE REQUIREMENT for the print recipe / traveler.
 * @returns {{percent: number, enforcement: string, citation: string, disclaimer: string, verification: object, watermark?: string}}
 */
export function minInfillPercent({ allowDraft = false } = {}, table = burnCert) {
  const rule = getRule(table, "BC-005");
  const gate = consult([rule], allowDraft);
  return finish(
    {
      percent: ruleValue(rule),
      enforcement: "print-time — package requirement; CAD geometry cannot enforce infill",
      citation: citationOf(rule),
    },
    gate,
  );
}

/**
 * The wall-vs-flame-time datum from TN23-65: the geometry-only improvement
 * the min-wall gate is built on.
 * @returns {{datumWallMm: number, claim: string, citation: string, disclaimer: string, verification: object, watermark?: string}}
 */
export function wallFlameTimeDatum({ allowDraft = false } = {}, table = burnCert) {
  const rule = getRule(table, "BC-004");
  const gate = consult([rule], allowDraft);
  return finish(
    {
      datumWallMm: ruleValue(rule),
      claim: rule.basis,
      citation: citationOf(rule),
    },
    gate,
  );
}

/**
 * Design rules the CAD can follow (uniform walls, no thin fins) plus the
 * certification-context note. Advisory text, not numbers.
 * @returns {{rules: {id: string, parameter: string, guidance: string, citation: string}[], disclaimer: string, verification: object, watermark?: string}}
 */
export function designRules({ allowDraft = false } = {}, table = burnCert) {
  const rules = ["BC-007", "BC-008", "BC-009"].map((id) => getRule(table, id));
  const gate = consult(rules, allowDraft);
  return finish(
    {
      rules: rules.map((r) => ({ id: r.id, parameter: r.parameter, guidance: r.basis, citation: citationOf(r) })),
    },
    gate,
  );
}

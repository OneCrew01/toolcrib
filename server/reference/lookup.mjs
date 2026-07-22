// Rule lookups over the fastening reference. FAIL-CLOSED: if any consulted
// rule is still PENDING_OPERATOR the lookup throws; callers may opt into a
// draft with { allowDraft: true }, and every draft result is watermarked.

import { citationOf, ruleValue, PENDING_OPERATOR, VERIFIED } from "./schema.mjs";
import { holeEdgeDistance } from "./tables/hole-edge-distance.mjs";

export const DRAFT_WATERMARK = "DRAFT — NOT VERIFIED";

export class UnverifiedRuleError extends Error {
  constructor(ruleIds) {
    super(
      `unverified rule(s): ${ruleIds.join(", ")} — awaiting operator sign-off ` +
        `(docs/VERIFICATION_LOG.md); pass { allowDraft: true } for a watermarked draft`,
    );
    this.name = "UnverifiedRuleError";
    this.ruleIds = ruleIds;
  }
}

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

// Gate + verification summary for the exact rules a lookup consulted.
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
 * Edge distance (hole center to nearest sheet edge) for a fastener diameter.
 * @returns {{minMm: number, preferredMm: number, citation: {min: string, preferred: string}, verification: object, watermark?: string}}
 */
export function edgeDistance({ fastenerDiaMm, headStyle, allowDraft = false } = {}, table = holeEdgeDistance) {
  positive(fastenerDiaMm, "fastenerDiaMm");
  const ids = { protruding: ["HED-001", "HED-003"], flush: ["HED-002", "HED-004"] }[headStyle];
  if (!ids) throw new RangeError(`headStyle must be "protruding" or "flush", got ${JSON.stringify(headStyle)}`);
  const [minRule, prefRule] = ids.map((id) => getRule(table, id));
  const gate = consult([minRule, prefRule], allowDraft);
  return finish(
    {
      minMm: ruleValue(minRule, { fastenerDiaMm }),
      preferredMm: ruleValue(prefRule, { fastenerDiaMm }),
      citation: { min: citationOf(minRule), preferred: citationOf(prefRule) },
    },
    gate,
  );
}

/**
 * Rivet pitch (center-to-center spacing within a row).
 * @returns {{minMm: number, typicalMinMm: number, typicalMaxMm: number, citation: object, verification: object, watermark?: string}}
 */
export function pitch({ fastenerDiaMm, allowDraft = false } = {}, table = holeEdgeDistance) {
  positive(fastenerDiaMm, "fastenerDiaMm");
  const [minRule, typMinRule, typMaxRule] = ["HED-005", "HED-006", "HED-007"].map((id) => getRule(table, id));
  const gate = consult([minRule, typMinRule, typMaxRule], allowDraft);
  return finish(
    {
      minMm: ruleValue(minRule, { fastenerDiaMm }),
      typicalMinMm: ruleValue(typMinRule, { fastenerDiaMm }),
      typicalMaxMm: ruleValue(typMaxRule, { fastenerDiaMm }),
      citation: {
        min: citationOf(minRule),
        typicalMin: citationOf(typMinRule),
        typicalMax: citationOf(typMaxRule),
      },
    },
    gate,
  );
}

/**
 * Transverse pitch (row-to-row spacing) given the in-row pitch.
 * @returns {{minMm: number, typicalMm: number, citation: object, verification: object, watermark?: string}}
 */
export function transversePitch({ fastenerDiaMm, pitchMm, allowDraft = false } = {}, table = holeEdgeDistance) {
  positive(fastenerDiaMm, "fastenerDiaMm");
  positive(pitchMm, "pitchMm");
  const [minRule, typRule] = ["HED-008", "HED-009"].map((id) => getRule(table, id));
  const gate = consult([minRule, typRule], allowDraft);
  return finish(
    {
      minMm: ruleValue(minRule, { fastenerDiaMm }),
      typicalMm: ruleValue(typRule, { pitchMm }),
      citation: { min: citationOf(minRule), typical: citationOf(typRule) },
    },
    gate,
  );
}

/**
 * Rule-of-thumb rivet diameter from the thicker sheet's thickness.
 * @returns {{diaMm: number, citation: string, verification: object, watermark?: string}}
 */
export function fastenerDiameter({ sheetThicknessMm, allowDraft = false } = {}, table = holeEdgeDistance) {
  positive(sheetThicknessMm, "sheetThicknessMm");
  const rule = getRule(table, "HED-010");
  const gate = consult([rule], allowDraft);
  return finish({ diaMm: ruleValue(rule, { sheetThicknessMm }), citation: citationOf(rule) }, gate);
}

/** Generic entry point: dispatches on query.parameter. */
export function resolve(query = {}, table = holeEdgeDistance) {
  const dispatch = {
    "edge-distance": edgeDistance,
    pitch,
    "transverse-pitch": transversePitch,
    "fastener-diameter": fastenerDiameter,
  };
  const fn = dispatch[query.parameter];
  if (!fn) throw new RangeError(`unknown parameter ${JSON.stringify(query.parameter)}; expected one of ${Object.keys(dispatch).join(", ")}`);
  return fn(query, table);
}

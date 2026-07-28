// Fastening reference schema — rules as data, citations as schema.
// Every value carries its source paragraph and a verification block. Encoded
// values are NOT trusted until a qualified person checks them against the
// printed text (docs/VERIFICATION_LOG.md); lookups are fail-closed until then.

/**
 * @typedef {object} RuleSource
 * @property {string} document        e.g. "AC 43.13-1B (Chg 1)"
 * @property {string} chapter
 * @property {string} section
 * @property {string} paragraph      exact paragraph, or "UNCONFIRMED — verify against printed AC"
 * @property {string} [figureOrTable]
 */

/**
 * @typedef {object} RuleVerification
 * @property {"PENDING_OPERATOR"|"VERIFIED"} status
 * @property {string|null} verifiedBy  initials / certificate number of the signer
 * @property {string|null} date        ISO date of sign-off
 * @property {string} [notes]
 */

/**
 * @typedef {object} RuleFormula
 * @property {(args: Record<string, number>) => number} fn
 * @property {string} text      plain-language form, e.g. "2 × fastener diameter"
 * @property {string[]} inputs  named args fn expects, e.g. ["fastenerDiaMm"]
 */

/**
 * @typedef {object} Rule
 * @property {string} id
 * @property {string} topic
 * @property {string} parameter
 * @property {Record<string, string>} appliesTo
 * @property {number} [value]        fixed value — exclusive with formula
 * @property {RuleFormula} [formula] computed value — exclusive with value
 * @property {string} units
 * @property {string} basis          one-sentence plain-English statement of the practice
 * @property {RuleSource} source
 * @property {RuleVerification} verification
 */

export const PENDING_OPERATOR = "PENDING_OPERATOR";
export const VERIFIED = "VERIFIED";

const STATUSES = new Set([PENDING_OPERATOR, VERIFIED]);

function deepFreeze(obj) {
  for (const v of Object.values(obj)) {
    if (v && (typeof v === "object" || typeof v === "function") && !Object.isFrozen(v)) deepFreeze(v);
  }
  return Object.freeze(obj);
}

function validateRule(rule) {
  for (const k of ["id", "topic", "parameter", "units", "basis"]) {
    if (typeof rule[k] !== "string" || !rule[k]) throw new TypeError(`rule ${rule.id ?? "?"}: missing ${k}`);
  }
  const hasValue = typeof rule.value === "number";
  const hasFormula = rule.formula != null;
  if (hasValue === hasFormula) throw new TypeError(`rule ${rule.id}: exactly one of value|formula required`);
  if (hasFormula && (typeof rule.formula.fn !== "function" || typeof rule.formula.text !== "string" || !Array.isArray(rule.formula.inputs))) {
    throw new TypeError(`rule ${rule.id}: formula needs fn, text, inputs`);
  }
  const s = rule.source;
  if (!s || [s.document, s.chapter, s.section, s.paragraph].some((f) => typeof f !== "string" || !f)) {
    throw new TypeError(`rule ${rule.id}: source needs document, chapter, section, paragraph`);
  }
  const v = rule.verification;
  if (!v || !STATUSES.has(v.status)) throw new TypeError(`rule ${rule.id}: verification.status must be PENDING_OPERATOR or VERIFIED`);
  if (v.status === VERIFIED && (!v.verifiedBy || !v.date)) {
    throw new TypeError(`rule ${rule.id}: VERIFIED requires verifiedBy and date`);
  }
}

/** Human-readable citation string for a rule. */
export function citationOf(rule) {
  const s = rule.source;
  let c = `${s.document}, Ch. ${s.chapter}, Sec. ${s.section}, para ${s.paragraph}`;
  if (s.figureOrTable) c += ` (${s.figureOrTable})`;
  return c;
}

/** Fixed value, or the formula applied to named args. */
export function ruleValue(rule, args = {}) {
  if (!rule.formula) return rule.value;
  for (const k of rule.formula.inputs) {
    const n = args[k];
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
      throw new RangeError(`${rule.id}: formula input ${k} must be a positive number`);
    }
  }
  return rule.formula.fn(args);
}

/**
 * Freeze and index a set of rules. Throws on malformed or duplicate rules.
 * @param {string} name
 * @param {Rule[]} rules
 */
export function makeTable(name, rules) {
  if (!name || !Array.isArray(rules) || rules.length === 0) throw new TypeError("makeTable(name, rules[]) requires a name and rules");
  const byId = {};
  const byParameter = {};
  for (const rule of rules) {
    validateRule(rule);
    if (byId[rule.id]) throw new TypeError(`duplicate rule id: ${rule.id}`);
    byId[rule.id] = rule;
    (byParameter[rule.parameter] ??= []).push(rule);
  }
  return deepFreeze({ name, rules, byId, byParameter });
}

// node --test "server/revision/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert";

import { makeTable, ruleValue, VERIFIED, PENDING_OPERATOR } from "../reference/schema.mjs";
import { UnverifiedRuleError, DRAFT_WATERMARK } from "../reference/lookup.mjs";
import { flushMountFit, fitClearance } from "../reference/tables/flush-mount-fit.mjs";
import {
  proposeAmendment,
  validateMeasurement,
  quantizeMm,
  OPERATOR_FLAG_WORDING,
  MM_DECIMALS,
  MAX_DEVIATION_MM,
} from "./amend.mjs";

// --- fixtures ---------------------------------------------------------------

const BAND_IDS = ["FMF-001", "FMF-002", "FMF-003", "FMF-004", "FMF-005", "FMF-006"];
const CHAMFER_IDS = ["FMF-007", "FMF-008"];
const ALL_IDS = flushMountFit.rules.map((r) => r.id);

/** The same rules with a chosen subset signed off — never the real table. */
const tableWith = (name, signedIds) =>
  makeTable(
    name,
    flushMountFit.rules.map((r) =>
      signedIds.includes(r.id)
        ? { ...r, verification: { status: VERIFIED, verifiedBy: "TEST", date: "2026-07-24" } }
        : r,
    ),
  );

const signedTable = tableWith("fmf-all-signed", ALL_IDS);
const bandsSignedTable = tableWith("fmf-bands-signed", BAND_IDS);
const chamferSignedTable = tableWith("fmf-chamfer-signed", CHAMFER_IDS);

const parent = () => ({
  title: "Flush-mount pair: 30x20 rect insert, rear lip, in a 60x40x3 panel",
  structuredIntent: {
    flushMount: {
      panel: { widthMm: 60, heightMm: 40, thicknessMm: 3 },
      opening: { shape: "rect", widthMm: 30, heightMm: 20 },
      clearancePerSideMm: 0.15,
      chamfer: { angleDeg: 45, depthMm: 0.8 },
      insert: { lipMm: 2 },
      colors: { panel: "#2e5e78", insert: "#e07a2f" },
    },
  },
  material: { name: "PETG", densityKgM3: 1270 },
  units: "mm",
  requester: "bench@example.com",
});

/** The bench story: opening printed 0.15 mm small, insert binds. */
const tightMeasurement = () => ({
  feature: "opening",
  dimension: "width",
  nominalMm: 30,
  measuredMm: 29.85,
  fit: "interference",
  targetFitClass: "sliding",
  measuredBy: "R. Vasquez",
  instrument: "digital caliper, 0.01 mm",
});

const propose = (over = {}, table) =>
  proposeAmendment(
    {
      parentRequest: parent(),
      measurement: { ...tightMeasurement(), ...over.measurement },
      ...(over.allowDraft === undefined ? {} : { allowDraft: over.allowDraft }),
      ...(over.parentRequest ? { parentRequest: over.parentRequest } : {}),
    },
    table,
  );

const draft = (over = {}, table = flushMountFit) => propose({ allowDraft: true, ...over }, table);

// --- RULING 1: the band is cited, the derivation is not ---------------------

/** Every node in the returned object that claims a basis, with its path. */
function basisNodes(root) {
  const out = [];
  const seen = new Set();
  const visit = (node, path) => {
    if (node === null || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach((v, i) => visit(v, `${path}[${i}]`));
      return;
    }
    if (Object.prototype.hasOwnProperty.call(node, "basis")) out.push({ path: path || "<root>", node });
    for (const [k, v] of Object.entries(node)) visit(v, path ? `${path}.${k}` : k);
  };
  visit(root, "");
  return out;
}

/**
 * The structural invariant: "cited" means an ENCODED ROW of the consulted
 * table holds exactly this number. Anything else is "computed". This walks
 * the whole returned object rather than spot-checking known fields, so a
 * cited label added to a new computed field is caught too.
 */
function assertCitationsHonest(result, table) {
  const nodes = basisNodes(result);
  assert.ok(nodes.length > 0, "no node carries a basis at all — the walk found nothing to check");

  let cited = 0;
  for (const { path, node } of nodes) {
    assert.ok(
      node.basis === "cited" || node.basis === "computed",
      `${path}.basis must be "cited" or "computed", got ${JSON.stringify(node.basis)}`,
    );
    if (node.basis !== "cited") continue;
    cited++;
    assert.strictEqual(typeof node.ruleId, "string", `${path} claims cited but carries no ruleId`);
    assert.strictEqual(typeof node.citation, "string", `${path} claims cited but carries no citation`);
    const rule = table.byId[node.ruleId];
    assert.ok(rule, `${path} cites ${node.ruleId}, which is not a row of ${table.name}`);
    assert.strictEqual(
      ruleValue(rule),
      node.valueMm,
      `${path} claims ${node.ruleId} encodes ${node.valueMm}, but that row holds ${ruleValue(rule)}`,
    );
  }
  assert.strictEqual(cited, 1, "exactly one node — the clearance band — may be cited");
}

test("RULING 1 (structural): every cited value is an encoded row, everything else is computed", () => {
  assertCitationsHonest(draft(), flushMountFit);
  assertCitationsHonest(draft({ measurement: { fit: "loose" } }), flushMountFit);
  assertCitationsHonest(draft({ measurement: { targetFitClass: "snug" } }), flushMountFit);
  assertCitationsHonest(
    proposeAmendment({ parentRequest: parent(), measurement: tightMeasurement() }, signedTable),
    signedTable,
  );
});

test("RULING 1: the derived fields are labelled computed, and the band is the table's own number", () => {
  const r = draft();
  assert.strictEqual(r.band.basis, "cited");
  assert.strictEqual(r.band.ruleId, "FMF-004"); // sliding max — an interference fit gets the roomy edge
  assert.strictEqual(r.band.valueMm, ruleValue(flushMountFit.byId["FMF-004"]));
  assert.strictEqual(r.processDeltaMm.basis, "computed");
  assert.strictEqual(r.amendedClearanceMm.basis, "computed");
  assert.strictEqual(r.amendedChamferDepthMm.basis, "computed");
});

test("RULING 1: the band midpoint is not an encoded value, so it can never be cited", () => {
  const mid = fitClearance({ class: "sliding", allowDraft: true }).perSideNominalMm;
  assert.strictEqual(mid, 0.225);
  const encoded = flushMountFit.rules.filter((r) => !r.formula).map((r) => r.value);
  assert.ok(!encoded.includes(mid), "0.225 must not be an encoded row value");
  for (const { node } of basisNodes(draft())) {
    if (node.basis === "cited") assert.notStrictEqual(node.valueMm, mid);
  }
});

test("RULING 1: a loose fit cites the tight band edge (min), an interference fit the roomy one (max)", () => {
  assert.strictEqual(draft().band.bound, "max");
  assert.strictEqual(draft({ measurement: { fit: "tight" } }).band.bound, "max");
  assert.strictEqual(draft({ measurement: { fit: "loose" } }).band.bound, "min");
  assert.strictEqual(draft({ measurement: { fit: "loose" } }).band.ruleId, "FMF-003");
});

// --- RULING 2: two independent warning strings ------------------------------

const disclaimerFor = (name) => OPERATOR_FLAG_WORDING.amendmentDisclaimer.replace("{reviewer}", name);

test("RULING 2: unsigned rows produce BOTH the unverified-rule warning and the disclaimer", () => {
  const r = draft();
  assert.ok(
    r.warnings.some((w) => w.startsWith("UNVERIFIED RULE:")),
    "the unverified-rule warning is missing while rows are PENDING",
  );
  assert.ok(r.warnings.includes(disclaimerFor("R. Vasquez")), "the amendment disclaimer is missing");
});

test("RULING 2: signing the rows removes the unverified warning and LEAVES the disclaimer", () => {
  const r = proposeAmendment({ parentRequest: parent(), measurement: tightMeasurement() }, signedTable);
  assert.strictEqual(r.verification.status, VERIFIED);
  assert.strictEqual(r.watermark, undefined);
  assert.ok(
    !r.warnings.some((w) => w.startsWith("UNVERIFIED RULE:")),
    "a signed table must not carry the unverified-rule warning",
  );
  assert.ok(
    r.warnings.includes(disclaimerFor("R. Vasquez")),
    "signing the FMF rows must NEVER leave a dimensional correction with no qualification at all",
  );
});

test("RULING 2: the disclaimer is independent — it survives every signing state", () => {
  const states = [
    [flushMountFit, true],
    [bandsSignedTable, true],
    [chamferSignedTable, true],
    [signedTable, false],
  ];
  for (const [table, needsDraft] of states) {
    const r = proposeAmendment(
      { parentRequest: parent(), measurement: tightMeasurement(), allowDraft: needsDraft },
      table,
    );
    assert.ok(r.warnings.includes(disclaimerFor("R. Vasquez")), `disclaimer missing for ${table.name}`);
    assert.ok(r.warnings.includes(OPERATOR_FLAG_WORDING.derivationUncited), `derivation note missing for ${table.name}`);
  }
});

test("RULING 2: the unverified warning names exactly the rows still pending", () => {
  const all = draft().warnings.find((w) => w.startsWith("UNVERIFIED RULE:"));
  for (const id of ["FMF-004", "FMF-007", "FMF-008"]) assert.match(all, new RegExp(id));

  // Bands signed, chamfer still pending: only the chamfer rows are named.
  const partial = proposeAmendment(
    { parentRequest: parent(), measurement: tightMeasurement(), allowDraft: true },
    bandsSignedTable,
  ).warnings.find((w) => w.startsWith("UNVERIFIED RULE:"));
  assert.match(partial, /FMF-007/);
  assert.match(partial, /FMF-008/);
  assert.ok(!/FMF-004/.test(partial), "a signed band row must not be reported as unverified");
});

test("RULING 2: the wording is one findable constant, and it says what it has to say", () => {
  assert.ok(Object.isFrozen(OPERATOR_FLAG_WORDING));
  const { unverifiedRule, amendmentDisclaimer, derivationUncited } = OPERATOR_FLAG_WORDING;
  for (const s of [unverifiedRule, amendmentDisclaimer, derivationUncited]) {
    assert.strictEqual(typeof s, "string");
    assert.ok(s.length > 80, "an operator-facing caveat that short is not a caveat");
  }
  assert.notStrictEqual(unverifiedRule, amendmentDisclaimer);
  assert.ok(unverifiedRule.includes("{ruleIds}"), "the unverified warning must name the rows");
  assert.ok(amendmentDisclaimer.includes("{reviewer}"), "the disclaimer must name a human");
  // "aviation standard but not grade": we build to a published standard and
  // never claim to have been graded against one.
  assert.match(amendmentDisclaimer, /not a certified/i);
  assert.match(amendmentDisclaimer, /graded/i);
  assert.match(amendmentDisclaimer, /accept/i);
});

test("RULING 2: the disclaimer names the human who took the reading", () => {
  const r = draft({ measurement: { measuredBy: "J. Okonkwo" } });
  assert.ok(r.warnings.some((w) => w.includes("J. Okonkwo")));
  assert.ok(!r.warnings.some((w) => w.includes("R. Vasquez")));
});

// --- RULING 3: fail closed, on BOTH lookups ---------------------------------

test("RULING 3: without allowDraft the band lookup fails closed", () => {
  assert.throws(
    () => proposeAmendment({ parentRequest: parent(), measurement: tightMeasurement() }),
    UnverifiedRuleError,
  );
  try {
    proposeAmendment({ parentRequest: parent(), measurement: tightMeasurement() });
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(e.ruleIds.includes("FMF-004"));
  }
});

test("RULING 3: allowDraft is threaded to the CHAMFER lookup too, not just the band", () => {
  // FMF-007/008 are PENDING like everything else. If allowDraft is not passed
  // to chamferFor, this throws halfway through composing the amendment.
  const r = draft();
  assert.strictEqual(r.watermark, DRAFT_WATERMARK);
  assert.strictEqual(r.verification.status, PENDING_OPERATOR);
  assert.ok(r.amendedChamferDepthMm.valueMm > 0, "the chamfer leg never completed");
  const ids = r.verification.rules.map((x) => x.id);
  assert.deepStrictEqual(ids, ["FMF-003", "FMF-004", "FMF-007", "FMF-008"]);
});

test("RULING 3: bands signed, chamfer pending, no allowDraft — the chamfer lookup still refuses", () => {
  try {
    proposeAmendment({ parentRequest: parent(), measurement: tightMeasurement() }, bandsSignedTable);
    assert.fail("should have thrown — FMF-007/008 are still PENDING");
  } catch (e) {
    assert.ok(e instanceof UnverifiedRuleError, `expected UnverifiedRuleError, got ${e.name}: ${e.message}`);
    assert.deepStrictEqual(e.ruleIds, ["FMF-007", "FMF-008"]);
  }
});

test("RULING 3: a fully signed table serves with no allowDraft and no watermark", () => {
  const r = proposeAmendment({ parentRequest: parent(), measurement: tightMeasurement() }, signedTable);
  assert.strictEqual(r.watermark, undefined);
  assert.strictEqual(r.verification.status, VERIFIED);
  assert.ok(r.verification.rules.every((x) => x.status === VERIFIED));
});

// --- the arithmetic ---------------------------------------------------------

test("arithmetic: the delta term is present and was applied to the band", () => {
  const r = draft();
  assert.strictEqual(r.processDeltaMm.valueMm, 0.075); // (30.000 - 29.850) / 2, quantized
  assert.notStrictEqual(r.processDeltaMm.valueMm, 0, "this fixture must exercise a non-zero delta");
  assert.strictEqual(
    r.amendedClearanceMm.valueMm,
    quantizeMm(r.band.valueMm + r.processDeltaMm.valueMm),
    "the amended clearance must be band + delta and nothing else",
  );
  assert.notStrictEqual(r.amendedClearanceMm.valueMm, r.band.valueMm, "a non-zero delta must move the number");
  assert.match(r.amendedClearanceMm.arithmetic, /FMF-004/);
  assert.match(r.processDeltaMm.arithmetic, /29\.850/);
});

test("arithmetic: a zero delta leaves the amended clearance EQUAL to the band — that is correct", () => {
  const r = draft({ measurement: { measuredMm: 30 } });
  assert.strictEqual(r.processDeltaMm.valueMm, 0);
  assert.strictEqual(r.amendedClearanceMm.valueMm, r.band.valueMm);
  assert.strictEqual(r.amendedClearanceMm.basis, "computed", "equal to the band is not the same as cited");
});

test("arithmetic: an oversize opening gives clearance back — the delta goes negative", () => {
  const r = draft({ measurement: { feature: "insert", nominalMm: 29.55, measuredMm: 29.5, fit: "loose" } });
  assert.strictEqual(r.processDeltaMm.valueMm, -0.025);
  assert.strictEqual(r.band.valueMm, 0.2); // sliding min
  assert.strictEqual(r.amendedClearanceMm.valueMm, quantizeMm(0.2 + -0.025));
  assert.ok(r.amendedClearanceMm.valueMm < r.band.valueMm);
});

test("arithmetic: values are quantized to a stated number of decimals", () => {
  assert.strictEqual(MM_DECIMALS, 3);
  assert.strictEqual(quantizeMm(0.2 + 0.09), 0.29);
  assert.strictEqual(quantizeMm(-0.0004), 0); // never -0
  assert.ok(Object.is(quantizeMm(-0.0004), 0));
  const r = draft();
  for (const v of [r.processDeltaMm.valueMm, r.amendedClearanceMm.valueMm, r.amendedChamferDepthMm.valueMm]) {
    assert.strictEqual(v, quantizeMm(v), `${v} is not quantized to ${MM_DECIMALS} dp`);
  }
});

test("arithmetic: the chamfer lead-in keeps up with the amended clearance", () => {
  // Parent depth 0.8 mm already clears the FMF-008 minimum for 0.325 mm/side.
  const kept = draft();
  assert.strictEqual(kept.amendedChamferDepthMm.valueMm, 0.8);
  assert.match(kept.amendedChamferDepthMm.arithmetic, /keeps it/);

  // A shallow parent chamfer is raised to the minimum the new clearance needs.
  const shallow = parent();
  shallow.structuredIntent.flushMount.chamfer.depthMm = 0.4;
  const raised = proposeAmendment(
    { parentRequest: shallow, measurement: tightMeasurement(), allowDraft: true },
    flushMountFit,
  );
  assert.strictEqual(raised.amendedChamferDepthMm.valueMm, 0.65); // 2 x 0.325, above the 0.6 floor
  assert.match(raised.amendedChamferDepthMm.arithmetic, /raises it/);
  assert.ok(raised.amendedChamferDepthMm.valueMm >= 2 * raised.amendedClearanceMm.valueMm);
});

// --- the amended request ----------------------------------------------------

test("the amended request is the parent with the fit parameters changed and nothing else", () => {
  const before = parent();
  const r = draft();
  const spec = r.amendedRequest.structuredIntent.flushMount;
  assert.strictEqual(spec.clearancePerSideMm, r.amendedClearanceMm.valueMm);
  assert.strictEqual(spec.chamfer.depthMm, r.amendedChamferDepthMm.valueMm);
  assert.strictEqual(spec.chamfer.angleDeg, 45);
  assert.deepStrictEqual(spec.panel, before.structuredIntent.flushMount.panel);
  assert.deepStrictEqual(spec.opening, before.structuredIntent.flushMount.opening);
  assert.deepStrictEqual(spec.colors, before.structuredIntent.flushMount.colors);
  assert.deepStrictEqual(spec.insert, before.structuredIntent.flushMount.insert);
  assert.strictEqual(r.amendedRequest.title, before.title);
  assert.strictEqual(r.amendedRequest.requester, before.requester);
  assert.deepStrictEqual(r.amendedRequest.material, before.material);
});

test("the parent request is never mutated, and keys this module does not read ride along", () => {
  const p = parent();
  p.expectedMassG = { minG: 1, maxG: 2 };
  const r = proposeAmendment({ parentRequest: p, measurement: tightMeasurement(), allowDraft: true });
  assert.strictEqual(p.structuredIntent.flushMount.clearancePerSideMm, 0.15, "the parent was mutated");
  assert.strictEqual(p.structuredIntent.flushMount.chamfer.depthMm, 0.8, "the parent was mutated");
  assert.deepStrictEqual(r.amendedRequest.expectedMassG, { minG: 1, maxG: 2 });
});

test("the amended request is a VALID generation request", async () => {
  const { validateGenerationRequest } = await import("../state/request.mjs");
  const r = draft();
  assert.strictEqual(validateGenerationRequest(r.amendedRequest).ok, true);
});

test("a request with no flush-mount spec has nothing to amend", () => {
  const prose = { ...parent(), structuredIntent: undefined, prompt: "a 50mm plate with four holes" };
  assert.throws(
    () => proposeAmendment({ parentRequest: prose, measurement: tightMeasurement(), allowDraft: true }),
    /no flush-mount spec/,
  );
});

test("an invalid parent request is refused before anything is measured", () => {
  const bad = parent();
  delete bad.material;
  assert.throws(
    () => proposeAmendment({ parentRequest: bad, measurement: tightMeasurement(), allowDraft: true }),
    /not a valid generation request/,
  );
});

test("the bare structuredIntent shape the flushmount backend accepts is amendable too", () => {
  const bare = parent();
  bare.structuredIntent = bare.structuredIntent.flushMount;
  const r = proposeAmendment({ parentRequest: bare, measurement: tightMeasurement(), allowDraft: true });
  assert.strictEqual(r.amendedRequest.structuredIntent.clearancePerSideMm, 0.325);
  assert.strictEqual(r.amendedRequest.structuredIntent.flushMount, undefined);
});

// --- the measurement contract ----------------------------------------------

test("measurement: unknown keys are rejected, not ignored", () => {
  assert.throws(() => validateMeasurement({ ...tightMeasurement(), temperatureC: 21 }), /unknown key\(s\): temperatureC/);
  assert.throws(() => draft({ measurement: { nominalMM: 30 } }), /unknown key/);
});

test("measurement: missing required fields are named", () => {
  const m = tightMeasurement();
  delete m.measuredBy;
  delete m.fit;
  assert.throws(() => validateMeasurement(m), /missing: fit, measuredBy/);
  assert.throws(() => validateMeasurement(null), TypeError);
  assert.throws(() => validateMeasurement([]), TypeError);
});

test("measurement: non-finite and out-of-range numbers are refused", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, "29.85", null]) {
    assert.throws(() => validateMeasurement({ ...tightMeasurement(), measuredMm: bad }));
  }
  assert.throws(() => validateMeasurement({ ...tightMeasurement(), nominalMm: 0 }), RangeError);
  assert.throws(() => validateMeasurement({ ...tightMeasurement(), nominalMm: -30 }), RangeError);
  assert.throws(() => validateMeasurement({ ...tightMeasurement(), nominalMm: 5000, measuredMm: 5000 }), RangeError);
});

test("measurement: an absurd deviation is the wrong part, not a process delta", () => {
  assert.throws(
    () => validateMeasurement({ ...tightMeasurement(), measuredMm: 25 }),
    /wrong part on the bench/,
  );
  // The cap is the tighter of 2 mm and 10% of nominal.
  assert.throws(() => validateMeasurement({ ...tightMeasurement(), nominalMm: 10, measuredMm: 8.5 }), RangeError);
  assert.ok(validateMeasurement({ ...tightMeasurement(), measuredMm: 29.2 }));
  assert.strictEqual(MAX_DEVIATION_MM, 2);
});

test('measurement: fit "good" is refused — an amendment corrects a fit that did not work', () => {
  assert.throws(() => validateMeasurement({ ...tightMeasurement(), fit: "good" }), /needs no amendment/);
  assert.throws(() => validateMeasurement({ ...tightMeasurement(), fit: "snug" }), /must be one of/);
});

test("measurement: feature, dimension and fit class are closed vocabularies", () => {
  assert.throws(() => validateMeasurement({ ...tightMeasurement(), feature: "panel" }), /must be one of/);
  assert.throws(() => validateMeasurement({ ...tightMeasurement(), dimension: "depth" }), /must be one of/);
  assert.throws(() => draft({ measurement: { targetFitClass: "interference" } }), RangeError);
  assert.throws(() => validateMeasurement({ ...tightMeasurement(), targetFitClass: "  " }), RangeError);
  assert.throws(() => validateMeasurement({ ...tightMeasurement(), measuredBy: "" }), /measuredBy/);
});

test("measurement: fit-class aliases resolve, and the canonical class is echoed back", () => {
  assert.strictEqual(draft({ measurement: { targetFitClass: "smooth-sliding" } }).fitClass, "sliding");
  assert.strictEqual(draft({ measurement: { targetFitClass: "press" } }).fitClass, "snug");
  assert.strictEqual(draft({ measurement: { targetFitClass: "service" } }).fitClass, "loose");
});

test("measurement: the normalised copy is echoed back, trimmed", () => {
  const r = draft({ measurement: { measuredBy: "  R. Vasquez  ", targetFitClass: " sliding " } });
  assert.strictEqual(r.measurement.measuredBy, "R. Vasquez");
  assert.strictEqual(r.measurement.instrument, "digital caliper, 0.01 mm");
  const bare = validateMeasurement({ ...tightMeasurement(), instrument: undefined });
  assert.ok(!("instrument" in bare));
});

// --- refusals that protect the generator ------------------------------------

test("a clearance that consumes the opening, or the panel wall, is refused", () => {
  const thin = parent();
  thin.structuredIntent.flushMount.opening = { shape: "rect", widthMm: 0.5, heightMm: 0.5 };
  assert.throws(
    () => proposeAmendment({ parentRequest: thin, measurement: tightMeasurement(), allowDraft: true }),
    /consumes the/,
  );

  const shallowPanel = parent();
  shallowPanel.structuredIntent.flushMount.panel.thicknessMm = 0.7;
  shallowPanel.structuredIntent.flushMount.chamfer.depthMm = 0.3;
  assert.throws(
    () => proposeAmendment({ parentRequest: shallowPanel, measurement: tightMeasurement(), allowDraft: true }),
    /straight\s+opening wall/,
  );
});

// --- purity -----------------------------------------------------------------

test("pure and deterministic: same inputs, same object", () => {
  assert.deepStrictEqual(draft(), draft());
  assert.deepStrictEqual(
    proposeAmendment({ parentRequest: parent(), measurement: tightMeasurement() }, signedTable),
    proposeAmendment({ parentRequest: parent(), measurement: tightMeasurement() }, signedTable),
  );
});

// node --test "server/revision/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert";

import { makeTable, ruleValue, VERIFIED, PENDING_OPERATOR } from "../reference/schema.mjs";
import { UnverifiedRuleError, DRAFT_WATERMARK } from "../reference/lookup.mjs";
import { flushMountFit, fitClearance } from "../reference/tables/flush-mount-fit.mjs";
import { generateFlushMountPair } from "../generators/flushmount.mjs";
import {
  proposeAmendment,
  validateMeasurement,
  quantizeMm,
  fillWording,
  OPERATOR_FLAG_WORDING,
  FIT_CLASSES,
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

/** The other bench story, and a coherent one: opening printed large, insert rattles. */
const looseMeasurement = () => ({ ...tightMeasurement(), measuredMm: 30.15, fit: "loose" });

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

/** The units-suffixed keys a value-bearing node may state. */
const VALUE_KEYS = ["valueMm", "valueDeg"];

/** Exactly the paths allowed to say "cited". Adding one is a deliberate act. */
const CITED_PATHS = ["amendedChamferAngleDeg", "band"];

/**
 * The structural invariant: "cited" means an ENCODED ROW of the consulted
 * table holds exactly this number. Anything else is "computed". This walks
 * the whole returned object rather than spot-checking known fields, so a
 * cited label added to a new computed field is caught too.
 */
function assertCitationsHonest(result, table) {
  const nodes = basisNodes(result);
  assert.ok(nodes.length > 0, "no node carries a basis at all — the walk found nothing to check");

  const cited = [];
  for (const { path, node } of nodes) {
    assert.ok(
      node.basis === "cited" || node.basis === "computed",
      `${path}.basis must be "cited" or "computed", got ${JSON.stringify(node.basis)}`,
    );
    if (node.basis !== "cited") continue;
    cited.push(path);
    assert.strictEqual(typeof node.ruleId, "string", `${path} claims cited but carries no ruleId`);
    assert.strictEqual(typeof node.citation, "string", `${path} claims cited but carries no citation`);
    const rule = table.byId[node.ruleId];
    assert.ok(rule, `${path} cites ${node.ruleId}, which is not a row of ${table.name}`);
    // A cited node states ONE number, under a units-suffixed key, and that
    // number is what the row encodes — byte-identical, never quantized.
    const stated = VALUE_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(node, k));
    assert.strictEqual(
      stated.length,
      1,
      `${path} claims cited but states ${stated.length} of ${VALUE_KEYS.join("/")} — a cited node carries exactly one number`,
    );
    assert.strictEqual(
      ruleValue(rule),
      node[stated[0]],
      `${path} claims ${node.ruleId} encodes ${node[stated[0]]}, but that row holds ${ruleValue(rule)}`,
    );
  }
  assert.deepStrictEqual(
    cited.sort(),
    CITED_PATHS,
    "only the clearance band and the lead-in angle may be cited — everything else is our arithmetic",
  );
}

test("RULING 1 (structural): every cited value is an encoded row, everything else is computed", () => {
  assertCitationsHonest(draft(), flushMountFit);
  assertCitationsHonest(draft({ measurement: looseMeasurement() }), flushMountFit);
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
  assert.strictEqual(draft({ measurement: looseMeasurement() }).band.bound, "min");
  assert.strictEqual(draft({ measurement: looseMeasurement() }).band.ruleId, "FMF-003");
});

// --- RULING 2: two independent warning strings ------------------------------

const disclaimerFor = (name) => fillWording(OPERATOR_FLAG_WORDING.amendmentDisclaimer, { reviewer: name });

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
  // EVERY operator-facing string lives in this one constant — an operator
  // rewriting the voice must not have to find a sixth one hiding in the code.
  for (const [name, s] of Object.entries(OPERATOR_FLAG_WORDING)) {
    assert.strictEqual(typeof s, "string", name);
    assert.ok(s.length > 80, `${name}: an operator-facing caveat that short is not a caveat`);
    assert.match(s, /^[A-Z][A-Z ,'-]+:/, `${name}: every caveat leads with what it is`);
  }
  assert.notStrictEqual(unverifiedRule, amendmentDisclaimer);
  assert.ok(unverifiedRule.includes("{ruleIds}"), "the unverified warning must name the rows");
  assert.ok(amendmentDisclaimer.includes("{reviewer}"), "the disclaimer must name a human");
  // "aviation standard but not grade": we build to a published standard and
  // never claim to have been graded against one.
  //
  // This used to assert /not a certified/, which pinned the denial to a word a
  // stranger with a 3D printer would have to look up — and the reader this repo
  // is written for is exactly that stranger. The property being tested is that
  // the disclaimer says nobody has checked it; the assertion now tests that,
  // and refuses the certification vocabulary coming back in.
  assert.match(amendmentDisclaimer, /nobody has checked it/i);
  assert.ok(
    !/certif/i.test(amendmentDisclaimer),
    "the amendment disclaimer denies itself in certification vocabulary again",
  );
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

test("arithmetic: an undersize insert gives clearance back — the delta goes negative", () => {
  // The parent models the insert at 30 - 2 x 0.15 = 29.70 mm; it printed 0.05 mm small.
  const r = draft({ measurement: { feature: "insert", nominalMm: 29.7, measuredMm: 29.65, fit: "loose" } });
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

test("measurement: targetFitClass is checked BY the exported validator, not by a module two away", () => {
  // The exported validator is the contract. It must not hand back a
  // measurement carrying a class nobody checked — the eventual refusal came
  // from fitClearance and named a parameter ("class") that does not appear in
  // the measurement contract at all, so an operator reading it went looking
  // for a field they never typed.
  for (const bad of ["banana", "", "  ", "SNUG", 7, null]) {
    assert.throws(
      () => validateMeasurement({ ...tightMeasurement(), targetFitClass: bad }),
      /measurement\.targetFitClass/,
      `targetFitClass ${JSON.stringify(bad)} was returned unchecked`,
    );
  }
  // undefined is the ABSENT case and is reported as absent, by name.
  assert.throws(
    () => validateMeasurement({ ...tightMeasurement(), targetFitClass: undefined }),
    /missing: targetFitClass/,
  );
  assert.throws(
    () => validateMeasurement({ ...tightMeasurement(), targetFitClass: "banana" }),
    /must be one of snug, press, sliding, smooth-sliding, loose, service/,
  );

  // And the vocabulary this module promises is one the table still serves.
  for (const name of FIT_CLASSES) {
    assert.ok(validateMeasurement({ ...tightMeasurement(), targetFitClass: name }));
    assert.doesNotThrow(
      () => fitClearance({ class: name, allowDraft: true }),
      `${name} is offered by this module but fitClearance no longer serves it`,
    );
  }
});

test("measurement: instrument, when given, has to be a usable string", () => {
  for (const bad of [12, "", "   ", null, true, {}]) {
    assert.throws(
      () => validateMeasurement({ ...tightMeasurement(), instrument: bad }),
      /measurement\.instrument, when given, must be a non-empty string/,
      `instrument ${JSON.stringify(bad)} was accepted`,
    );
  }
  assert.strictEqual(validateMeasurement({ ...tightMeasurement(), instrument: " calipers " }).instrument, "calipers");
});

test("an amended clearance that works out at zero or below is refused in this module's own words", () => {
  // Reachable: a snug band (0.10 min) minus a 1.0 mm process delta. Without
  // this guard the operator gets "clearanceMm must be a positive number" out of
  // chamferFor — a message naming an internal argument, from two modules away.
  let err;
  try {
    draft({ measurement: { nominalMm: 30, measuredMm: 32, fit: "loose", targetFitClass: "snug" } });
    assert.fail("a negative clearance must not be proposed");
  } catch (e) {
    err = e;
  }
  assert.match(err.message, /the amended clearance works out at -0\.900 mm per side/);
  assert.ok(!/clearanceMm must be a positive number/.test(err.message), err.message);
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

// --- would it generate? -----------------------------------------------------

test("every proposal is run through the real generator before it is offered", () => {
  const r = draft();
  assert.doesNotThrow(() => generateFlushMountPair(r.amendedRequest.structuredIntent.flushMount));
});

test("an amendment that breaks a parent the generator ACCEPTS is refused, and says so", () => {
  // A 4 mm opening: at the parent's 0.15 mm/side the chamfer run clears the
  // insert centerline, at the amended 0.30 mm/side it does not. This gate is
  // the generator's alone — the module models none of the eight itself, so a
  // hand-rolled subset can never drift out of date against it.
  const small = parent();
  small.structuredIntent.flushMount.opening = { shape: "rect", widthMm: 4, heightMm: 4 };
  small.structuredIntent.flushMount.insert = { lipMm: 0 };
  assert.doesNotThrow(
    () => generateFlushMountPair(small.structuredIntent.flushMount),
    "fixture is wrong: the PARENT must generate for this test to mean anything",
  );

  let err;
  try {
    proposeAmendment(
      {
        parentRequest: small,
        measurement: { ...tightMeasurement(), nominalMm: 4, measuredMm: 3.9 },
        allowDraft: true,
      },
      flushMountFit,
    );
    assert.fail("a proposal the generator would refuse must not be offered");
  } catch (e) {
    err = e;
  }
  assert.match(err.message, /this amendment would not generate/);
  assert.match(err.message, /crosses the insert centerline/, "the generator's own gate must be quoted");
});

test("a lead-in the amendment raises past the panel wall is refused by the generator", () => {
  const shallowPanel = parent();
  shallowPanel.structuredIntent.flushMount.panel.thicknessMm = 0.7;
  shallowPanel.structuredIntent.flushMount.chamfer.depthMm = 0.3;
  assert.doesNotThrow(() => generateFlushMountPair(shallowPanel.structuredIntent.flushMount));
  assert.throws(
    () => proposeAmendment({ parentRequest: shallowPanel, measurement: tightMeasurement(), allowDraft: true }),
    /straight\s+opening wall/,
  );
});

test("a parent that does not generate is named as the fault, not blamed on the amendment", () => {
  // The parent's OWN 2.9 mm chamfer already fails the 0.2 mm wall rule in a
  // 3 mm panel. The amendment computes a 0.65 mm lead-in and merely carries
  // the parent's deeper number through max(), so blaming "the lead-in this
  // clearance needs" would name a cause that is not the cause.
  const deep = parent();
  deep.structuredIntent.flushMount.chamfer.depthMm = 2.9;
  assert.throws(() => generateFlushMountPair(deep.structuredIntent.flushMount));

  let err;
  try {
    proposeAmendment({ parentRequest: deep, measurement: tightMeasurement(), allowDraft: true });
    assert.fail("should have thrown");
  } catch (e) {
    err = e;
  }
  assert.match(err.message, /the parent request does not generate as it stands/);
  assert.ok(
    !/this clearance needs/.test(err.message),
    "the refusal must not blame the amendment for a chamfer the parent already carried",
  );
});

test("a spec too thin to generate is refused rather than dressed up as a valid request", () => {
  // Previously both hand-rolled guards silently no-opped on a spec with no
  // dimensions, and the chamfer merge dropped angleDeg, so this returned a
  // confident proposal the generator rejects outright.
  const hollow = parent();
  hollow.structuredIntent.flushMount = { panel: {}, opening: {} };
  assert.throws(
    () => proposeAmendment({ parentRequest: hollow, measurement: tightMeasurement(), allowDraft: true }),
    /does not state a shape/,
  );

  // A parent with no chamfer at all is refused by NAME, before the generator
  // is asked — the module reads the parent's lead-in the same way it reads the
  // opening, and a value it cannot read is one it must not quote. The
  // generator agrees with the verdict; it just is not the one that reaches it.
  const noChamfer = parent();
  delete noChamfer.structuredIntent.flushMount.chamfer;
  assert.throws(() => generateFlushMountPair(noChamfer.structuredIntent.flushMount));
  assert.throws(
    () => proposeAmendment({ parentRequest: noChamfer, measurement: tightMeasurement(), allowDraft: true }),
    /does not state a positive numeric chamfer\.angleDeg/,
  );
});

test("an unbuildable parent is named even when the amendment would repair it", () => {
  // A 0.4 mm lead-in under a 0.25 mm/side clearance breaks the generator's
  // "lead-in >= 2 x clearance" rule. The amendment raises the lead-in to
  // 0.65 mm and therefore GENERATES — so a module that only tries the parent
  // when the amendment fails silently repairs a request that was never
  // buildable, and never says so. The parent is asked first, always.
  const broken = parent();
  broken.structuredIntent.flushMount.clearancePerSideMm = 0.25;
  broken.structuredIntent.flushMount.chamfer = { angleDeg: 45, depthMm: 0.4 };
  assert.throws(
    () => generateFlushMountPair(broken.structuredIntent.flushMount),
    /must be >= 2 x clearancePerSideMm/,
    "fixture is wrong: the PARENT must be unbuildable for this test to mean anything",
  );

  let err;
  try {
    proposeAmendment({ parentRequest: broken, measurement: tightMeasurement(), allowDraft: true });
    assert.fail("a request that never generated was never printed, so there is nothing to amend");
  } catch (e) {
    err = e;
  }
  assert.match(err.message, /the parent request does not generate as it stands/);
  assert.match(err.message, /must be >= 2 x clearancePerSideMm/, "the generator's own words, verbatim");

  // And the repair it would have offered is real, which is what makes the
  // silent version dangerous rather than merely untidy.
  const repaired = { ...broken.structuredIntent.flushMount, clearancePerSideMm: 0.325, chamfer: { angleDeg: 45, depthMm: 0.65 } };
  assert.doesNotThrow(() => generateFlushMountPair(repaired));
});

// --- the parent's own numbers are read, never invented -----------------------

test("the parent's lead-in is read like every other parent value: stated, or refused", () => {
  for (const chamfer of [
    { angleDeg: 45, depthMm: "0.8" }, // a hand-written JSON request — nothing upstream type-checks in here
    { angleDeg: 45, depthMm: 0 },
    { angleDeg: 45, depthMm: -0.8 },
    { angleDeg: 45, depthMm: Number.NaN },
    { angleDeg: 45 },
  ]) {
    const p = parent();
    p.structuredIntent.flushMount.chamfer = chamfer;
    assert.throws(
      () => proposeAmendment({ parentRequest: p, measurement: tightMeasurement(), allowDraft: true }),
      /does not state a positive numeric chamfer\.depthMm/,
      `chamfer ${JSON.stringify(chamfer)} was accepted`,
    );
  }
  for (const chamfer of [{ depthMm: 0.8 }, { angleDeg: "45", depthMm: 0.8 }, { angleDeg: 0, depthMm: 0.8 }]) {
    const p = parent();
    p.structuredIntent.flushMount.chamfer = chamfer;
    assert.throws(
      () => proposeAmendment({ parentRequest: p, measurement: tightMeasurement(), allowDraft: true }),
      /does not state a positive numeric chamfer\.angleDeg/,
      `chamfer ${JSON.stringify(chamfer)} was accepted`,
    );
  }
});

test("the shown work quotes the parent's real lead-in, not a substituted zero", () => {
  // The failure this pins: a `?? 0` fallback printed "the parent's chamfer
  // depth is 0.000 mm" — a fabricated fact about the operator's part, narrated
  // as arithmetic, in a module whose whole value is checkable shown work.
  const said = draft().amendedChamferDepthMm.arithmetic;
  assert.match(said, /the parent states 0\.800 mm/);
  assert.ok(!/0\.000 mm/.test(said), said);

  const shallow = parent();
  shallow.structuredIntent.flushMount.chamfer.depthMm = 0.4;
  const raised = proposeAmendment(
    { parentRequest: shallow, measurement: tightMeasurement(), allowDraft: true },
  ).amendedChamferDepthMm.arithmetic;
  assert.match(raised, /the parent states 0\.400 mm/);
});

// --- the cited lead-in angle is applied, not just blocked on -----------------

test("the cited lead-in angle is written into the amendment, not consulted and discarded", () => {
  // FMF-007 gates this module fail-closed and is named in the unverified-rule
  // warning. A row the operator is told to go verify must be a row the
  // proposal actually leaned on.
  const angled = parent();
  angled.structuredIntent.flushMount.chamfer = { angleDeg: 30, depthMm: 0.8 };
  const r = proposeAmendment({ parentRequest: angled, measurement: tightMeasurement(), allowDraft: true });

  const angleRow = flushMountFit.rules.find((x) => x.parameter === "chamfer-lead-in-angle");
  assert.strictEqual(r.amendedChamferAngleDeg.valueDeg, ruleValue(angleRow));
  assert.strictEqual(r.amendedChamferAngleDeg.ruleId, angleRow.id);
  assert.strictEqual(r.amendedChamferAngleDeg.basis, "cited");
  assert.strictEqual(
    r.amendedRequest.structuredIntent.flushMount.chamfer.angleDeg,
    ruleValue(angleRow),
    "the cited angle must reach the amended request",
  );
  assert.match(r.warnings.find((w) => w.startsWith("UNVERIFIED RULE:")), new RegExp(angleRow.id));
});

// --- the reading has to describe the parent ---------------------------------

test("a nominal the parent does not hold is arithmetic about a different part", () => {
  // 0.15 mm out of a 12 mm nominal is inside the deviation cap, so nothing in
  // the measurement itself objects — only the parent can catch this.
  assert.throws(
    () => draft({ measurement: { nominalMm: 12, measuredMm: 11.85 } }),
    /the parent models that opening width at 30\.000 mm/,
  );
  assert.throws(() => draft({ measurement: { nominalMm: 29.9, measuredMm: 29.85 } }), /different part/);
});

test("the agreement tolerance is one number, and a refusal at the boundary is legible", () => {
  // The rule is |nominal - modelled| <= half a quantization step. Both sides
  // of the boundary, against a parent modelling exactly 30 mm.
  assert.ok(draft({ measurement: { nominalMm: 30.0005, measuredMm: 29.8505 } }));
  assert.ok(draft({ measurement: { nominalMm: 29.9995, measuredMm: 29.8495 } }));

  let err;
  try {
    draft({ measurement: { nominalMm: 30.0006, measuredMm: 29.8506 } });
    assert.fail("0.0006 mm is past the tolerance and must be refused");
  } catch (e) {
    err = e;
  }
  // Both numbers render at 3 dp, so without the difference the operator reads
  // "30.001 vs 30.000" and is told a one-micron disagreement is fatal. The
  // message states the actual gap and the actual limit.
  assert.match(err.message, /differ by 0\.0006 mm/);
  assert.match(err.message, /over the 0\.0005 mm this module accepts/);
});

test("an insert nominal is checked against opening - 2 x clearance, not against the opening", () => {
  const insertMeasurement = { feature: "insert", nominalMm: 29.7, measuredMm: 29.65, fit: "loose" };
  assert.ok(draft({ measurement: insertMeasurement }));
  assert.throws(
    () => draft({ measurement: { ...insertMeasurement, nominalMm: 30 } }),
    /the parent models that insert width at 29\.700 mm/,
  );

  const noClearance = parent();
  delete noClearance.structuredIntent.flushMount.clearancePerSideMm;
  assert.throws(
    () =>
      proposeAmendment(
        { parentRequest: noClearance, measurement: { ...tightMeasurement(), ...insertMeasurement }, allowDraft: true },
        flushMountFit,
      ),
    /does not state a positive clearancePerSideMm/,
  );
});

test("an opening shape this module cannot amend is refused as such, not as a missing field", () => {
  const withShape = (shape) => {
    const p = parent();
    p.structuredIntent.flushMount.opening = { shape, widthMm: 30, heightMm: 20 };
    return () => proposeAmendment({ parentRequest: p, measurement: tightMeasurement(), allowDraft: true });
  };

  // A shape that collides with Object.prototype must read as an unknown shape,
  // not as an inherited function the next line calls .includes on. That crashed
  // with a raw TypeError out of a module that turns every other bad input into
  // a sentence a human can act on.
  for (const hostile of ["toString", "constructor", "hasOwnProperty", "valueOf"]) {
    assert.throws(withShape(hostile), RangeError, `shape "${hostile}" did not produce a domain error`);
    assert.throws(withShape(hostile), new RegExp(`states shape "${hostile}"`));
  }

  // A genuinely unsupported shape: the parent DOES state one, so a message
  // saying it states none sends the operator looking for a field that is there.
  assert.throws(withShape("oval"), /states shape "oval", which this module cannot amend/);
  assert.throws(withShape("oval"), /only "rect" and "round" openings are supported/);

  // Absent is still absent, and still says so.
  const bare = parent();
  bare.structuredIntent.flushMount.opening = { widthMm: 30, heightMm: 20 };
  assert.throws(
    () => proposeAmendment({ parentRequest: bare, measurement: tightMeasurement(), allowDraft: true }),
    /does not state a shape/,
  );
});

test("a dimension the opening shape does not have is refused", () => {
  assert.throws(() => draft({ measurement: { dimension: "diameter" } }), /does not exist on a rect opening/);

  const round = parent();
  round.structuredIntent.flushMount.opening = { shape: "round", diameterMm: 30 };
  const ok = proposeAmendment(
    { parentRequest: round, measurement: { ...tightMeasurement(), dimension: "diameter" }, allowDraft: true },
    flushMountFit,
  );
  assert.strictEqual(ok.amendedClearanceMm.valueMm, 0.325);
  assert.throws(
    () =>
      proposeAmendment(
        { parentRequest: round, measurement: tightMeasurement(), allowDraft: true },
        flushMountFit,
      ),
    /does not exist on a round opening/,
  );
});

// --- the two situational warnings -------------------------------------------

test("a reading that contradicts the reported fit is said out loud, not smoothed over", () => {
  // "It binds" + an opening that measured OVERSIZE: the arithmetic still runs,
  // but it moves the clearance the opposite way from the symptom.
  const r = draft({ measurement: { measuredMm: 30.15 } });
  assert.strictEqual(r.processDeltaMm.valueMm, -0.075);
  assert.ok(r.amendedClearanceMm.valueMm < r.band.valueMm);
  const said = r.warnings.find((w) => w.startsWith("THE READING AND THE FIT DISAGREE:"));
  assert.ok(said, "a proposal that moves away from the reported symptom must say so");
  assert.match(said, /interference/);
  assert.match(said, /gave clearance back/);

  // The coherent stories carry no such warning.
  for (const m of [tightMeasurement(), looseMeasurement()]) {
    assert.ok(!draft({ measurement: m }).warnings.some((w) => w.startsWith("THE READING AND THE FIT DISAGREE:")));
  }
});

test("a clearance that leaves the band it cites reports that, in prose and as a boolean", () => {
  const out = draft(); // 0.25 (sliding max) + 0.075 = 0.325, above the 0.20-0.25 band
  assert.strictEqual(out.amendedClearanceMm.withinCitedBand, false);
  const note = out.warnings.find((w) => w.startsWith("OUTSIDE THE BAND IT CITES:"));
  assert.ok(note, "a proposal outside its own cited band must say so");
  assert.match(note, /0\.325/);
  assert.match(note, /sliding/);
  assert.match(note, /FMF-003/);
  assert.match(note, /FMF-004/);

  // The other direction leaves the band the other way: a loose fit corrected
  // downward lands BELOW the class minimum, and says so.
  const under = draft({ measurement: looseMeasurement() }); // 0.20 - 0.075 = 0.125
  assert.strictEqual(under.amendedClearanceMm.valueMm, 0.125);
  assert.strictEqual(under.amendedClearanceMm.withinCitedBand, false);

  // A zero delta lands exactly on the cited edge and says nothing. Note this
  // is the ONLY coherent case that does: the band edge is chosen in the same
  // direction the delta then pushes, so any real process delta moves the
  // MODELLED number off the band — which is the whole point, since it is the
  // PRINTED part that is meant to land on it.
  const held = draft({ measurement: { measuredMm: 30 } });
  assert.strictEqual(held.processDeltaMm.valueMm, 0);
  assert.strictEqual(held.amendedClearanceMm.valueMm, held.band.valueMm);
  assert.strictEqual(held.amendedClearanceMm.withinCitedBand, true);
  assert.ok(!held.warnings.some((w) => w.startsWith("OUTSIDE THE BAND IT CITES:")));
});

test("an amendment that changes nothing says so, and is still an answer", () => {
  // The parent already models the number band + delta arrives at. The proposal
  // is still returned — the shown work is the useful part and it says something
  // real — but the operator must not be handed a page of arithmetic and a
  // byte-identical request with nothing marking it as a no-op.
  const already = parent();
  already.structuredIntent.flushMount.clearancePerSideMm = 0.325;
  const r = proposeAmendment({ parentRequest: already, measurement: tightMeasurement(), allowDraft: true });

  assert.strictEqual(r.amendedClearanceMm.valueMm, 0.325);
  assert.deepStrictEqual(
    r.amendedRequest.structuredIntent.flushMount,
    already.structuredIntent.flushMount,
    "fixture is wrong: this amendment must be identical to its parent",
  );
  assert.strictEqual(r.unchanged, true);
  const said = r.warnings.find((w) => w.startsWith("THIS CHANGES NOTHING:"));
  assert.ok(said, "a no-op amendment must say it is one");
  assert.match(said, /0\.325 mm/);
  assert.match(said, /0\.800 mm/);

  // A real amendment is not flagged, and says nothing of the kind.
  const moved = draft();
  assert.strictEqual(moved.unchanged, false);
  assert.notStrictEqual(
    moved.amendedRequest.structuredIntent.flushMount.clearancePerSideMm,
    parent().structuredIntent.flushMount.clearancePerSideMm,
  );
  assert.ok(!moved.warnings.some((w) => w.startsWith("THIS CHANGES NOTHING:")));

  // A lead-in the amendment raises is a change even when the clearance holds.
  const shallow = parent();
  shallow.structuredIntent.flushMount.clearancePerSideMm = 0.325;
  shallow.structuredIntent.flushMount.chamfer = { angleDeg: 45, depthMm: 0.65 };
  const deepened = proposeAmendment(
    { parentRequest: shallow, measurement: { ...tightMeasurement(), measuredMm: 29.8 }, allowDraft: true },
  );
  assert.strictEqual(deepened.amendedClearanceMm.valueMm, 0.35);
  assert.strictEqual(deepened.amendedChamferDepthMm.valueMm, 0.7);
  assert.strictEqual(deepened.unchanged, false);
});

// --- placeholder substitution -----------------------------------------------

test("wording placeholders are filled everywhere, and values are inserted literally", () => {
  // String.replace with a plain string fills only the FIRST occurrence and
  // interprets $&, $', $` and $$ in the value. Both are operator-visible bugs:
  // an operator rewrite naming the reviewer twice would ship a raw
  // "{reviewer}", and a name containing "$&" would inject the placeholder back
  // into its own slot.
  assert.strictEqual(fillWording("{a} and {a}", { a: "x" }), "x and x");
  assert.strictEqual(fillWording("{a}", { a: "R. $& Vasquez" }), "R. $& Vasquez");
  assert.strictEqual(fillWording("{a} $` {a} $'", { a: "$$" }), "$$ $` $$ $'");
  assert.strictEqual(fillWording("{nope}", {}), "{nope}", "an unfilled placeholder stays visible");

  const r = draft({ measurement: { measuredBy: "R. $& Vasquez" } });
  // Find the disclaimer by the label the constant itself declares, not by a
  // hand-typed "PROPOSAL," prefix. That literal was a second, invisible pin on
  // the operator's wording: rewording the disclaimer made find() return
  // undefined and this test died with a TypeError about `.includes` — a crash
  // that says nothing about the property under test, which is substitution.
  const label = OPERATOR_FLAG_WORDING.amendmentDisclaimer.split(":")[0];
  const said = r.warnings.find((w) => w.startsWith(label));
  assert.ok(said, `no warning carries the amendment disclaimer (looked for "${label}:")`);
  assert.ok(said.includes("R. $& Vasquez"), said);
  assert.ok(!said.includes("{reviewer}"), said);
  for (const w of r.warnings) assert.ok(!/\{\w+\}/.test(w), `unsubstituted placeholder in: ${w}`);
});

// --- the proposal is a record, not a scratch pad -----------------------------

test("the whole proposal is frozen — the caveats are not the caller's to delete", () => {
  const r = draft();
  const before = r.warnings.length;
  assert.ok(Object.isFrozen(r), "the root object");
  for (const path of ["warnings", "measurement", "verification", "band", "processDeltaMm", "amendedClearanceMm", "amendedChamferDepthMm", "amendedChamferAngleDeg", "amendedRequest"]) {
    assert.ok(Object.isFrozen(r[path]), `${path} is not frozen`);
  }
  assert.ok(Object.isFrozen(r.verification.rules), "verification.rules");
  assert.ok(Object.isFrozen(r.amendedRequest.structuredIntent.flushMount), "the amended spec");

  assert.throws(() => { r.warnings.length = 0; }, TypeError);
  assert.throws(() => { r.warnings.push("nonsense"); }, TypeError);
  assert.throws(() => { r.measurement.measuredBy = "someone else"; }, TypeError);
  assert.throws(() => { r.verification.rules.pop(); }, TypeError);
  assert.throws(() => { r.amendedClearanceMm.valueMm = 99; }, TypeError);
  assert.strictEqual(r.warnings.length, before);
  assert.strictEqual(r.measurement.measuredBy, "R. Vasquez");
});

// --- every rule id is derived from the consulted table -----------------------

test("the chamfer shown work names the row the table holds, and refuses an ambiguous table", () => {
  const depthRow = flushMountFit.rules.find((r) => r.parameter === "chamfer-lead-in-depth-min");
  assert.match(draft().amendedChamferDepthMm.arithmetic, new RegExp(depthRow.id));

  // A second row claiming the same parameter must throw, not be silently
  // picked over by position — which is exactly what a hardcoded id, or a
  // first-match scan, would do.
  const ambiguous = makeTable("fmf-two-depth-rows", [
    { ...depthRow, id: "FMF-108" },
    ...flushMountFit.rules,
  ]);
  assert.throws(
    () => proposeAmendment({ parentRequest: parent(), measurement: tightMeasurement(), allowDraft: true }, ambiguous),
    /the chamfer depth row matched 2 rows/,
  );
});

test("the lead-in angle id and the lead-in angle value must come from the same row", () => {
  const angleRow = flushMountFit.rules.find((r) => r.parameter === "chamfer-lead-in-angle");

  // Two rows claiming to be the lead-in angle: a first-match scan would pick
  // one and report the other's number as cited.
  const ambiguous = makeTable("fmf-two-angle-rows", [{ ...angleRow, id: "FMF-107" }, ...flushMountFit.rules]);
  assert.throws(
    () => proposeAmendment({ parentRequest: parent(), measurement: tightMeasurement(), allowDraft: true }, ambiguous),
    /the chamfer angle row matched 2 rows/,
  );

  // A table where the row carrying the parameter is NOT the row chamferFor
  // serves (it resolves FMF-007 by hardcoded id). The cited number and the id
  // beside it would disagree, so the proposal is refused rather than published.
  const divergent = makeTable("fmf-divergent-angle", [
    ...flushMountFit.rules.map((r) => (r.id === angleRow.id ? { ...r, parameter: "chamfer-lead-in-angle-legacy" } : r)),
    { ...angleRow, id: "FMF-107", value: 60 },
  ]);
  assert.throws(
    () => proposeAmendment({ parentRequest: parent(), measurement: tightMeasurement(), allowDraft: true }, divergent),
    /FMF-107 holds 60 but the lookup served 45 for the lead-in angle/,
  );
});

test("the band id and the band value must come from the same row", () => {
  const maxRow = flushMountFit.byId["FMF-004"];

  // Two rows both claiming to be the sliding max band: the decoy is FIRST, so
  // a first-match scan would quote FMF-104's id beside FMF-004's value.
  const ambiguous = makeTable("fmf-two-sliding-max", [{ ...maxRow, id: "FMF-104" }, ...flushMountFit.rules]);
  assert.throws(
    () => proposeAmendment({ parentRequest: parent(), measurement: tightMeasurement(), allowDraft: true }, ambiguous),
    /the max clearance row for fit class sliding matched 2 rows/,
  );

  // A table where the row carrying the parameter is NOT the row the lookup
  // serves: the mismatch is caught rather than published as shown work.
  const divergent = makeTable("fmf-divergent", [
    ...flushMountFit.rules.map((r) => (r.id === "FMF-004" ? { ...r, parameter: "clearance-per-side-max-legacy" } : r)),
    { ...maxRow, id: "FMF-104", value: 0.9 },
  ]);
  assert.throws(
    () => proposeAmendment({ parentRequest: parent(), measurement: tightMeasurement(), allowDraft: true }, divergent),
    /FMF-104 holds 0\.9 but the lookup served 0\.25/,
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

// node --test server/reference/
import { test } from "node:test";
import assert from "node:assert";

import { makeTable, ruleValue, citationOf, VERIFIED } from "./schema.mjs";
import { holeEdgeDistance } from "./tables/hole-edge-distance.mjs";
import {
  edgeDistance,
  pitch,
  transversePitch,
  fastenerDiameter,
  resolve,
  UnverifiedRuleError,
  DRAFT_WATERMARK,
} from "./lookup.mjs";

// Same rules, signed off — for exercising the verified path.
const signedTable = makeTable(
  "hole-edge-distance-signed",
  holeEdgeDistance.rules.map((r) => ({
    ...r,
    verification: { status: VERIFIED, verifiedBy: "TEST", date: "2026-07-22" },
  })),
);

test("fail-closed: default lookup on a PENDING table throws UnverifiedRuleError", () => {
  assert.throws(() => edgeDistance({ fastenerDiaMm: 4, headStyle: "protruding" }), UnverifiedRuleError);
  try {
    edgeDistance({ fastenerDiaMm: 4, headStyle: "protruding" });
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(e.ruleIds.includes("HED-001"));
    assert.match(e.message, /VERIFICATION_LOG/);
  }
});

test("allowDraft: value + citation returned, watermarked, status carried", () => {
  const r = edgeDistance({ fastenerDiaMm: 4, headStyle: "protruding", allowDraft: true });
  assert.strictEqual(r.minMm, 8); // 2 × D per AC 43.13-1B para 4-57c(1)
  assert.strictEqual(r.preferredMm, 10); // 2.5 × D
  assert.match(r.citation.min, /AC 43\.13-1B/);
  assert.match(r.citation.min, /4-57c\(1\)/);
  assert.strictEqual(r.watermark, DRAFT_WATERMARK);
  assert.strictEqual(r.verification.status, "PENDING_OPERATOR");
  assert.strictEqual(r.verification.rules.length, 2);
});

test("flush case uses the larger minimums and an UNCONFIRMED handbook citation", () => {
  const r = edgeDistance({ fastenerDiaMm: 4, headStyle: "flush", allowDraft: true });
  assert.strictEqual(r.minMm, 10); // 2.5 × D
  assert.strictEqual(r.preferredMm, 12); // 3 × D
  assert.match(r.citation.min, /UNCONFIRMED/);
});

test("pitch: 3D minimum, 4–6D typical", () => {
  const r = pitch({ fastenerDiaMm: 4, allowDraft: true });
  assert.strictEqual(r.minMm, 12);
  assert.strictEqual(r.typicalMinMm, 16);
  assert.strictEqual(r.typicalMaxMm, 24);
  assert.match(r.citation.min, /4-57c\(1\)/);
  assert.strictEqual(r.watermark, DRAFT_WATERMARK);
});

test("transverse pitch: 2.5D floor, 75% of row pitch typical", () => {
  const r = transversePitch({ fastenerDiaMm: 4, pitchMm: 20, allowDraft: true });
  assert.strictEqual(r.minMm, 10);
  assert.strictEqual(r.typicalMm, 15);
});

test("diameter rule of thumb: 3 × thicker sheet", () => {
  const r = fastenerDiameter({ sheetThicknessMm: 1.6, allowDraft: true });
  assert.ok(Math.abs(r.diaMm - 4.8) < 1e-12);
  assert.match(r.citation, /4-57g\(3\)/);
});

test("formula rules compute (2.5 × diameter)", () => {
  assert.strictEqual(ruleValue(holeEdgeDistance.byId["HED-003"], { fastenerDiaMm: 4 }), 10);
  assert.strictEqual(holeEdgeDistance.byId["HED-003"].formula.text, "2.5 × fastener diameter");
  assert.throws(() => ruleValue(holeEdgeDistance.byId["HED-003"], {}), RangeError);
});

test("verified table serves without allowDraft and without watermark", () => {
  const r = edgeDistance({ fastenerDiaMm: 4, headStyle: "protruding" }, signedTable);
  assert.strictEqual(r.minMm, 8);
  assert.strictEqual(r.watermark, undefined);
  assert.strictEqual(r.verification.status, "VERIFIED");
});

test("tables are frozen and un-mutable", () => {
  assert.ok(Object.isFrozen(holeEdgeDistance));
  assert.ok(Object.isFrozen(holeEdgeDistance.byId["HED-001"]));
  assert.ok(Object.isFrozen(holeEdgeDistance.byId["HED-001"].verification));
  assert.throws(() => {
    holeEdgeDistance.byId["HED-001"].verification.status = "VERIFIED";
  }, TypeError);
});

test("makeTable rejects duplicates and value+formula rules", () => {
  const base = holeEdgeDistance.rules[0];
  assert.throws(() => makeTable("dup", [base, base]), /duplicate rule id/);
  assert.throws(
    () => makeTable("bad", [{ ...base, id: "X-1", value: 5 }]), // has both value and formula
    /exactly one of value\|formula/,
  );
});

test("input validation: bad head style and non-positive diameter throw RangeError", () => {
  assert.throws(() => edgeDistance({ fastenerDiaMm: 4, headStyle: "oval", allowDraft: true }), RangeError);
  assert.throws(() => edgeDistance({ fastenerDiaMm: -1, headStyle: "flush", allowDraft: true }), RangeError);
  assert.throws(() => pitch({ allowDraft: true }), RangeError);
});

test("resolve dispatches on parameter and rejects unknown parameters", () => {
  const r = resolve({ parameter: "pitch", fastenerDiaMm: 4, allowDraft: true });
  assert.strictEqual(r.minMm, 12);
  assert.throws(() => resolve({ parameter: "torque" }), RangeError);
});

test("every rule carries a citation string and a one-sentence basis", () => {
  for (const rule of holeEdgeDistance.rules) {
    assert.ok(citationOf(rule).length > 20, rule.id);
    assert.ok(rule.basis.endsWith("."), rule.id);
  }
});

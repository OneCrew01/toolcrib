// node --test "server/reference/fit.test.mjs"
import { test } from "node:test";
import assert from "node:assert";

import { makeTable, ruleValue, citationOf, VERIFIED, PENDING_OPERATOR } from "./schema.mjs";
import { UnverifiedRuleError, DRAFT_WATERMARK } from "./lookup.mjs";
import { flushMountFit, fitClearance, chamferFor, insertSize } from "./tables/flush-mount-fit.mjs";

const near = (a, b) => Math.abs(a - b) < 1e-12;

// Same rules, signed off — for exercising the verified path.
const signedTable = makeTable(
  "flush-mount-fit-signed",
  flushMountFit.rules.map((r) => ({
    ...r,
    verification: { status: VERIFIED, verifiedBy: "TEST", date: "2026-07-22" },
  })),
);

test("fail-closed: default lookups on a PENDING table throw UnverifiedRuleError", () => {
  assert.throws(() => fitClearance({ class: "sliding" }), UnverifiedRuleError);
  assert.throws(() => chamferFor({ clearanceMm: 0.25 }), UnverifiedRuleError);
  assert.throws(() => insertSize({ openingDimMm: 60, clearancePerSideMm: 0.25 }), UnverifiedRuleError);
  try {
    fitClearance({ class: "snug" });
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(e.ruleIds.includes("FMF-001"));
    assert.ok(e.ruleIds.includes("FMF-002"));
    assert.match(e.message, /VERIFICATION_LOG/);
  }
});

test("clearance classes: per-side bands per bench practice", () => {
  const snug = fitClearance({ class: "snug", allowDraft: true });
  assert.ok(near(snug.perSideMinMm, 0.1) && near(snug.perSideMaxMm, 0.15));
  const sliding = fitClearance({ class: "sliding", allowDraft: true });
  assert.ok(near(sliding.perSideMinMm, 0.2) && near(sliding.perSideMaxMm, 0.25));
  assert.ok(near(sliding.perSideNominalMm, 0.225));
  const loose = fitClearance({ class: "loose", allowDraft: true });
  assert.ok(near(loose.perSideMinMm, 0.3) && near(loose.perSideMaxMm, 0.35));
});

test("draft results are watermarked and carry the consulted rules", () => {
  const r = fitClearance({ class: "sliding", allowDraft: true });
  assert.strictEqual(r.watermark, DRAFT_WATERMARK);
  assert.strictEqual(r.verification.status, PENDING_OPERATOR);
  assert.deepStrictEqual(r.verification.rules.map((x) => x.id), ["FMF-003", "FMF-004"]);
  assert.match(r.citation.min, /Bench practice/);
  assert.match(r.citation.min, /UNCONFIRMED — verify with printed coupon \+ calipers/);
});

test("class aliases: press→snug, smooth-sliding→sliding, service→loose", () => {
  assert.strictEqual(fitClearance({ class: "press", allowDraft: true }).class, "snug");
  assert.strictEqual(fitClearance({ class: "smooth-sliding", allowDraft: true }).class, "sliding");
  assert.strictEqual(fitClearance({ class: "service", allowDraft: true }).class, "loose");
});

test("unknown class and missing class throw RangeError", () => {
  assert.throws(() => fitClearance({ class: "interference", allowDraft: true }), RangeError);
  assert.throws(() => fitClearance({ allowDraft: true }), RangeError);
});

test("chamfer: 45° standard, depth = 2 × clearance with a 0.6 mm floor", () => {
  const atFloor = chamferFor({ clearanceMm: 0.25, allowDraft: true });
  assert.strictEqual(atFloor.angleDeg, 45);
  assert.ok(near(atFloor.depthMinMm, 0.6)); // 2 × 0.25 = 0.5 < 0.6 floor
  const aboveFloor = chamferFor({ clearanceMm: 0.35, allowDraft: true });
  assert.ok(near(aboveFloor.depthMinMm, 0.7)); // 2 × 0.35 = 0.7 > floor
  assert.strictEqual(flushMountFit.byId["FMF-008"].formula.text, "2 × clearance per side, with a 0.6 mm floor");
  assert.throws(() => chamferFor({ allowDraft: true }), RangeError);
});

test("insert sizing: insertDim = openingDim − 2 × clearance per side", () => {
  const r = insertSize({ openingDimMm: 60, clearancePerSideMm: 0.25, allowDraft: true });
  assert.ok(near(r.insertDimMm, 59.5));
  assert.strictEqual(ruleValue(flushMountFit.byId["FMF-009"], { openingDimMm: 40, clearancePerSideMm: 0.1 }), 39.8);
  assert.throws(() => insertSize({ openingDimMm: -5, clearancePerSideMm: 0.25, allowDraft: true }), RangeError);
  assert.throws(() => insertSize({ openingDimMm: 0.4, clearancePerSideMm: 0.25, allowDraft: true }), RangeError); // clearance consumes opening
});

test("helpers compose: sliding nominal through the insert formula", () => {
  const { perSideNominalMm } = fitClearance({ class: "sliding", allowDraft: true });
  const { insertDimMm } = insertSize({ openingDimMm: 40, clearancePerSideMm: perSideNominalMm, allowDraft: true });
  assert.ok(near(insertDimMm, 39.55));
});

test("note-rule FMF-010: zero encoded compensation, coupon-calibration basis", () => {
  const rule = flushMountFit.byId["FMF-010"];
  assert.strictEqual(rule.value, 0);
  assert.match(rule.basis, /undersize/);
  assert.match(rule.basis, /coupon calibration/);
});

test("verified table serves without allowDraft and without watermark", () => {
  const r = fitClearance({ class: "sliding" }, signedTable);
  assert.ok(near(r.perSideMinMm, 0.2));
  assert.strictEqual(r.watermark, undefined);
  assert.strictEqual(r.verification.status, VERIFIED);
  const c = chamferFor({ clearanceMm: 0.2, allowDraft: false }, signedTable);
  assert.strictEqual(c.watermark, undefined);
});

test("every row: FMF id, bench-practice source, UNCONFIRMED paragraph, PENDING status", () => {
  assert.strictEqual(flushMountFit.rules.length, 10);
  for (const rule of flushMountFit.rules) {
    assert.match(rule.id, /^FMF-\d{3}$/);
    assert.strictEqual(rule.source.document, "Bench practice — FDM fit coupons (Bambu P1S, 0.4mm nozzle)");
    assert.strictEqual(rule.source.paragraph, "UNCONFIRMED — verify with printed coupon + calipers");
    assert.strictEqual(rule.verification.status, PENDING_OPERATOR);
    assert.ok(citationOf(rule).length > 20, rule.id);
    assert.ok(rule.basis.endsWith("."), rule.id);
  }
});

test("table is frozen and un-mutable", () => {
  assert.ok(Object.isFrozen(flushMountFit));
  assert.ok(Object.isFrozen(flushMountFit.byId["FMF-001"]));
  assert.throws(() => {
    flushMountFit.byId["FMF-001"].verification.status = "VERIFIED";
  }, TypeError);
});

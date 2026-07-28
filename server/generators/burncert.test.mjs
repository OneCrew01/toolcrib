// Tests for the burn-cert track: fail-closed reference table, sampled
// min-wall gate (pass/fail both ways on known meshes), print recipe
// completeness, and determinism. Pure offline; no network.
import { test } from "node:test";
import assert from "node:assert/strict";

import { makeTable, citationOf, VERIFIED, PENDING_OPERATOR } from "../reference/schema.mjs";
import { UnverifiedRuleError, DRAFT_WATERMARK } from "../reference/lookup.mjs";
import {
  burnCert,
  minWallFloor,
  minInfillPercent,
  wallFlameTimeDatum,
  designRules,
  canonicalMaterial,
  BURN_CERT_DISCLAIMER,
} from "../reference/tables/burn-cert.mjs";
import { sampleWallThickness, burnCertGate, BurnCertError } from "./burncert-validate.mjs";
import { printRecipe } from "./burncert-recipe.mjs";

// Same rules, signed off — for exercising the verified path.
const signedTable = makeTable(
  "burn-cert-signed",
  burnCert.rules.map((r) => ({
    ...r,
    verification: { status: VERIFIED, verifiedBy: "TEST", date: "2026-07-23" },
  })),
);

// Binary STL of an axis-aligned box: width x height x wall (z: 0..wall).
// Outward winding, zeroed stored normals — the gate recomputes from winding.
function boxStl(w, h, wall) {
  const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2, z0 = 0, z1 = wall;
  const quads = [
    [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]], // bottom, -Z out
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], // top, +Z out
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], // -X out
    [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], // +X out
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], // -Y out
    [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], // +Y out
  ];
  const tris = quads.flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]]);
  const buf = Buffer.alloc(84 + 50 * tris.length);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((tri, i) => {
    let o = 84 + i * 50 + 12;
    for (const v of tri) for (const coord of v) { buf.writeFloatLE(coord, o); o += 4; }
  });
  return buf;
}

const PASS_BOX = boxStl(60, 40, 2.0);
const THIN_BOX = boxStl(60, 40, 0.8);

// ------------------------------------------------------------------- table

test("every row: BC id, PENDING status, citation, basis is a sentence", () => {
  assert.equal(burnCert.rules.length, 9);
  for (const rule of burnCert.rules) {
    assert.match(rule.id, /^BC-\d{3}$/);
    assert.equal(rule.verification.status, PENDING_OPERATOR);
    assert.ok(citationOf(rule).length > 20, rule.id);
    assert.ok(rule.basis.endsWith("."), rule.id);
  }
});

test("unfetchable TN23-65 rows say so; fetched UL-94 rows cite the fetch", () => {
  for (const id of ["BC-004", "BC-005", "BC-007", "BC-008"]) {
    assert.equal(burnCert.byId[id].source.paragraph, "UNCONFIRMED — verify against the printed source", id);
  }
  for (const id of ["BC-001", "BC-002", "BC-003", "BC-006"]) {
    assert.match(burnCert.byId[id].source.paragraph, /Fetched 2026-07-23/, id);
    assert.match(burnCert.byId[id].source.paragraph, /UL Yellow Card/, id);
  }
});

test("table is frozen and un-mutable", () => {
  assert.ok(Object.isFrozen(burnCert));
  assert.throws(() => {
    burnCert.byId["BC-001"].verification.status = "VERIFIED";
  }, TypeError);
});

test("fail-closed: every lookup on the PENDING table throws UnverifiedRuleError", () => {
  assert.throws(() => minWallFloor({ material: "PC-ABS-FR" }), UnverifiedRuleError);
  assert.throws(() => minInfillPercent(), UnverifiedRuleError);
  assert.throws(() => wallFlameTimeDatum(), UnverifiedRuleError);
  assert.throws(() => designRules(), UnverifiedRuleError);
  try {
    minWallFloor({ material: "ULTEM 9085" });
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(e.ruleIds.includes("BC-002"));
    assert.match(e.message, /VERIFICATION_LOG/);
  }
});

test("draft results carry watermark, disclaimer, and consulted rules", () => {
  const r = minWallFloor({ material: "PC-ABS-FR", allowDraft: true });
  assert.equal(r.watermark, DRAFT_WATERMARK);
  assert.equal(r.disclaimer, BURN_CERT_DISCLAIMER);
  assert.equal(r.verification.status, PENDING_OPERATOR);
  assert.deepEqual(r.verification.rules.map((x) => x.id), ["BC-001", "BC-003", "BC-006"]);
});

// BURN_CERT_DISCLAIMER makes exactly one claim of its own, and it has to hold
// wherever the disclaimer is printed: "The rows it used are printed beside this
// result — where each number is claimed to come from, and whether anybody has
// signed it off."
//
// It earns that narrow shape. An earlier plain-English rewrite claimed
// provenance instead — "a wall thickness we read out of a published test
// report" — and nobody read one: the floor is BC-001/BC-003, sourced to a
// self-labelled secondary source that asks in its own paragraph field to be
// checked against the UL Yellow Card, and the one published report in this
// domain (TN23-65) answered 503/403 and was never retrieved. That sentence
// shipped verbatim into three sample artifacts, three lines under a README line
// saying the report could not be fetched.
//
// So the disclaimer no longer says where a number came from; it says the rows
// are beside it. This asserts they are, on every surface that prints it,
// including the FAIL path — a reader looking at a rejection is exactly the
// reader who goes looking for the source.
test("every surface carrying the disclaimer also carries the rows it used", () => {
  const cites = (c) => (typeof c === "string" ? [c] : Object.values(c ?? {}));
  const surfaces = [
    ["minWallFloor", minWallFloor({ material: "PC-ABS-FR", allowDraft: true }), (r) => cites(r.citation)],
    ["minInfillPercent", minInfillPercent({ allowDraft: true }), (r) => cites(r.citation)],
    ["wallFlameTimeDatum", wallFlameTimeDatum({ allowDraft: true }), (r) => cites(r.citation)],
    ["designRules", designRules({ allowDraft: true }), (r) => r.rules.map((x) => x.citation)],
    ["gate PASS", burnCertGate(PASS_BOX, { material: "PC-ABS-FR", allowDraft: true }), (r) => cites(r.citation)],
    ["recipe", printRecipe({ material: "PC-ABS-FR", allowDraft: true }).recipe, (r) => cites(r.citations)],
  ];
  try {
    burnCertGate(THIN_BOX, { material: "PC-ABS-FR", allowDraft: true });
    assert.fail("the 0.8 mm box should have failed the gate");
  } catch (e) {
    assert.ok(e instanceof BurnCertError);
    surfaces.push(["gate FAIL", e.report, (r) => cites(r.citation)]);
  }
  // The FAIL push happened and nothing below is looping over a short list: a
  // surface silently dropped out of this table is the way this test goes quiet.
  assert.equal(surfaces.length, 7, "a surface that prints the disclaimer is not being checked");

  for (const [name, result, citationsOf] of surfaces) {
    assert.equal(result.disclaimer, BURN_CERT_DISCLAIMER, `${name}: disclaimer missing`);
    assert.ok(result.verification.rules.length > 0, `${name}: the disclaimer points at rows that are not there`);
    for (const row of result.verification.rules) {
      assert.match(row.id, /^BC-\d{3}$/, `${name}: a row is printed without its rule id`);
      assert.ok(row.status, `${name}: ${row.id} does not say whether anybody signed it off`);
    }
    const citations = citationsOf(result);
    assert.ok(citations.length > 0, `${name}: no citation printed beside the result`);
    for (const c of citations) {
      assert.equal(typeof c, "string", `${name}: a citation is not printable text`);
      assert.ok(c.length > 20, `${name}: a citation is too short to say where a number came from`);
    }
  }
});

test("material floors: listed materials get their listing, unknown gets the general floor", () => {
  const pcabs = minWallFloor({ material: "PC-ABS-FR" }, signedTable);
  assert.equal(pcabs.floorMm, 1.5);
  assert.equal(pcabs.materialListed, true);
  const ultem = minWallFloor({ material: "ultem-9085" }, signedTable);
  assert.equal(ultem.material, "ULTEM 9085");
  assert.equal(ultem.floorMm, 0.508); // listing undercuts the general floor
  assert.equal(ultem.generalFloorMm, 1.5);
  const unknown = minWallFloor({ material: "PLA" }, signedTable);
  assert.equal(unknown.floorMm, 1.5);
  assert.equal(unknown.materialListed, false);
  assert.match(unknown.material, /unlisted/);
  assert.match(unknown.chemistryNote, /chemistry sets the floor/i);
});

test("canonicalMaterial aliases; infill and datum serve their encoded values", () => {
  assert.equal(canonicalMaterial("Ultem 9085"), "ULTEM 9085");
  assert.equal(canonicalMaterial("pc/abs-fr"), "PC-ABS-FR");
  assert.equal(canonicalMaterial("PLA"), null);
  const infill = minInfillPercent({}, signedTable);
  assert.equal(infill.percent, 25);
  assert.match(infill.enforcement, /package requirement/);
  const datum = wallFlameTimeDatum({}, signedTable);
  assert.equal(datum.datumWallMm, 6.35);
  assert.match(datum.claim, /over 40 s to under 5 s/);
  const design = designRules({}, signedTable);
  assert.deepEqual(design.rules.map((r) => r.id), ["BC-007", "BC-008", "BC-009"]);
});

// ---------------------------------------------------------------- sampling

test("ray sampling reads the wall, flags edge-on spans, and is deterministic", () => {
  const a = sampleWallThickness(PASS_BOX);
  const b = sampleWallThickness(PASS_BOX);
  assert.deepEqual(a, b);
  assert.equal(a.minMm, 2); // top/bottom facets read the true wall
  assert.equal(a.medianMm, 40); // side facets read the part's span — documented approximation
  assert.match(a.method, /^ray-sampled, \d+ samples$/);
  assert.match(a.approximate, /Approximate by nature/);
  assert.equal(a.hits, 12);
});

// -------------------------------------------------------------------- gate

test("gate PASS: 2.0 mm wall clears the 1.5 mm PC-ABS-FR floor", () => {
  const report = burnCertGate(PASS_BOX, { material: "PC-ABS-FR" }, signedTable);
  assert.equal(report.gate, "PASS");
  assert.equal(report.floorMm, 1.5);
  assert.equal(report.sampledMinMm, 2);
  assert.equal(report.marginMm, 0.5);
  assert.equal(report.watermark, undefined); // verified table, no draft, no watermark
  assert.equal(report.disclaimer, BURN_CERT_DISCLAIMER);
  assert.equal(report.mesh.watertight, true);
  assert.match(report.method, /^ray-sampled, \d+ samples$/);
});

test("gate FAIL: 0.8 mm wall is caught, report carried on the error", () => {
  try {
    burnCertGate(THIN_BOX, { material: "PC-ABS-FR" }, signedTable);
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(e instanceof BurnCertError);
    assert.equal(e.name, "BurnCertError");
    assert.match(e.message, /below the 1.5 mm floor/);
    assert.equal(e.report.gate, "FAIL");
    assert.equal(e.report.sampledMinMm, 0.8);
    assert.equal(e.report.disclaimer, BURN_CERT_DISCLAIMER);
  }
});

test("gate at exactly the floor passes (float32 tolerance)", () => {
  const report = burnCertGate(boxStl(30, 30, 1.5), { material: "PC-ABS-FR" }, signedTable);
  assert.equal(report.gate, "PASS");
});

test("gate honors material-specific floors: 0.8 mm passes for ULTEM 9085", () => {
  const report = burnCertGate(THIN_BOX, { material: "ULTEM 9085" }, signedTable);
  assert.equal(report.gate, "PASS");
  assert.equal(report.floorMm, 0.508);
});

test("gate is fail-closed on the PENDING table, watermarked with allowDraft", () => {
  assert.throws(() => burnCertGate(PASS_BOX, { material: "PC-ABS-FR" }), UnverifiedRuleError);
  const draft = burnCertGate(PASS_BOX, { material: "PC-ABS-FR", allowDraft: true });
  assert.equal(draft.watermark, DRAFT_WATERMARK);
  assert.equal(draft.verification.status, PENDING_OPERATOR);
});

test("gate report is deterministic", () => {
  const a = burnCertGate(PASS_BOX, { material: "PC-ABS-FR", allowDraft: true });
  const b = burnCertGate(PASS_BOX, { material: "PC-ABS-FR", allowDraft: true });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

// ------------------------------------------------------------------ recipe

test("recipe carries every required field and the disclaimer", () => {
  const { recipe, markdown } = printRecipe({ material: "PC-ABS-FR", allowDraft: true });
  assert.equal(recipe.material, "PC-ABS-FR");
  assert.equal(recipe.minWallMm, 1.5);
  assert.equal(recipe.minInfillPercent, 25);
  assert.ok(recipe.orientationNote.length > 20);
  assert.equal(recipe.disclaimer, BURN_CERT_DISCLAIMER);
  assert.equal(recipe.watermark, DRAFT_WATERMARK);
  for (const needle of ["Material", "Minimum wall", "Minimum infill", "Orientation", BURN_CERT_DISCLAIMER, DRAFT_WATERMARK]) {
    assert.ok(markdown.includes(needle), `markdown missing: ${needle}`);
  }
  assert.match(markdown, /CAD geometry cannot enforce infill/);
});

test("recipe is fail-closed by default and unwatermarked on a verified table", () => {
  assert.throws(() => printRecipe({ material: "PC-ABS-FR" }), UnverifiedRuleError);
  const { recipe, markdown } = printRecipe({ material: "PC-ABS-FR" }, signedTable);
  assert.equal(recipe.watermark, undefined);
  assert.equal(recipe.verification.status, VERIFIED);
  assert.ok(!markdown.includes(DRAFT_WATERMARK));
  assert.ok(markdown.includes(BURN_CERT_DISCLAIMER)); // the advisory never comes off
});

test("recipe is deterministic", () => {
  const a = printRecipe({ material: "ULTEM 9085", allowDraft: true });
  const b = printRecipe({ material: "ULTEM 9085", allowDraft: true });
  assert.deepEqual(a, b);
});

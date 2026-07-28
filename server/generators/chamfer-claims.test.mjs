// The arithmetic behind FN-032 and FN-033, pinned offline against the files
// this repo actually ships.
//
// WHAT THIS DOES NOT DO, first, because it is the honest half. The engine
// figures in those two notes came from a 35-call probe run on the live Zoo
// engine, and that harness is NOT in this repo — re-running it spends API
// minutes. So nothing here re-measures the engine, and this suite CANNOT
// notice if a future engine release fixes the bounding box. If that happens,
// FN-032 goes stale silently and only a human re-running the probe will find
// out. That limitation is stated in the note itself as well.
//
// What it does do is stop the two notes going false against their own
// citations, which is the failure mode that actually happened: FN-032 was
// filed claiming a cutter extent that the file it names does not contain. Every
// figure in those notes that a reader could check by opening a shipped file is
// checked here, the recorded engine figures are held beside them as frozen
// constants, and the arithmetic connecting the two is a test rather than a
// sentence. Change a number in the note without changing it here and the suite
// goes red; change it here without the note and the last test goes red.
//
// Pure offline: reads tracked sample files and does arithmetic. No network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeStl } from "../package/stl-analyze.mjs";

const REPO = new URL("../../", import.meta.url);
const readBytes = (rel) => readFileSync(new URL(rel, REPO));
const readText = (rel) => readFileSync(new URL(rel, REPO), "utf8");

const COUPON = "samples/flush-mount/coupons/c0.15/";
const NOTES = "docs/API_FIELD_NOTES.md";

// Measured on the live engine 2026-07-28 and recorded in FN-032/FN-033. These
// are transcriptions, not derivations — nothing offline can re-derive them.
const ENGINE = Object.freeze({
  // FN-032: calculate_bounding_box over executed KCL, per case.
  booleanBox: Object.freeze({
    base_c015: [23.64, 23.64, 3.08],
    deep_chamfer: [23.64, 23.64, 3.28],
    tiny_scale: [4.752, 4.752, 0.96],
    micro_clear: [23.976, 23.976, 3.005],
  }),
  truePart: Object.freeze({
    base_c015: [19.7, 19.7, 3],
    deep_chamfer: [19.7, 19.7, 3],
    tiny_scale: [3.96, 3.96, 0.9],
    micro_clear: [19.98, 19.98, 3],
  }),
  // chamferDepth per case. Only base_c015's is read off a shipped spec; the
  // other three are BACK-DERIVED from the pattern under test, which is why they
  // are labelled here and in FN-032 rather than presented as corroboration.
  chamferDepthMm: Object.freeze({ base_c015: 0.8, deep_chamfer: 2.8, tiny_scale: 0.6, micro_clear: 0.05 }),
  impliedDepth: Object.freeze(["deep_chamfer", "tiny_scale", "micro_clear"]),
  // FN-033: centre of mass, z, of the same nominal part chamfered at each end.
  comZCorrectMm: 1.473491907119751,
  comZWrongEndMm: 1.52650785446167,
  volumeBooleanMm3: 1139.7366463938852,
  volumeNativeMm3: 1139.7366440254093,
});

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

test("FN-032 · the shipped c0.15 coupon is the base_c015 row, measured offline", () => {
  const mesh = analyzeStl(readBytes(`${COUPON}insert.stl`));
  const [tx, ty, tz] = ENGINE.truePart.base_c015;
  assert.ok(near(mesh.bboxMm.x, tx, 1e-4), `stl x ${mesh.bboxMm.x} != ${tx}`);
  assert.ok(near(mesh.bboxMm.y, ty, 1e-4), `stl y ${mesh.bboxMm.y} != ${ty}`);
  assert.ok(near(mesh.bboxMm.z, tz, 1e-4), `stl z ${mesh.bboxMm.z} != ${tz}`);
  // The mesh half of "the part is right; only the measurement of it is wrong".
  assert.equal(mesh.watertight, true);
  assert.equal(mesh.triangles, 20, "20 triangles is the topological minimum for a chamfered box");
  // ...and the fourth number the note claims to match: the chamfer depth.
  assert.match(readText(`${COUPON}insert.kcl`), /^chamferDepth = 0\.8mm$/m);
  // The local volume agrees with both engine figures to float32 mesh precision.
  assert.ok(Math.abs(mesh.volumeMm3 - ENGINE.volumeBooleanMm3) < 1e-4, `local volume ${mesh.volumeMm3}`);
  // The boolean/native volume agreement, done as a subtraction rather than
  // quoted. It was quoted wrong once — filed as 2.4e-9 mm³, which is the
  // RELATIVE agreement wearing the absolute one's units. Both are pinned now.
  const dv = Math.abs(ENGINE.volumeBooleanMm3 - ENGINE.volumeNativeMm3);
  assert.ok(dv > 2e-6 && dv < 3e-6, `boolean/native volume delta is ${dv} mm3, not ~2.4e-6`);
  assert.ok(dv / ENGINE.volumeBooleanMm3 < 2.1e-9, "relative agreement");
});

test("FN-032 · XY x 1.2 and Z + 0.1 x chamferDepth are arithmetic-exact on all four rows", () => {
  for (const [name, box] of Object.entries(ENGINE.booleanBox)) {
    const [px, py, pz] = ENGINE.truePart[name];
    const d = ENGINE.chamferDepthMm[name];
    assert.ok(near(box[0], px * 1.2), `${name} x: ${box[0]} != 1.2 x ${px}`);
    assert.ok(near(box[1], py * 1.2), `${name} y: ${box[1]} != 1.2 x ${py}`);
    assert.ok(near(box[2], pz + 0.1 * d), `${name} z: ${box[2]} != ${pz} + 0.1 x ${d}`);
  }
  // Three of the four depths were solved out of the equation above, so they
  // cannot also be evidence for it. base_c015 is the only row whose depth comes
  // from a shipped file, and the test above is what reads it.
  assert.equal(ENGINE.impliedDepth.length, Object.keys(ENGINE.booleanBox).length - 1);
  assert.ok(!ENGINE.impliedDepth.includes("base_c015"));
});

test("FN-032 · the reported box is not the cutter extent — the elimination, from the shipped KCL", () => {
  const kcl = readText(`${COUPON}insert.kcl`);

  // Read the wedge cutters out of the file rather than restating them.
  const reach = Number(/^chamferReach = ([\d.]+)mm/m.exec(kcl)[1]);
  const insertH = Number(/insertHeight = openingHeight - 2 x clearancePerSide = ([\d.]+)mm/.exec(kcl)[1]);
  assert.match(kcl, /^wedgeSpanY = insertHeight \+ 2 \* chamferReach \+ 2mm$/m);
  assert.match(kcl, /wedgeEastCutter = extrude\(wedgeEastRegion, length = wedgeSpanY, symmetric = true/);

  // symmetric = true, so the prism straddles the sketch plane: half the span.
  const halfSpan = (insertH + 2 * reach + 2) / 2;
  assert.ok(near(halfSpan, 12.65), `wedge half-span ${halfSpan}`);

  // The in-plane extents of one wedge, straight off its sketch literals.
  const wedge = /wedgeEastSketch = sketch\(on = XZ\) \{([\s\S]*?)\n\}/.exec(kcl)[1];
  const coords = [...wedge.matchAll(/var (-?[\d.]+)mm, var (-?[\d.]+)mm/g)];
  const xs = coords.map((m) => Number(m[1]));
  const zs = coords.map((m) => Number(m[2]));
  assert.deepEqual([...new Set(xs)].sort((a, b) => a - b), [8.05, 10.2]);
  assert.deepEqual([...new Set(zs)].sort((a, b) => a - b), [1.85, 4]);

  // The envelope of the part plus every cutter, and the part alone.
  const [px, , pz] = ENGINE.truePart.base_c015;
  const cutterEnvelopeXY = 2 * Math.max(px / 2, halfSpan, Math.max(...xs));
  const cutterEnvelopeZ = Math.max(pz, Math.max(...zs)) - Math.min(0, Math.min(...zs));
  assert.ok(near(cutterEnvelopeXY, 25.3), `part+cutters XY ${cutterEnvelopeXY}`);
  assert.ok(near(cutterEnvelopeZ, 4), `part+cutters Z ${cutterEnvelopeZ}`);

  // The finding: the reported box is neither, and lies strictly between them
  // on every axis. So it is not the part, and it is not raw cutter extent.
  const [bx, , bz] = ENGINE.booleanBox.base_c015;
  assert.ok(bx > px && bx < cutterEnvelopeXY, `${bx} not strictly between ${px} and ${cutterEnvelopeXY}`);
  assert.ok(bz > pz && bz < cutterEnvelopeZ, `${bz} not strictly between ${pz} and ${cutterEnvelopeZ}`);
});

test("FN-033 · the wrong-end part is the mirror image, so only the centroid separates them", () => {
  const [, , h] = ENGINE.truePart.base_c015;
  const sum = ENGINE.comZCorrectMm + ENGINE.comZWrongEndMm;
  // Mirroring about the mid-plane sends z -> h - z, so the two centroids sum to
  // the part height. Holds to float32, which is FN-030's quantisation.
  assert.ok(Math.abs(sum - h) < 3e-7, `centroids sum to ${sum}, not ${h}`);
  assert.notEqual(ENGINE.comZCorrectMm, ENGINE.comZWrongEndMm);
  assert.ok(ENGINE.comZCorrectMm < h / 2, "the correct part's material sits below mid-height");
});

test("the field notes still state the numbers this file checks", () => {
  const notes = readText(NOTES);
  const required = [
    "23.64 × 23.64 × 3.08", // FN-032 base_c015 boolean box
    "4.752 × 4.752 × 0.96", // FN-032 tiny_scale, the row with the smallest part
    "23.976 × 23.976 × 3.005", // FN-032 micro_clear
    "±12.65", // FN-032 wedge half-span — the elimination
    "25.3", // FN-032 part+cutters envelope
    String(ENGINE.comZCorrectMm),
    String(ENGINE.comZWrongEndMm),
    String(ENGINE.volumeBooleanMm3),
    String(ENGINE.volumeNativeMm3),
    "2.4e-6", // the corrected absolute volume agreement, not the relative one
  ];
  for (const s of required)
    assert.ok(notes.includes(s), `${NOTES} no longer states ${JSON.stringify(s)} — note and test have drifted`);
  // And it still says out loud that the engine half is not reproducible here.
  assert.match(notes, /not committed/);
});

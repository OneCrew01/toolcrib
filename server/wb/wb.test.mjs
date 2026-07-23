// Weight & balance track tests. Real fixture: the Zoo-exported plate mesh
// under samples/plain-plate-stl/. Everything else is synthesized in-test so
// every expected number has a hand calculation next to it.

import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { meshProperties } from "./mesh-props.mjs";
import { boxStl } from "./box-stl.mjs";
import { assemblyWB, CgWindowError } from "./wb.mjs";

const FIXTURES = new URL("../../samples/plain-plate-stl/", import.meta.url);
const plateStl = () => readFileSync(new URL("source.stl", FIXTURES));

const relErr = (got, want) => Math.abs(got - want) / Math.abs(want);

// Arbitrary-triangle binary STL writer for degenerate-mesh cases boxStl
// (deliberately) refuses to produce.
function binaryStl(tris) {
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  let o = 84;
  for (const t of tris) {
    o += 12;
    for (const v of t) for (const c of v) { buf.writeFloatLE(c, o); o += 4; }
    o += 2;
  }
  return buf;
}

// ---- mesh-props -------------------------------------------------------------

test("synthesized box: exact volume, exact centroid, box inertia s^5/6", () => {
  const p = meshProperties(boxStl({ sizeMm: [10, 10, 10], cornerMm: [0, 0, 0] }));
  assert.equal(p.watertight, true);
  assert.equal(p.triangles, 12);
  assert.ok(Math.abs(p.volumeMm3 - 1000) < 1e-9, `volume ${p.volumeMm3}`);
  for (const [i, want] of [[0, 5], [1, 5], [2, 5]])
    assert.ok(Math.abs(p.centroidMm[i] - want) < 1e-9, `centroid[${i}] ${p.centroidMm[i]}`);
  // Solid box about its centroid: I = ρV(b²+c²)/12 → s^5/6 at unit density.
  const I = p.inertiaUnitDensityMm5;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      if (i === j) assert.ok(relErr(I[i][j], 1e5 / 6) < 1e-9, `I[${i}][${i}] ${I[i][j]}`);
      else assert.ok(Math.abs(I[i][j]) < 1e-6, `I[${i}][${j}] ${I[i][j]}`);
    }
});

test("fixture plate: centroid lands at the geometric center; error measured and stated", (t) => {
  const p = meshProperties(plateStl());
  assert.equal(p.watertight, true);
  const center = [0, 1, 2].map((i) => (p.bboxMm.min[i] + p.bboxMm.max[i]) / 2);
  const errMm = [0, 1, 2].map((i) => Math.abs(p.centroidMm[i] - center[i]));
  t.diagnostic(`plate centroid [${p.centroidMm.map((v) => v.toExponential(3))}] mm`);
  t.diagnostic(`bbox center   [${center.map((v) => v.toExponential(3))}] mm`);
  t.diagnostic(`|error|       [${errMm.map((v) => v.toExponential(3))}] mm`);
  for (const [i, e] of errMm.entries())
    assert.ok(e < 1e-3, `centroid axis ${i} off geometric center by ${e} mm`);
});

test("meshProperties rejects junk and zero-volume meshes", () => {
  assert.throws(() => meshProperties(Buffer.alloc(0)), TypeError);
  // A closed box flattened to z=0 everywhere encloses nothing.
  const flat = [
    [[0, 0, 0], [0, 10, 0], [10, 10, 0]], [[0, 0, 0], [10, 10, 0], [10, 0, 0]],
    [[0, 0, 0], [10, 0, 0], [10, 10, 0]], [[0, 0, 0], [10, 10, 0], [0, 10, 0]],
  ];
  assert.throws(() => meshProperties(binaryStl(flat)), /zero enclosed volume/);
});

test("boxStl rejects malformed specs", () => {
  assert.throws(() => boxStl({ sizeMm: [10, 10] }), RangeError);
  assert.throws(() => boxStl({ sizeMm: [10, 10, -1] }), RangeError);
});

// ---- assemblyWB: CG hand calc ------------------------------------------------
// Two known solids at known offsets, worked longhand:
//   A: 1000 mm³ at 1000 kg/m³ → 1 g, global CG [5,5,5]
//   B: 8000 mm³ at 2500 kg/m³ → 20 g, global CG [100,0,30]
//   combined: 21 g, CG = [2005/21, 5/21, 605/21]
const HAND_CG = [2005 / 21, 5 / 21, 605 / 21];

const propsParts = () => [
  {
    name: "A",
    props: { volumeMm3: 1000, centroidMm: [5, 5, 5], watertight: true },
    densityKgM3: 1000,
    positionMm: [0, 0, 0],
  },
  {
    name: "B",
    props: { volumeMm3: 8000, centroidMm: [10, 10, 10], watertight: true },
    densityKgM3: 2500,
    positionMm: [90, -10, 20],
  },
];

test("CG matches the hand calc to 1e-6 relative (props path)", () => {
  const wb = assemblyWB(propsParts());
  assert.ok(relErr(wb.totalMassG, 21) < 1e-12, `total ${wb.totalMassG}`);
  for (const [i, want] of HAND_CG.entries())
    assert.ok(relErr(wb.cgMm[i], want) < 1e-6, `cg[${i}] ${wb.cgMm[i]} vs ${want}`);
  assert.deepEqual(wb.perPart.map((p) => p.basis), ["modeled", "modeled"]);
});

test("CG matches the same hand calc from real meshes (stl path)", () => {
  const wb = assemblyWB([
    { name: "A", stl: boxStl({ sizeMm: [10, 10, 10] }), densityKgM3: 1000, positionMm: [0, 0, 0] },
    {
      name: "B",
      stl: boxStl({ sizeMm: [20, 20, 20], cornerMm: [-10, -10, -10] }),
      densityKgM3: 2500,
      positionMm: [100, 0, 30],
    },
  ]);
  assert.ok(relErr(wb.totalMassG, 21) < 1e-9);
  for (const [i, want] of HAND_CG.entries())
    assert.ok(relErr(wb.cgMm[i], want) < 1e-6, `cg[${i}] ${wb.cgMm[i]} vs ${want}`);
});

test("measuredMassG overrides modeled mass and flips the basis label", () => {
  const parts = propsParts();
  parts[1].measuredMassG = 10; // kitchen scale says the print is lighter
  const wb = assemblyWB(parts);
  assert.ok(relErr(wb.totalMassG, 11) < 1e-12);
  // (1g·[5,5,5] + 10g·[100,0,30]) / 11
  for (const [i, want] of [1005 / 11, 5 / 11, 305 / 11].entries())
    assert.ok(relErr(wb.cgMm[i], want) < 1e-6, `cg[${i}] ${wb.cgMm[i]}`);
  assert.equal(wb.perPart[1].basis, "measured");
  assert.equal(wb.perPart[1].measuredMassG, 10);
  assert.ok(relErr(wb.perPart[1].modeledMassG, 20) < 1e-12, "modeled figure still reported");
});

test("rotationDeg swings the CG arm: [5,0,0] under 90° about Z becomes [0,5,0]", () => {
  const wb = assemblyWB([
    {
      name: "arm",
      props: { volumeMm3: 1000, centroidMm: [5, 0, 0] },
      densityKgM3: 1000,
      positionMm: [0, 0, 0],
      rotationDeg: [0, 0, 90],
    },
  ]);
  assert.ok(Math.abs(wb.cgMm[0] - 0) < 1e-9 && Math.abs(wb.cgMm[1] - 5) < 1e-9, `cg ${wb.cgMm}`);
});

// ---- window gate --------------------------------------------------------------

test("window gate: inside passes and is recorded; outside throws on BOTH sides", () => {
  const inside = assemblyWB(propsParts(), { cgWindow: { axis: "x", minMm: 90, maxMm: 100 } });
  assert.equal(inside.window.result, "PASS");
  assert.ok(relErr(inside.window.cgOnAxisMm, HAND_CG[0]) < 1e-6);

  assert.throws(
    () => assemblyWB(propsParts(), { cgWindow: { axis: "x", minMm: 0, maxMm: 10 } }),
    (e) => e instanceof CgWindowError && e.code === "CG_OUTSIDE_WINDOW" && e.axis === "x"
      && e.cgOnAxisMm > e.maxMm,
    "CG above the window must refuse",
  );
  assert.throws(
    () => assemblyWB(propsParts(), { cgWindow: { axis: "x", minMm: 96, maxMm: 100 } }),
    (e) => e instanceof CgWindowError && e.cgOnAxisMm < e.minMm,
    "CG below the window must refuse",
  );
});

test("malformed windows are rejected loudly", () => {
  assert.throws(() => assemblyWB(propsParts(), { cgWindow: { axis: "w", minMm: 0, maxMm: 1 } }), RangeError);
  assert.throws(() => assemblyWB(propsParts(), { cgWindow: { axis: "x", minMm: 5, maxMm: 5 } }), RangeError);
});

// ---- degenerate inputs ---------------------------------------------------------

test("degenerate inputs rejected loudly", () => {
  const ok = propsParts()[0];
  assert.throws(() => assemblyWB([]), RangeError);
  assert.throws(() => assemblyWB([{ ...ok, name: "" }]), RangeError);
  assert.throws(() => assemblyWB([{ ...ok, props: undefined }]), /exactly one of stl\|props/);
  assert.throws(() => assemblyWB([{ ...ok, stl: boxStl({ sizeMm: [1, 1, 1] }) }]), /exactly one of stl\|props/);
  assert.throws(() => assemblyWB([{ ...ok, positionMm: [0, 0] }]), RangeError);
  assert.throws(() => assemblyWB([{ ...ok, rotationDeg: [0] }]), RangeError);
  assert.throws(() => assemblyWB([{ ...ok, densityKgM3: undefined }]), /densityKgM3 or measuredMassG/);
  assert.throws(() => assemblyWB([{ ...ok, densityKgM3: 0 }]), RangeError);
  assert.throws(() => assemblyWB([{ ...ok, measuredMassG: -1 }]), RangeError);
  assert.throws(
    () => assemblyWB([{ ...ok, props: { volumeMm3: 1000, centroidMm: [0, 0, 0], watertight: false } }]),
    /non-watertight/,
  );
});

test("a holed mesh is refused: watertightness is load-bearing for W&B", () => {
  // boxStl output with the last facet dropped → open box.
  const whole = boxStl({ sizeMm: [10, 10, 10] });
  const n = whole.readUInt32LE(80) - 1;
  const holed = Buffer.concat([whole.subarray(0, 84 + n * 50)]);
  holed.writeUInt32LE(n, 80);
  assert.throws(
    () => assemblyWB([{ name: "holed", stl: holed, densityKgM3: 1000, positionMm: [0, 0, 0] }]),
    /not watertight/,
  );
});

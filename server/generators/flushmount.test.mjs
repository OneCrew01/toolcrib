// Tests for the flush-mount pair generator — spec->KCL determinism,
// arithmetic gates, and the emitted-text contract (constants, colors,
// flush-face relationship). Pure offline; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateFlushMountPair } from "./flushmount.mjs";

const rectSpec = (over = {}) => ({
  panel: { widthMm: 60, heightMm: 40, thicknessMm: 3 },
  opening: { shape: "rect", widthMm: 30, heightMm: 20 },
  clearancePerSideMm: 0.15,
  chamfer: { angleDeg: 45, depthMm: 0.8 },
  insert: { lipMm: 0 },
  colors: { panel: "#2e5e78", insert: "#e07a2f" },
  ...over,
});

const roundSpec = (over = {}) => rectSpec({ opening: { shape: "round", diameterMm: 25 }, ...over });

test("spec -> KCL is deterministic", () => {
  const a = generateFlushMountPair(rectSpec());
  const b = generateFlushMountPair(rectSpec());
  assert.equal(a.panelKcl, b.panelKcl);
  assert.equal(a.insertKcl, b.insertKcl);
  assert.deepEqual(a.params, b.params);
});

test("rect pair emits the named constants, both colors, and KCL 2.0 header", () => {
  const { panelKcl, insertKcl } = generateFlushMountPair(rectSpec());
  for (const kcl of [panelKcl, insertKcl]) {
    assert.match(kcl, /@settings\(defaultLengthUnit = mm, kclVersion = 2\.0\)/);
  }
  assert.match(panelKcl, /^openingWidth = 30mm$/m);
  assert.match(panelKcl, /^chamferRun = chamferDepth \* tan\(chamferAngle\)/m);
  assert.match(insertKcl, /^insertWidth = openingWidth - 2 \* clearancePerSide$/m);
  assert.match(insertKcl, /^insertHeight = openingHeight - 2 \* clearancePerSide$/m);
  assert.match(insertKcl, /\/\/ insertWidth = openingWidth - 2 x clearancePerSide = 29\.70mm/);
  assert.ok(panelKcl.includes('"#2e5e78"'), "panel color");
  assert.ok(insertKcl.includes('"#e07a2f"'), "insert color");
  assert.ok(!panelKcl.includes('"#e07a2f"'), "insert color must not leak into panel");
});

test("flush-face relationship: insert depth == panel thickness when lipMm = 0", () => {
  const { insertKcl, params } = generateFlushMountPair(rectSpec());
  assert.match(insertKcl, /^insertDepth = panelThickness/m);
  assert.equal(params.derived.insert.depthMm, 3);
  assert.equal(params.derived.entrySide, "front");
});

test("rect panel: opening cut plus four chamfer wedges, sequential subtracts", () => {
  const { panelKcl } = generateFlushMountPair(rectSpec());
  for (const w of ["wedgeEast", "wedgeWest", "wedgeNorth", "wedgeSouth"]) {
    assert.ok(panelKcl.includes(`${w}Sketch = sketch(`), `${w} sketch`);
    assert.ok(panelKcl.includes(`subtract(`), "subtract present");
  }
  assert.match(panelKcl, /wedgeNorthSketch = sketch\(on = YZ\)/);
  assert.match(panelKcl, /panelCut5 = subtract\(panelCut4, tools = \[wedgeSouthCutter\]\)/);
  assert.match(panelKcl, /symmetric = true, method = NEW/);
});

test("rear lip: flange constants and plug depth accumulate", () => {
  const { insertKcl, params } = generateFlushMountPair(rectSpec({ insert: { lipMm: 2 } }));
  assert.match(insertKcl, /^lipOverhang = 2mm/m);
  assert.match(insertKcl, /^flangeWidth = openingWidth \+ 2 \* lipOverhang/m);
  assert.match(insertKcl, /^plugDepth = lipThickness \+ insertDepth/m);
  assert.equal(params.derived.insert.totalDepthMm, 5);
  assert.equal(params.derived.entrySide, "back");
});

test("round pair: single revolved profiles, no wedges", () => {
  const { panelKcl, insertKcl, params } = generateFlushMountPair(roundSpec());
  assert.match(panelKcl, /boreCutter = revolve\(boreRegion, axis = Y\)/);
  assert.match(insertKcl, /plugBody = revolve\(plugRegion, axis = Y\)/);
  assert.ok(!insertKcl.includes("wedge"), "round insert needs no wedge cutters");
  assert.match(insertKcl, /^insertDiameter = openingDiameter - 2 \* clearancePerSide$/m);
  assert.equal(params.derived.insert.diameterMm, 24.7);
});

test("derived arithmetic: insert outer dims == opening - 2 x clearance", () => {
  const { params } = generateFlushMountPair(rectSpec({ clearancePerSideMm: 0.25 }));
  assert.equal(params.derived.insert.widthMm, 29.5);
  assert.equal(params.derived.insert.heightMm, 19.5);
  assert.equal(params.derived.totalLateralPlayMm, 0.5);
});

test("gate: chamfer depth must cover 2 x clearance", () => {
  assert.throws(
    () => generateFlushMountPair(rectSpec({ clearancePerSideMm: 0.5, chamfer: { angleDeg: 45, depthMm: 0.8 } })),
    /must be >= 2 x clearancePerSideMm/,
  );
});

test("gate: chamfer depth must leave straight opening wall", () => {
  assert.throws(
    () => generateFlushMountPair(rectSpec({ chamfer: { angleDeg: 45, depthMm: 2.9 } })),
    /straight opening wall/,
  );
});

test("gate: clearance must be a deliberate positive number", () => {
  assert.throws(() => generateFlushMountPair(rectSpec({ clearancePerSideMm: 0 })), /deliberate clearance/);
});

test("gate: insert dims must survive the clearance", () => {
  assert.throws(
    () => generateFlushMountPair(rectSpec({
      opening: { shape: "rect", widthMm: 30, heightMm: 0.4 },
      clearancePerSideMm: 0.25, chamfer: { angleDeg: 45, depthMm: 0.5 },
    })),
    /collapse|centerline|margin/,
  );
});

test("gate: corner radius is a loud no in v1", () => {
  assert.throws(
    () => generateFlushMountPair(rectSpec({ opening: { shape: "rect", widthMm: 30, heightMm: 20, cornerRadiusMm: 2 } })),
    /cornerRadiusMm > 0 not supported/,
  );
});

test("gate: colors must be #rrggbb", () => {
  assert.throws(() => generateFlushMountPair(rectSpec({ colors: { panel: "blue", insert: "#e07a2f" } })), /#rrggbb/);
});

test("gate: opening + chamfer flare must fit the panel", () => {
  assert.throws(
    () => generateFlushMountPair(rectSpec({ opening: { shape: "rect", widthMm: 57, heightMm: 20 } })),
    /margin/,
  );
});

test("emitted sketch constraints follow the corpus sign convention", () => {
  const { panelKcl } = generateFlushMountPair(rectSpec());
  // negative-x vertex pins flip the argument order instead of negating the RHS
  assert.match(panelKcl, /horizontalDistance\(\[s0\.start, ORIGIN\]\) == panelWidth \/ 2/);
  assert.match(panelKcl, /horizontalDistance\(\[ORIGIN, s1\.start\]\) == panelWidth \/ 2/);
});

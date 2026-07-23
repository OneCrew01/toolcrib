// ToolCRIB generator: flush-mount pair — say the joint, get the joint.
//
// generateFlushMountPair(spec) deterministically emits two KCL 2.0 parts:
// a panel with a chamfered-entry opening, and an insert whose face sits
// flush with the panel's show face. All derived dimensions are computed
// here, gated (throw on rule violations), and emitted as named KCL
// constants so remixers edit numbers, not geometry.
//
// Chamfers are built geometrically — profile cutters (extruded wedges for
// rect openings, revolved cones for round ones) — because the sampled KCL
// corpus contains no chamfer()/fillet() stdlib call. Every construct used
// here (sketch{} constraints, region(), extrude, revolve, subtract,
// translate, appearance, hide) appears verbatim in generated samples.
//
// Pure module: no I/O, no network, no clock.

const EPS = 1e-9;
const OV = 1; // cutOverlap mm — cutters pierce faces, never kiss them

function fmt(n) {
  let x = Math.round(n * 10000) / 10000;
  if (Object.is(x, -0)) x = 0;
  return String(x);
}
const mm = (n) => `${fmt(n)}mm`;
const two = (n) => n.toFixed(2);
const rad = (deg) => (deg * Math.PI) / 180;

function gate(cond, msg) {
  if (!cond) throw new Error(`flush-mount spec rejected: ${msg}`);
}

// ---------------------------------------------------------------- sketches

// Closed axis-aligned-plus-taper polygon emitted in corpus constraint style.
// verts: [{ x: {v, e}, y: {v, e} }] — v = signed mm value (also the var
// seed), e = KCL expression for the |v| magnitude. Sign is expressed by
// argument order in the distance constraint, exactly as the corpus does.
function profileSketch(name, plane, verts, regionPoint) {
  const n = verts.length;
  const L = [`${name}Sketch = sketch(on = ${plane}) {`];
  const kind = [];
  for (let i = 0; i < n; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    const dx = Math.abs(a.x.v - b.x.v);
    const dy = Math.abs(a.y.v - b.y.v);
    if (dx < EPS && dy < EPS) throw new Error(`degenerate edge ${i} in ${name}`);
    kind.push(dy < EPS ? "h" : dx < EPS ? "v" : "s");
    L.push(`  s${i} = line(start = [var ${mm(a.x.v)}, var ${mm(a.y.v)}], end = [var ${mm(b.x.v)}, var ${mm(b.y.v)}])`);
  }
  L.push("");
  for (let i = 0; i < n; i++) L.push(`  coincident([s${i}.end, s${(i + 1) % n}.start])`);
  for (let i = 0; i < n; i++) {
    if (kind[i] === "h") L.push(`  horizontal(s${i})`);
    if (kind[i] === "v") L.push(`  vertical(s${i})`);
  }
  // Pin one vertex per shared-coordinate group; h/v edges propagate the rest.
  const uf = (pairs) => {
    const p = [...Array(n).keys()];
    const find = (i) => (p[i] === i ? i : (p[i] = find(p[i])));
    for (const [a, b] of pairs) p[find(a)] = find(b);
    const g = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      if (!g.has(r)) g.set(r, []);
      g.get(r).push(i);
    }
    return [...g.values()].map((m) => Math.min(...m));
  };
  const xPairs = [], yPairs = [];
  for (let i = 0; i < n; i++) {
    if (kind[i] === "v") xPairs.push([i, (i + 1) % n]);
    if (kind[i] === "h") yPairs.push([i, (i + 1) % n]);
  }
  for (const i of uf(xPairs).sort((a, b) => a - b)) {
    const c = verts[i].x;
    if (Math.abs(c.v) < EPS) L.push(`  vertical([s${i}.start, ORIGIN])`);
    else if (c.v > 0) L.push(`  horizontalDistance([ORIGIN, s${i}.start]) == ${c.e}`);
    else L.push(`  horizontalDistance([s${i}.start, ORIGIN]) == ${c.e}`);
  }
  for (const i of uf(yPairs).sort((a, b) => a - b)) {
    const c = verts[i].y;
    if (Math.abs(c.v) < EPS) L.push(`  horizontal([s${i}.start, ORIGIN])`);
    else if (c.v > 0) L.push(`  verticalDistance([ORIGIN, s${i}.start]) == ${c.e}`);
    else L.push(`  verticalDistance([s${i}.start, ORIGIN]) == ${c.e}`);
  }
  L.push("}");
  const rp = regionPoint ?? {
    x: verts.reduce((s, p) => s + p.x.v, 0) / n,
    y: verts.reduce((s, p) => s + p.y.v, 0) / n,
  };
  L.push(`${name}Region = region(point = [${mm(rp.x)}, ${mm(rp.y)}], sketch = ${name}Sketch)`);
  return L.join("\n");
}

// Centered rectangle, corpus vertex order (bottom edge first).
function rectSketch(name, halfW, halfH) {
  return profileSketch(name, "XY", [
    { x: { v: -halfW.v, e: halfW.e }, y: { v: -halfH.v, e: halfH.e } },
    { x: { v: +halfW.v, e: halfW.e }, y: { v: -halfH.v, e: halfH.e } },
    { x: { v: +halfW.v, e: halfW.e }, y: { v: +halfH.v, e: halfH.e } },
    { x: { v: -halfW.v, e: halfW.e }, y: { v: +halfH.v, e: halfH.e } },
  ], { x: 0, y: 0 });
}

// Chamfer wedge cross-section (triangle riding the taper line).
// mode "female": cutter flares outward from the opening wall (panel side).
// mode "male":   cutter shaves the insert's corner inward.
// half = {v,e} anchor (opening/insert half-dimension), sign = +1|-1 side.
function wedgeVerts({ mode, half, sign, d, e, bite, topZ, topZExpr, lowZExpr, reachExpr, biteExpr }) {
  const zTop = { v: topZ + OV, e: topZExpr };
  const zLow = { v: topZ - d - (bite * d) / e, e: lowZExpr };
  const inner = mode === "female"
    ? { v: half.v - bite, e: `${half.e} - ${biteExpr}` }
    : { v: half.v + bite, e: `${half.e} + ${biteExpr}` };
  const outer = mode === "female"
    ? { v: half.v + (e * (d + OV)) / d, e: `${half.e} + ${reachExpr}` }
    : { v: half.v - (e * (d + OV)) / d, e: `${half.e} - ${reachExpr}` };
  const sx = (c) => ({ v: sign * c.v, e: c.e });
  return [
    { x: sx(inner), y: zLow },  // on the taper line, extended past the wall
    { x: sx(outer), y: zTop },  // on the taper line, extended past the face
    { x: sx(inner), y: zTop },
  ];
}

// ---------------------------------------------------------------- helpers

function header(title, note) {
  return [
    "/*",
    `ToolCRIB flush-mount pair — ${title}`,
    note,
    "Generated by generateFlushMountPair(). Edit the named parameters; the",
    "geometry follows. Every derived value states its formula.",
    "*/",
    "@settings(defaultLengthUnit = mm, kclVersion = 2.0)",
    "",
  ];
}

const constLine = (name, expr, note) => `${name} = ${expr}${note ? `  // ${note}` : ""}`;

function appearanceLine(target, solid, color) {
  return `${target} = appearance(${solid}, color = "${color}", metalness = 5, roughness = 60)`;
}

// ------------------------------------------------------------------- main

export function generateFlushMountPair(spec) {
  const { panel, opening, clearancePerSideMm: c, chamfer, insert = {}, colors } = spec ?? {};
  gate(panel && opening && chamfer && colors, "spec needs panel, opening, chamfer, colors");
  const { widthMm: W, heightMm: H, thicknessMm: T } = panel;
  gate(W > 0 && H > 0 && T > 0, "panel dims must be positive");
  gate(opening.shape === "rect" || opening.shape === "round", `opening.shape must be rect|round, got ${opening.shape}`);
  const round = opening.shape === "round";
  const ow = round ? opening.diameterMm : opening.widthMm;
  const oh = round ? opening.diameterMm : opening.heightMm;
  gate(ow > 0 && oh > 0, "opening dims must be positive");
  gate(!(opening.cornerRadiusMm > 0), "cornerRadiusMm > 0 not supported in v1 — rect openings emit sharp corners with corner-relief chamfer overshoot");
  gate(c > 0, "clearancePerSideMm must be positive — a flush fit is a deliberate clearance, not zero");
  const { angleDeg: A, depthMm: d } = chamfer;
  gate(A > 5 && A < 80, `chamfer.angleDeg must be in (5, 80), got ${A}`);
  gate(d > 0, "chamfer.depthMm must be positive");
  // Rule: the lead-in must be able to swallow the total lateral play.
  gate(d + EPS >= 2 * c, `chamfer.depthMm (${d}) must be >= 2 x clearancePerSideMm (${two(2 * c)}) so the lead-in can absorb the play`);
  gate(d <= T - 0.2, `chamfer.depthMm (${d}) must leave >= 0.2mm of straight opening wall (panel is ${T}mm)`);
  const lip = insert.lipMm ?? 0;
  gate(lip >= 0, "insert.lipMm must be >= 0");
  gate(/^#[0-9a-fA-F]{6}$/.test(colors.panel ?? "") && /^#[0-9a-fA-F]{6}$/.test(colors.insert ?? ""), "colors.panel and colors.insert must be #rrggbb hex");

  // Derived, computed once here; emitted as KCL constants with formulas.
  const e = d * Math.tan(rad(A));            // chamfer run (face flare width)
  const reach = (e * (d + OV)) / d;          // taper extended past the face by the cut overlap
  let bite = Math.min(0.35, 0.9 * ((T - d) * e) / d); // overshoot along the taper, keeps booleans off coincident faces
  bite = Math.round(bite * 1000) / 1000;
  gate(bite >= 0.02, `chamfer too deep for the panel: no room to overshoot the taper below the chamfer (thickness ${T}, depth ${d})`);
  const iw = ow - 2 * c;
  const ih = oh - 2 * c;
  gate(iw > 0 && ih > 0, `insert dims collapse: opening - 2 x clearance = ${two(iw)} x ${two(ih)}`);
  gate(reach < Math.min(iw, ih) / 2, `chamfer run (+overlap) ${two(reach)}mm crosses the insert centerline — shrink chamfer or grow the opening`);
  gate(ow + 2 * e + 4 <= W && oh + 2 * e + 4 <= H, "opening + chamfer flare must land on the panel face with >= 2mm margin per side");
  if (lip > 0) gate(ow + 2 * lip + 2 <= W && oh + 2 * lip + 2 <= H, "lip flange must bear on the panel back with >= 1mm margin per side");
  const lipT = lip; // flange thickness = overhang, by convention (documented)
  const totalDepth = T + lipT;

  const dd = { W, H, T, ow, oh, A, d, c, e, reach, bite, iw, ih, lip, lipT, totalDepth, round, colors };
  const panelKcl = round ? roundPanel(dd) : rectPanel(dd);
  const insertKcl = round ? roundInsert(dd) : rectInsert(dd);

  const params = {
    spec: {
      panel: { widthMm: W, heightMm: H, thicknessMm: T },
      opening: round ? { shape: "round", diameterMm: ow } : { shape: "rect", widthMm: ow, heightMm: oh },
      clearancePerSideMm: c,
      chamfer: { angleDeg: A, depthMm: d },
      insert: { lipMm: lip },
      colors: { ...colors },
    },
    derived: {
      chamferRunMm: r4(e),
      chamferAngleConvention: "angle measured from the opening wall (insertion axis): run = depth * tan(angle)",
      insert: round
        ? { diameterMm: r4(iw), depthMm: T, lipOverhangMm: lip, lipThicknessMm: lipT, totalDepthMm: totalDepth, flangeDiameterMm: r4(ow + 2 * lip) }
        : { widthMm: r4(iw), heightMm: r4(ih), depthMm: T, lipOverhangMm: lip, lipThicknessMm: lipT, totalDepthMm: totalDepth, flangeWidthMm: r4(ow + 2 * lip), flangeHeightMm: r4(oh + 2 * lip) },
      totalLateralPlayMm: r4(2 * c),
      entrySide: lip > 0 ? "back" : "front",
      modelOrientation: "both parts modeled with the chamfered lead-in at +Z top; flat show face on z=0 — print as exported, no supports",
      cornerTreatment: round ? "exact revolved chamfer" : "wedge cutters overshoot the corners: slight corner relief, deliberate — eases the fit like a machinist's relief cut",
    },
    formulas: {
      insertWidth: round
        ? `insertDiameter = openingDiameter - 2 x clearance = ${two(iw)}mm`
        : `insertWidth = openingWidth - 2 x clearance = ${two(iw)}mm; insertHeight = openingHeight - 2 x clearance = ${two(ih)}mm`,
      insertDepth: `insertDepth = panelThickness = ${two(T)}mm — the flush relationship`,
      chamferRun: `chamferRun = chamferDepth x tan(chamferAngle) = ${two(e)}mm`,
      leadInRule: `chamferDepth ${two(d)}mm >= 2 x clearance ${two(2 * c)}mm`,
    },
  };

  selfCheck(panelKcl, insertKcl, params, dd);
  return { panelKcl, insertKcl, params };
}

const r4 = (n) => Math.round(n * 10000) / 10000;

// Arithmetic self-check against the EMITTED text, not just intent.
function selfCheck(panelKcl, insertKcl, p, dd) {
  const { iw, ih, d, c, T, round, colors } = dd;
  const got = round ? p.derived.insert.diameterMm : p.derived.insert.widthMm;
  if (Math.abs(got - ((round ? dd.ow : dd.ow) - 2 * c)) > 1e-6) throw new Error("self-check: insert outer dim != opening - 2 x clearance");
  if (!round && Math.abs(p.derived.insert.heightMm - (dd.oh - 2 * c)) > 1e-6) throw new Error("self-check: insert height != opening - 2 x clearance");
  if (d + 1e-9 < 2 * c) throw new Error("self-check: chamfer depth < 2 x clearance");
  const needle = round ? "insertDiameter = openingDiameter - 2 * clearancePerSide" : "insertWidth = openingWidth - 2 * clearancePerSide";
  if (!insertKcl.includes(needle)) throw new Error(`self-check: emitted insert KCL lost its formula constant (${needle})`);
  if (!insertKcl.includes("insertDepth = panelThickness")) throw new Error("self-check: emitted insert KCL lost the flush relationship");
  if (!panelKcl.includes(`"${colors.panel}"`)) throw new Error("self-check: panel color missing from emitted KCL");
  if (!insertKcl.includes(`"${colors.insert}"`)) throw new Error("self-check: insert color missing from emitted KCL");
  if (p.derived.insert.depthMm !== T) throw new Error("self-check: insert depth != panel thickness");
  void iw; void ih;
}

// ------------------------------------------------------------ rect emitters

function chamferConsts(faceRef, faceVal, dd) {
  const { d, e, bite } = dd;
  return [
    constLine("cutOverlap", mm(OV)),
    constLine("chamferRun", "chamferDepth * tan(chamferAngle)", `= ${two(e)}mm — chamferDepth x tan(chamferAngle), the flare width on the entry face`),
    constLine("chamferReach", "chamferRun * (chamferDepth + cutOverlap) / chamferDepth", "taper line extended past the face so the cut clears it"),
    constLine("chamferBite", mm(bite), "overshoot along the taper — keeps boolean cuts off coincident faces"),
    constLine("wedgeLowZ", `${faceRef} - chamferDepth - chamferBite * chamferDepth / chamferRun`, `= ${two(faceVal - d - (bite * d) / e)}mm`),
    constLine("faceTopZ", `${faceRef} + cutOverlap`),
  ];
}

function rectPanel(dd) {
  const { W, H, T, ow, oh, A, d, e, bite, colors } = dd;
  const L = header("PANEL, rect opening", "Opening cut through, entry edge chamfered so the insert leads in.");
  L.push(
    constLine("panelWidth", mm(W)),
    constLine("panelHeight", mm(H)),
    constLine("panelThickness", mm(T)),
    constLine("openingWidth", mm(ow)),
    constLine("openingHeight", mm(oh)),
    constLine("chamferAngle", `${fmt(A)}deg`, "measured from the opening wall"),
    constLine("chamferDepth", mm(d)),
    ...chamferConsts("panelThickness", T, dd),
    constLine("wedgeSpanY", "openingHeight + 2 * chamferReach + 2mm"),
    constLine("wedgeSpanX", "openingWidth + 2 * chamferReach + 2mm"),
    "",
  );
  L.push(rectSketch("plate", { v: W / 2, e: "panelWidth / 2" }, { v: H / 2, e: "panelHeight / 2" }));
  L.push("panelBlank = extrude(plateRegion, length = panelThickness)");
  L.push("hide(plateSketch)");
  L.push("");
  L.push(rectSketch("opening", { v: ow / 2, e: "openingWidth / 2" }, { v: oh / 2, e: "openingHeight / 2" }));
  L.push("openingCutter = extrude(openingRegion, length = panelThickness + 2 * cutOverlap, symmetric = true, method = NEW)");
  L.push("  |> translate(z = panelThickness / 2, global = true)");
  L.push("hide(openingSketch)");
  L.push("");
  const mk = (name, plane, half, sign, span) => {
    L.push(profileSketch(name, plane, wedgeVerts({
      mode: "female", half, sign, d, e, bite, topZ: T,
      topZExpr: "faceTopZ", lowZExpr: "wedgeLowZ",
      reachExpr: "chamferReach", biteExpr: "chamferBite",
    })));
    L.push(`${name}Cutter = extrude(${name}Region, length = ${span}, symmetric = true, method = NEW)`);
    L.push(`hide(${name}Sketch)`);
    L.push("");
  };
  // Entry-edge chamfer: four wedge cutters riding the taper line.
  mk("wedgeEast", "XZ", { v: ow / 2, e: "openingWidth / 2" }, +1, "wedgeSpanY");
  mk("wedgeWest", "XZ", { v: ow / 2, e: "openingWidth / 2" }, -1, "wedgeSpanY");
  mk("wedgeNorth", "YZ", { v: oh / 2, e: "openingHeight / 2" }, +1, "wedgeSpanX");
  mk("wedgeSouth", "YZ", { v: oh / 2, e: "openingHeight / 2" }, -1, "wedgeSpanX");
  L.push("panelCut1 = subtract(panelBlank, tools = [openingCutter])");
  L.push("panelCut2 = subtract(panelCut1, tools = [wedgeEastCutter])");
  L.push("panelCut3 = subtract(panelCut2, tools = [wedgeWestCutter])");
  L.push("panelCut4 = subtract(panelCut3, tools = [wedgeNorthCutter])");
  L.push("panelCut5 = subtract(panelCut4, tools = [wedgeSouthCutter])");
  L.push(appearanceLine("finishedPanel", "panelCut5", colors.panel));
  return L.join("\n") + "\n";
}

function rectInsert(dd) {
  const { T, ow, oh, A, d, c, e, bite, iw, ih, lip, lipT, totalDepth, colors } = dd;
  const lipped = lip > 0;
  const topRef = lipped ? "plugDepth" : "insertDepth";
  const topVal = lipped ? totalDepth : T;
  const L = header(
    `INSERT, rect${lipped ? " with rear lip" : " straight plug"}`,
    "Face sits FLUSH with the panel front. Body = opening - 2 x clearance per side.",
  );
  L.push(
    constLine("openingWidth", mm(ow), "the panel cutout this plugs into"),
    constLine("openingHeight", mm(oh)),
    constLine("clearancePerSide", mm(c)),
    constLine("panelThickness", mm(T)),
    constLine("chamferAngle", `${fmt(A)}deg`),
    constLine("chamferDepth", mm(d)),
    `// insertWidth = openingWidth - 2 x clearancePerSide = ${two(iw)}mm`,
    constLine("insertWidth", "openingWidth - 2 * clearancePerSide"),
    `// insertHeight = openingHeight - 2 x clearancePerSide = ${two(ih)}mm`,
    constLine("insertHeight", "openingHeight - 2 * clearancePerSide"),
    constLine("insertDepth", "panelThickness", "flush: the insert face lands level with the panel face"),
  );
  if (lipped) {
    L.push(
      constLine("lipOverhang", mm(lip), "flange overhang per side behind the panel — the insert cannot fall through"),
      constLine("lipThickness", mm(lipT), "flange thickness = overhang, by convention"),
      constLine("flangeWidth", "openingWidth + 2 * lipOverhang", `= ${two(ow + 2 * lip)}mm`),
      constLine("flangeHeight", "openingHeight + 2 * lipOverhang", `= ${two(oh + 2 * lip)}mm`),
      constLine("plugDepth", "lipThickness + insertDepth", `= ${two(totalDepth)}mm total`),
    );
  }
  L.push(
    ...chamferConsts(topRef, topVal, dd),
    constLine("wedgeSpanY", "insertHeight + 2 * chamferReach + 2mm"),
    constLine("wedgeSpanX", "insertWidth + 2 * chamferReach + 2mm"),
    "",
  );
  if (lipped) {
    L.push(rectSketch("flange", { v: ow / 2 + lip, e: "flangeWidth / 2" }, { v: oh / 2 + lip, e: "flangeHeight / 2" }));
    L.push("fullBlank = extrude(flangeRegion, length = plugDepth)");
    L.push("hide(flangeSketch)");
    L.push("");
    L.push(rectSketch("ringBlank", { v: ow / 2 + lip + OV, e: "flangeWidth / 2 + cutOverlap" }, { v: oh / 2 + lip + OV, e: "flangeHeight / 2 + cutOverlap" }));
    L.push("ringBlankSolid = extrude(ringBlankRegion, length = insertDepth + 2 * cutOverlap, method = NEW)");
    L.push("  |> translate(z = lipThickness, global = true)");
    L.push("hide(ringBlankSketch)");
    L.push("");
    L.push(rectSketch("bodyHole", { v: iw / 2, e: "insertWidth / 2" }, { v: ih / 2, e: "insertHeight / 2" }));
    L.push("bodyHoleSolid = extrude(bodyHoleRegion, length = insertDepth + 4 * cutOverlap, method = NEW)");
    L.push("  |> translate(z = lipThickness - cutOverlap, global = true)");
    L.push("hide(bodyHoleSketch)");
    L.push("");
    L.push("// The flange stays; everything above it outside the body goes.");
    L.push("ringCutter = subtract(ringBlankSolid, tools = [bodyHoleSolid])");
    L.push("plugCut1 = subtract(fullBlank, tools = [ringCutter])");
  } else {
    L.push(rectSketch("body", { v: iw / 2, e: "insertWidth / 2" }, { v: ih / 2, e: "insertHeight / 2" }));
    L.push("plugCut1 = extrude(bodyRegion, length = insertDepth)");
    L.push("hide(bodySketch)");
  }
  L.push("");
  const mk = (name, plane, half, sign, span) => {
    L.push(profileSketch(name, plane, wedgeVerts({
      mode: "male", half, sign, d, e, bite, topZ: topVal,
      topZExpr: "faceTopZ", lowZExpr: "wedgeLowZ",
      reachExpr: "chamferReach", biteExpr: "chamferBite",
    })));
    L.push(`${name}Cutter = extrude(${name}Region, length = ${span}, symmetric = true, method = NEW)`);
    L.push(`hide(${name}Sketch)`);
    L.push("");
  };
  // Mating chamfer on the leading edge, matching the panel's angle x depth.
  mk("wedgeEast", "XZ", { v: iw / 2, e: "insertWidth / 2" }, +1, "wedgeSpanY");
  mk("wedgeWest", "XZ", { v: iw / 2, e: "insertWidth / 2" }, -1, "wedgeSpanY");
  mk("wedgeNorth", "YZ", { v: ih / 2, e: "insertHeight / 2" }, +1, "wedgeSpanX");
  mk("wedgeSouth", "YZ", { v: ih / 2, e: "insertHeight / 2" }, -1, "wedgeSpanX");
  L.push("plugCut2 = subtract(plugCut1, tools = [wedgeEastCutter])");
  L.push("plugCut3 = subtract(plugCut2, tools = [wedgeWestCutter])");
  L.push("plugCut4 = subtract(plugCut3, tools = [wedgeNorthCutter])");
  L.push("plugCut5 = subtract(plugCut4, tools = [wedgeSouthCutter])");
  L.push(appearanceLine("finishedInsert", "plugCut5", colors.insert));
  return L.join("\n") + "\n";
}

// ----------------------------------------------------------- round emitters

function roundPanel(dd) {
  const { W, H, T, ow, A, d, e, colors } = dd;
  const R = ow / 2;
  const reach = (e * (d + OV)) / d;
  const L = header("PANEL, round opening", "Bore cut through, entry edge chamfered so the insert leads in.");
  L.push(
    constLine("panelWidth", mm(W)),
    constLine("panelHeight", mm(H)),
    constLine("panelThickness", mm(T)),
    constLine("openingDiameter", mm(ow)),
    constLine("chamferAngle", `${fmt(A)}deg`, "measured from the bore wall"),
    constLine("chamferDepth", mm(d)),
    constLine("cutOverlap", mm(OV)),
    constLine("chamferRun", "chamferDepth * tan(chamferAngle)", `= ${two(e)}mm — flare width on the entry face`),
    constLine("chamferReach", "chamferRun * (chamferDepth + cutOverlap) / chamferDepth"),
    constLine("faceTopZ", "panelThickness + cutOverlap"),
    "",
  );
  L.push(rectSketch("plate", { v: W / 2, e: "panelWidth / 2" }, { v: H / 2, e: "panelHeight / 2" }));
  L.push("panelBlank = extrude(plateRegion, length = panelThickness)");
  L.push("hide(plateSketch)");
  L.push("");
  // One revolved cutter: straight bore plus the chamfer cone, single profile.
  L.push(profileSketch("bore", "XZ", [
    { x: { v: 0, e: "" }, y: { v: -OV, e: "cutOverlap" } },
    { x: { v: R, e: "openingDiameter / 2" }, y: { v: -OV, e: "cutOverlap" } },
    { x: { v: R, e: "openingDiameter / 2" }, y: { v: T - d, e: "panelThickness - chamferDepth" } },
    { x: { v: R + reach, e: "openingDiameter / 2 + chamferReach" }, y: { v: T + OV, e: "faceTopZ" } },
    { x: { v: 0, e: "" }, y: { v: T + OV, e: "faceTopZ" } },
  ], { x: R / 2, y: T / 2 }));
  L.push("boreCutter = revolve(boreRegion, axis = Y)");
  L.push("hide(boreSketch)");
  L.push("");
  L.push("panelCut1 = subtract(panelBlank, tools = [boreCutter])");
  L.push(appearanceLine("finishedPanel", "panelCut1", colors.panel));
  return L.join("\n") + "\n";
}

function roundInsert(dd) {
  const { T, ow, A, d, c, e, iw, lip, lipT, totalDepth, colors } = dd;
  const ri = iw / 2;
  const lipped = lip > 0;
  const L = header(
    `INSERT, round${lipped ? " with rear lip" : " straight plug"}`,
    "Face sits FLUSH with the panel front. One revolved profile — chamfer baked in.",
  );
  L.push(
    constLine("openingDiameter", mm(ow), "the panel bore this plugs into"),
    constLine("clearancePerSide", mm(c)),
    constLine("panelThickness", mm(T)),
    constLine("chamferAngle", `${fmt(A)}deg`),
    constLine("chamferDepth", mm(d)),
    `// insertDiameter = openingDiameter - 2 x clearancePerSide = ${two(iw)}mm`,
    constLine("insertDiameter", "openingDiameter - 2 * clearancePerSide"),
    constLine("insertDepth", "panelThickness", "flush: the insert face lands level with the panel face"),
    constLine("chamferRun", "chamferDepth * tan(chamferAngle)", `= ${two(e)}mm`),
  );
  if (lipped) {
    L.push(
      constLine("lipOverhang", mm(lip), "flange overhang per side behind the panel"),
      constLine("lipThickness", mm(lipT), "flange thickness = overhang, by convention"),
      constLine("flangeDiameter", "openingDiameter + 2 * lipOverhang", `= ${two(ow + 2 * lip)}mm`),
      constLine("plugDepth", "lipThickness + insertDepth", `= ${two(totalDepth)}mm total`),
    );
  }
  L.push("");
  const verts = lipped
    ? [
        { x: { v: 0, e: "" }, y: { v: 0, e: "" } },
        { x: { v: ow / 2 + lip, e: "flangeDiameter / 2" }, y: { v: 0, e: "" } },
        { x: { v: ow / 2 + lip, e: "flangeDiameter / 2" }, y: { v: lipT, e: "lipThickness" } },
        { x: { v: ri, e: "insertDiameter / 2" }, y: { v: lipT, e: "lipThickness" } },
        { x: { v: ri, e: "insertDiameter / 2" }, y: { v: lipT + T - d, e: "plugDepth - chamferDepth" } },
        { x: { v: ri - e, e: "insertDiameter / 2 - chamferRun" }, y: { v: lipT + T, e: "plugDepth" } },
        { x: { v: 0, e: "" }, y: { v: lipT + T, e: "plugDepth" } },
      ]
    : [
        { x: { v: 0, e: "" }, y: { v: 0, e: "" } },
        { x: { v: ri, e: "insertDiameter / 2" }, y: { v: 0, e: "" } },
        { x: { v: ri, e: "insertDiameter / 2" }, y: { v: T - d, e: "insertDepth - chamferDepth" } },
        { x: { v: ri - e, e: "insertDiameter / 2 - chamferRun" }, y: { v: T, e: "insertDepth" } },
        { x: { v: 0, e: "" }, y: { v: T, e: "insertDepth" } },
      ];
  L.push(profileSketch("plug", "XZ", verts, { x: ri / 2, y: lipped ? lipT / 2 : T / 2 }));
  L.push("plugBody = revolve(plugRegion, axis = Y)");
  L.push("hide(plugSketch)");
  L.push("");
  L.push(appearanceLine("finishedInsert", "plugBody", colors.insert));
  return L.join("\n") + "\n";
}

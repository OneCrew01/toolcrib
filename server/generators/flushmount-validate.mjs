// Flush-mount validation runner. This repo does not trust unexecuted
// geometry, so this script:
//   1. generates the sample pair + printer coupon set and writes them
//      under samples/flush-mount/
//   2. probes POST /file/execute/kcl (the litterbox surface) — unexplored;
//      the answer is a field note either way
//   3. falls back to modeling-websocket bounding boxes of command-built
//      outline solids to validate the derived dimensions
//   4. writes samples/flush-mount/validation.json
//
// Run from repo root:  node server/generators/flushmount-validate.mjs
// With --write-samples: generate + write the sample set only — no network
// probes, and validation.json is left untouched (the live-engine validation
// loop records execute/export/mass results there instead).
// Token comes from .env via loadToken(); it is never printed.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateFlushMountPair } from "./flushmount.mjs";
import { boxBoundingBox } from "./ws-helpers.mjs";
import { loadToken } from "../lib/zoo.mjs";

const BASE = "https://api.zoo.dev";
const OUT = join("samples", "flush-mount");
const WRITE_ONLY = process.argv.includes("--write-samples");
const token = WRITE_ONLY ? null : loadToken();

const COLORS = { panel: "#2e5e78", insert: "#e07a2f" };

const mainSpec = {
  panel: { widthMm: 60, heightMm: 40, thicknessMm: 3 },
  opening: { shape: "rect", widthMm: 30, heightMm: 20 },
  clearancePerSideMm: 0.15,
  chamfer: { angleDeg: 45, depthMm: 0.8 },
  insert: { lipMm: 2 },
  colors: COLORS,
};

const roundSpec = {
  panel: { widthMm: 50, heightMm: 50, thicknessMm: 3 },
  opening: { shape: "round", diameterMm: 25 },
  clearancePerSideMm: 0.15,
  chamfer: { angleDeg: 45, depthMm: 0.8 },
  insert: { lipMm: 2 },
  colors: COLORS,
};

const couponSpec = (clearance) => ({
  panel: { widthMm: 40, heightMm: 40, thicknessMm: 3 },
  opening: { shape: "rect", widthMm: 20, heightMm: 20 },
  clearancePerSideMm: clearance,
  chamfer: { angleDeg: 45, depthMm: 0.8 },
  insert: { lipMm: 0 },
  colors: COLORS,
});

function writePair(dir, spec) {
  const { panelKcl, insertKcl, params } = generateFlushMountPair(spec);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "panel.kcl"), panelKcl);
  writeFileSync(join(dir, "insert.kcl"), insertKcl);
  writeFileSync(join(dir, "params.json"), JSON.stringify(params, null, 2) + "\n");
  console.log(`wrote ${dir} (panel ${panelKcl.length}B, insert ${insertKcl.length}B)`);
  return { panelKcl, insertKcl, params };
}

async function probeExecute(lang, body, output) {
  const url = `${BASE}/file/execute/${lang}${output ? `?output=${encodeURIComponent(output)}` : ""}`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
      body,
      signal: AbortSignal.timeout(90_000),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* keep raw */ }
    return {
      url: url.replace(/\?.*$/, output ? `?output=${output}` : ""),
      status: res.status,
      ms: Date.now() - t0,
      body: json ?? text.slice(0, 500),
    };
  } catch (e) {
    return { url, status: "fetch-error", ms: Date.now() - t0, body: String(e.message).slice(0, 300) };
  }
}

const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

function checkBox(label, bounds, [w, h, t]) {
  const { x: dx, y: dy, z: dz } = bounds.dims;
  const ok = near(dx, w) && near(dy, h) && near(dz, t);
  console.log(`ws bbox ${label}: ${dx.toFixed(3)} x ${dy.toFixed(3)} x ${dz.toFixed(3)} mm — expected ${w} x ${h} x ${t} — ${ok ? "MATCH" : "MISMATCH"}`);
  return { label, expectedMm: { x: w, y: h, z: t }, measuredMm: { x: dx, y: dy, z: dz }, match: ok };
}

// ------------------------------------------------------------------ run

const validation = {
  generatedAt: new Date().toISOString(),
  executeProbe: {},
  wsBoundingBoxes: [],
  notes: [],
};

// 1. generate + write everything
const main = writePair(join(OUT, "pair-rect-c0.15"), mainSpec);
writePair(join(OUT, "pair-round-c0.15"), roundSpec);
const coupons = {};
for (const c of [0.1, 0.15, 0.2, 0.25]) {
  coupons[c] = writePair(join(OUT, "coupons", `c${c.toFixed(2)}`), couponSpec(c));
}

if (WRITE_ONLY) {
  console.log("\n--write-samples: generation only; probes skipped, validation.json untouched.");
  process.exit(0);
}

// 2. execute probe — kcl first (the actual question), node as control
console.log("\n--- POST /file/execute probes ---");
validation.executeProbe.kcl = await probeExecute("kcl", main.panelKcl, "part.stl");
console.log(`kcl: ${validation.executeProbe.kcl.status} in ${validation.executeProbe.kcl.ms}ms -> ${JSON.stringify(validation.executeProbe.kcl.body).slice(0, 300)}`);
validation.executeProbe.kclNoOutput = await probeExecute("kcl", main.panelKcl);
console.log(`kcl (no output param): ${validation.executeProbe.kclNoOutput.status} -> ${JSON.stringify(validation.executeProbe.kclNoOutput.body).slice(0, 300)}`);
validation.executeProbe.nodeControl = await probeExecute("node", 'console.log("toolcrib litterbox control");');
console.log(`node control: ${validation.executeProbe.nodeControl.status} -> ${JSON.stringify(validation.executeProbe.nodeControl.body).slice(0, 300)}`);
validation.executeProbe.pythonControl = await probeExecute("python", 'print("toolcrib litterbox control")');
console.log(`python control: ${validation.executeProbe.pythonControl.status} -> ${JSON.stringify(validation.executeProbe.pythonControl.body).slice(0, 300)}`);

const kclExecuted = validation.executeProbe.kcl.status === 200 || validation.executeProbe.kcl.status === 201;

// 3. websocket bounding-box fallback (outline solids, one per session)
if (!kclExecuted) {
  console.log("\n--- websocket bounding-box validation (fallback route) ---");
  const runs = [
    ["main panel outline", { widthMm: 60, heightMm: 40, depthMm: 3 }, [60, 40, 3]],
    ["main insert body outline", { widthMm: main.params.derived.insert.widthMm, heightMm: main.params.derived.insert.heightMm, depthMm: 3 }, [29.7, 19.7, 3]],
    ["coupon c0.10 insert outline", { widthMm: coupons[0.1].params.derived.insert.widthMm, heightMm: coupons[0.1].params.derived.insert.heightMm, depthMm: 3 }, [19.8, 19.8, 3]],
  ];
  for (const [label, dims, expect] of runs) {
    try {
      const bounds = await boxBoundingBox(dims);
      validation.wsBoundingBoxes.push(checkBox(label, bounds, expect));
    } catch (e) {
      console.log(`ws bbox ${label}: FAILED — ${e.message}`);
      validation.wsBoundingBoxes.push({ label, error: e.message });
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  validation.notes.push("KCL could not be executed server-side; derived dimensions validated by rebuilding outline solids over the modeling websocket and reading bounding boxes back from the engine.");
} else {
  validation.notes.push("KCL executed server-side via /file/execute/kcl.");
}

writeFileSync(join(OUT, "validation.json"), JSON.stringify(validation, null, 2) + "\n");
console.log(`\nwrote ${join(OUT, "validation.json")}`);

// Package track tests. Real fixtures only: the STL/KCL/STEP under
// samples/plain-plate-stl/ came off the live API (see samples/*/validation.json
// for the Engine's own mass reading). Every bundle lands in a temp dir.

import { test } from "node:test";
import assert from "node:assert";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeStl } from "./stl-analyze.mjs";
import { assemblePackage, dodCheck, packageHashOf, ExportError, PDF_SECTIONS } from "./assemble.mjs";
import { validateGenerationRequest } from "../state/request.mjs";

const FIXTURES = new URL("../../samples/plain-plate-stl/", import.meta.url);
const read = (rel, base = FIXTURES) => readFileSync(new URL(rel, base));

const ENGINE_MASS_G = 13.078606393829295; // samples/plain-plate-stl/validation.json, density 2700 kg/m3
const DENSITY_G_MM3 = 0.0027;

const request = (() => {
  const raw = JSON.parse(read("../requests/plain-plate.json").toString());
  const r = validateGenerationRequest(raw);
  assert.equal(r.ok, true);
  return r.request;
})();

// Frozen timestamps: assembly must be reproducible from inputs alone.
const fakeJob = () => ({
  jobId: "job-plain-plate-0001",
  rev: 1,
  state: "PDF_GENERATION",
  request,
  createdAt: "2026-07-22T08:40:00.000Z",
  updatedAt: "2026-07-22T08:45:00.000Z",
});

const fixtureArtifacts = () => ({
  partName: "plain-plate",
  kcl: read("part.kcl"),
  stl: read("source.stl"),
  step: read("source.step"),
  machine: JSON.parse(read("../machines/bambu-p1s.json").toString()),
  apiRun: {
    totalCalls: 3,
    minutesUsed: 1.42,
    calls: [
      { path: "/ai/text-to-cad/step?kcl=true", method: "POST" },
      { path: "/async/operations/{id}", method: "GET" },
      { path: "/file/mass", method: "POST" },
    ],
  },
  reference: [{
    parameter: "edge-distance",
    citation: { min: "AC 43.13-1B (Chg 1), ch.4 sec.4, par.4-58" },
    watermark: "DRAFT - NOT VERIFIED",
  }],
});

const fixtureGates = (analysis) => [
  {
    gate: "mass-cross-check", result: "PASS",
    threshold: `within 1% of Engine mass ${ENGINE_MASS_G.toFixed(4)} g`,
    measured: `${(analysis.volumeMm3 * DENSITY_G_MM3).toFixed(4)} g (local stl-analyze)`,
  },
  { gate: "watertight", result: "PASS", threshold: "true", measured: String(analysis.watertight) },
  {
    gate: "build-volume-fit", result: "PASS", threshold: "<= 256 x 256 x 256 mm",
    measured: `${analysis.bboxMm.x} x ${analysis.bboxMm.y} x ${analysis.bboxMm.z} mm`,
  },
  { gate: "dxf-export", result: "SKIPPED", notes: "2D route not requested for this job" },
];

const newOut = () => mkdtempSync(join(tmpdir(), "toolcrib-pkg-"));
const buildFixtureBundle = (overrides = {}) => {
  const analysis = analyzeStl(read("source.stl"));
  return assemblePackage(fakeJob(), fixtureArtifacts(), fixtureGates(analysis), {
    outRoot: newOut(), ...overrides,
  });
};

// ---- stl-analyze -----------------------------------------------------------

test("fixture STL: local analyzer agrees with the Engine's mass to <1%", () => {
  const a = analyzeStl(read("source.stl"));
  assert.ok(a.triangles > 0);
  assert.equal(a.watertight, true);
  for (const [axis, want] of [["x", 50], ["y", 50], ["z", 2]])
    assert.ok(Math.abs(a.bboxMm[axis] - want) < 0.01, `bbox ${axis}: ${a.bboxMm[axis]}`);
  const localMassG = a.volumeMm3 * DENSITY_G_MM3;
  const deltaPct = Math.abs(localMassG - ENGINE_MASS_G) / ENGINE_MASS_G * 100;
  assert.ok(deltaPct < 1, `local ${localMassG} g vs Engine ${ENGINE_MASS_G} g: ${deltaPct}%`);
});

// 10 mm cube, outward winding — 12 triangles, volume exactly 1000 mm3.
function cubeTris(s = 10) {
  return [
    [[0, 0, 0], [0, s, 0], [s, s, 0]], [[0, 0, 0], [s, s, 0], [s, 0, 0]], // -z
    [[0, 0, s], [s, 0, s], [s, s, s]], [[0, 0, s], [s, s, s], [0, s, s]], // +z
    [[0, 0, 0], [s, 0, 0], [s, 0, s]], [[0, 0, 0], [s, 0, s], [0, 0, s]], // -y
    [[0, s, 0], [s, s, s], [s, s, 0]], [[0, s, 0], [0, s, s], [s, s, s]], // +y
    [[0, 0, 0], [0, 0, s], [0, s, s]], [[0, 0, 0], [0, s, s], [0, s, 0]], // -x
    [[s, 0, 0], [s, s, 0], [s, s, s]], [[s, 0, 0], [s, s, s], [s, 0, s]], // +x
  ];
}

function binaryStl(tris) {
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.write("binary header that even says solid — ignored", 0, "latin1");
  buf.writeUInt32LE(tris.length, 80);
  let o = 84;
  for (const t of tris) {
    o += 12; // normal left zero — analyzer must not trust it anyway
    for (const v of t) for (const c of v) { buf.writeFloatLE(c, o); o += 4; }
    o += 2;
  }
  return buf;
}

test("binary STL: cube measures exactly; a missing facet kills watertight", () => {
  const cube = analyzeStl(binaryStl(cubeTris()));
  assert.deepEqual(cube.bboxMm, { x: 10, y: 10, z: 10 });
  assert.equal(cube.triangles, 12);
  assert.equal(cube.watertight, true);
  assert.ok(Math.abs(cube.volumeMm3 - 1000) < 1e-9, `volume ${cube.volumeMm3}`);

  const holed = analyzeStl(binaryStl(cubeTris().slice(0, 11)));
  assert.equal(holed.watertight, false);
});

test("analyzeStl rejects junk", () => {
  assert.throws(() => analyzeStl(Buffer.alloc(0)), TypeError);
  assert.throws(() => analyzeStl(Buffer.from("solid nothing\nendsolid\n")), RangeError);
});

// ---- assemblePackage --------------------------------------------------------

test("fixture bundle: all files land, hashes recompute, packageHash matches the documented recipe", () => {
  const { bundleDir, manifest } = buildFixtureBundle();

  for (const rel of [
    "generationRequest.json", "designIntent.md", "cad/plain-plate.kcl",
    "exports/plain-plate.stl", "exports/plain-plate.step",
    "reports/validationReport.md", "reports/manufacturingPackage.pdf",
    "logs/apiRun.json", "approvals/approvalRecord.json", "manifest.json",
  ])
    assert.doesNotThrow(() => readFileSync(join(bundleDir, rel)), `${rel} missing`);

  // every present entry re-hashes from disk
  for (const f of manifest.files.filter((f) => f.status === "present")) {
    const bytes = readFileSync(join(bundleDir, f.path));
    assert.equal(bytes.length, f.bytes, `${f.path} bytes`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), f.sha256, `${f.path} sha256`);
  }

  // the judge's three-line recompute, done longhand — not via packageHashOf
  const hashes = manifest.files.filter((f) => f.status === "present").map((f) => f.sha256).sort();
  assert.equal(createHash("sha256").update(hashes.join("\n")).digest("hex"), manifest.packageHash);
  assert.equal(packageHashOf(hashes), manifest.packageHash);

  // manifest spec fields
  assert.equal(manifest.jobId, "job-plain-plate-0001");
  assert.equal(manifest.revision, 1);
  assert.ok(manifest.projectId && manifest.workflowId && manifest.completedAt);
  assert.deepEqual(manifest.apiRuns, { totalCalls: 3, minutesUsed: 1.42 });

  // png could not be produced (no render route) — skipped in files AND warned
  const png = manifest.files.find((f) => f.path.startsWith("previews/"));
  assert.equal(png.status, "skipped");
  assert.ok(png.note.includes("render route"));
  assert.ok(manifest.warnings.some((w) => w.includes(png.path)));
  // draft-watermarked reference lookup surfaces as a warning too
  assert.ok(manifest.warnings.some((w) => w.includes("DRAFT - NOT VERIFIED")));
});

// The bundle's entire claim is that every number in it was measured. An
// unmeasured minute count must therefore be legibly absent, not quietly zero:
// a reader has to be able to tell "nobody measured this" from "it cost nothing."
test("unmeasured API minutes seal as null with a note — never as a zero posing as a reading", () => {
  const artifacts = fixtureArtifacts();
  delete artifacts.apiRun.minutesUsed; // the pipeline supplies no measurement
  const analysis = analyzeStl(read("source.stl"));
  const { bundleDir, manifest } = assemblePackage(fakeJob(), artifacts, fixtureGates(analysis), {
    outRoot: newOut(),
  });

  assert.strictEqual(manifest.apiRuns.minutesUsed, null);
  assert.notStrictEqual(manifest.apiRuns.minutesUsed, 0);
  assert.ok(/NOT MEASURED/.test(manifest.apiRuns.minutesUsedNote), manifest.apiRuns.minutesUsedNote);
  assert.ok(/FN-031/.test(manifest.apiRuns.minutesUsedNote), "note must cite the field note");

  // the same honesty in the log file the manifest hashes
  const log = JSON.parse(readFileSync(join(bundleDir, "logs/apiRun.json"), "utf8"));
  assert.strictEqual(log.minutesUsed, null);
  assert.ok(/NOT MEASURED/.test(log.minutesUsedNote));

  // and a genuine measurement still ships as a number, unqualified
  const measured = buildFixtureBundle().manifest;
  assert.strictEqual(measured.apiRuns.minutesUsed, 1.42);
  assert.strictEqual(measured.apiRuns.minutesUsedNote, undefined);
});

test("packageHash is stable: same inputs, two assemblies, identical manifests", () => {
  const a = buildFixtureBundle();
  const b = buildFixtureBundle();
  assert.equal(a.manifest.packageHash, b.manifest.packageHash);
  assert.deepEqual(a.manifest, b.manifest);
});

test("PDF: opens as PDF and carries all 13 populated sections", () => {
  const { bundleDir } = buildFixtureBundle();
  const pdf = readFileSync(join(bundleDir, "reports/manufacturingPackage.pdf"));
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  const text = pdf.toString("latin1");
  assert.equal(PDF_SECTIONS.length, 13);
  for (const title of PDF_SECTIONS)
    assert.ok(text.includes(title), `PDF missing section "${title}"`);
  // spot-check real data made it in: jobId, Engine-adjacent mass, machine
  assert.ok(text.includes("job-plain-plate-0001"));
  assert.ok(text.includes("13.08"), "derived mass not in PDF");
  assert.ok(text.includes("P1S"), "machine profile not in PDF");
});

test("validationReport.md and manifest.validation tell the same story", () => {
  const { bundleDir, manifest } = buildFixtureBundle();
  const report = readFileSync(join(bundleDir, "reports/validationReport.md"), "utf8");
  assert.equal(manifest.validation.length, 4);
  for (const v of manifest.validation) {
    assert.ok(["PASS", "FAIL", "SKIPPED"].includes(v.result));
    assert.ok(report.includes(v.gate), `report missing gate ${v.gate}`);
    assert.ok(report.includes(v.result), `report missing result for ${v.gate}`);
  }
});

test("dodCheck: complete on the fixture bundle; names what a tamperer removes", () => {
  const { bundleDir } = buildFixtureBundle();
  assert.deepEqual(dodCheck(bundleDir), { complete: true, misses: [] });

  rmSync(join(bundleDir, "reports/validationReport.md"));
  const after = dodCheck(bundleDir);
  assert.equal(after.complete, false);
  assert.ok(after.misses.some((m) => m.includes("validationReport.md")), after.misses.join("; "));
});

test("missing REQUIRED stl: throws ExportError when a mesh was expected", () => {
  const artifacts = fixtureArtifacts();
  delete artifacts.stl;
  assert.throws(
    () => assemblePackage(fakeJob(), artifacts, [], { outRoot: newOut() }),
    (e) => e instanceof ExportError && e.code === "MISSING_STL" && /FN-011/.test(e.message),
  );
});

test("expectMesh:false parks a mesh-less bundle — skip noted twice, DoD still fails it", () => {
  const artifacts = fixtureArtifacts();
  delete artifacts.stl;
  const { bundleDir, manifest } = assemblePackage(fakeJob(), artifacts, [], {
    outRoot: newOut(), expectMesh: false,
  });
  const stlEntry = manifest.files.find((f) => f.path.endsWith(".stl"));
  assert.equal(stlEntry.status, "skipped");
  assert.ok(manifest.warnings.some((w) => w.includes(stlEntry.path)));
  const dod = dodCheck(bundleDir);
  assert.equal(dod.complete, false);
  assert.ok(dod.misses.some((m) => m.includes("stl") && m.includes("REQUIRED")));
});

test("gate results are a closed vocabulary", () => {
  assert.throws(
    () => assemblePackage(fakeJob(), fixtureArtifacts(), [{ gate: "x", result: "MAYBE" }], { outRoot: newOut() }),
    RangeError,
  );
});

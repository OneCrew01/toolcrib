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
import { assemblePackage, dodCheck, packageHashOf, ExportError, PDF_SECTIONS, PDF_ADVISORY, SIGNATURE_MEANING } from "./assemble.mjs";
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
const assembleWith = (apiRun) => {
  const artifacts = fixtureArtifacts();
  if (apiRun === undefined) delete artifacts.apiRun;
  else artifacts.apiRun = apiRun;
  const analysis = analyzeStl(read("source.stl"));
  return assemblePackage(fakeJob(), artifacts, fixtureGates(analysis), { outRoot: newOut() });
};

test("a run that issued API calls but measured no minutes seals null — and says so in the PDF too", () => {
  const { bundleDir, manifest } = assembleWith({ totalCalls: 3, calls: [] });

  assert.strictEqual(manifest.apiRuns.minutesUsed, null);
  assert.strictEqual(manifest.apiRuns.totalCalls, 3);
  assert.match(manifest.apiRuns.minutesUsedNote, /NOT MEASURED/);
  assert.match(manifest.apiRuns.minutesUsedNote, /FN-031/, "note must cite the field note");
  // It may not claim the run was free — that is the sentence this whole
  // three-state split exists to keep off runs that did spend.
  assert.doesNotMatch(manifest.apiRuns.minutesUsedNote, /issued ZERO/);

  // the same account in the log file the manifest hashes
  const log = JSON.parse(readFileSync(join(bundleDir, "logs/apiRun.json"), "utf8"));
  assert.strictEqual(log.minutesUsed, null);
  assert.strictEqual(log.totalCalls, 3);
  assert.strictEqual(log.minutesUsedNote, manifest.apiRuns.minutesUsedNote);

  // ...and in section 9 of the document a human signs. This assertion is the
  // regression lock on ORDERING: warnings is passed to the PDF builder by
  // reference and rendered during that call, so computing the minutes account
  // after the build would leave the PDF silent while the manifest warned.
  const warning = manifest.warnings.find((w) => /API minutes/.test(w));
  assert.ok(warning, `no unmeasured-minutes warning in ${JSON.stringify(manifest.warnings)}`);
  assert.match(warning, /Unknown, not zero/);
  // matched on single tokens: the renderer word-wraps, so "NOT MEASURED" can
  // legitimately straddle a line break while every word survives intact.
  const pdf = readFileSync(join(bundleDir, "reports/manufacturingPackage.pdf")).toString("latin1");
  assert.ok(pdf.includes("MEASURED"), "unmeasured minutes never reached the signed PDF");
  assert.ok(pdf.includes("FN-031"), "signed PDF states the fact without citing where it is documented");

  // and a genuine measurement still ships as a number, unqualified and unwarned
  const measured = buildFixtureBundle().manifest;
  assert.strictEqual(measured.apiRuns.minutesUsed, 1.42);
  assert.strictEqual(measured.apiRuns.minutesUsedNote, undefined);
  assert.strictEqual(measured.warnings.find((w) => /API minutes/.test(w)), undefined);
});

// The other half of the same honesty: a run that provably dispatched nothing
// consumed nothing, and a bundle that stamps "not because this run consumed
// zero" onto it is asserting something false — in the very field added to make
// the distinction legible, three lines from a warning saying "zero network".
test("a zero-request run seals 0 with its basis — the bundle never denies its own zero", () => {
  const { bundleDir, manifest } = assembleWith({ totalCalls: 0, calls: [] });

  assert.strictEqual(manifest.apiRuns.totalCalls, 0);
  assert.strictEqual(manifest.apiRuns.minutesUsed, 0);
  assert.match(manifest.apiRuns.minutesUsedNote, /issued ZERO/);
  assert.match(manifest.apiRuns.minutesUsedNote, /FN-031/);
  // 0 here is entailed by a counted fact, not read off a billing surface, and
  // the note has to keep those apart rather than posing as a meter reading.
  assert.match(manifest.apiRuns.minutesUsedNote, /NOT read off a billing surface/);
  assert.doesNotMatch(manifest.apiRuns.minutesUsedNote, /NOT MEASURED/);

  const log = JSON.parse(readFileSync(join(bundleDir, "logs/apiRun.json"), "utf8"));
  assert.strictEqual(log.minutesUsed, 0);
  assert.strictEqual(log.minutesUsedNote, manifest.apiRuns.minutesUsedNote);
  // nothing to disclose, so no warning noise on the signed document
  assert.strictEqual(manifest.warnings.find((w) => /API minutes/.test(w)), undefined);
});

// 0 is licensed by a COUNT of zero and by nothing else. A caller that never
// counted gets null — not the length of some array that happens to be nearby,
// which is how `totalCalls: 2` came to describe a run that opened no socket.
test("an uncounted run seals totalCalls null — never a zero, never an array length", () => {
  const { manifest } = assembleWith({
    calls: [{ path: "/a", method: "GET" }, { path: "/b", method: "GET" }],
  });

  assert.strictEqual(manifest.apiRuns.totalCalls, null);
  assert.match(manifest.apiRuns.totalCallsNote, /NOT a claim that it issued none/);
  // an uncounted run must not inherit the zero-request licence for minutes
  assert.strictEqual(manifest.apiRuns.minutesUsed, null);
  assert.match(manifest.apiRuns.minutesUsedNote, /NOT MEASURED/);

  // no apiRun at all: same answer, plus the "nothing was recorded" note that
  // logs/apiRun.json carries — both sealed surfaces, one story.
  const bare = assembleWith(undefined).manifest;
  assert.strictEqual(bare.apiRuns.totalCalls, null);
  assert.strictEqual(bare.apiRuns.minutesUsed, null);
  assert.match(bare.apiRuns.note, /no API activity recorded/);
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

// Every rendered run of text in the document, in page order, rejoined into one
// string. The writer word-wraps into separate Tj operators, so a sentence a
// human reads as one sentence is several literals in the file; asserting on
// substrings without rejoining them can only ever check single words.
function pdfProse(bundleDir) {
  const bytes = readFileSync(join(bundleDir, "reports/manufacturingPackage.pdf")).toString("latin1");
  return [...bytes.matchAll(/\((.*?)\) Tj/g)].map((m) => m[1]).join(" ").replace(/\s+/g, " ");
}

// The printed package is the one artifact in this repo designed to be carried
// to a machine and signed by a named person, and for most of this build it was
// the only output that disclaimed nothing at all — a Setup Checklist, an
// Inspection Checklist, an Approval Record and a signature line, with no
// statement anywhere that the numbers above them were computed by software and
// checked by nobody. Signed, it looks exactly like a conformity record.
//
// So the advisory and what a signature actually means are asserted here as
// whole sentences on the rendered page, not as a constant existing in a module.
// A refactor that stops calling doc.text() still exports both strings.
test("the printed package disclaims itself, and says what signing it does not mean", () => {
  const { bundleDir } = assemblePackage(fakeJob(), fixtureArtifacts(), [], { outRoot: newOut() });
  const prose = pdfProse(bundleDir);

  assert.ok(prose.includes(PDF_ADVISORY), "the advisory never reached the page a human prints");
  // Under the title, ahead of every number it qualifies — not stranded at the end.
  assert.ok(
    prose.indexOf(PDF_ADVISORY) < prose.indexOf("Title Block"),
    "the advisory is printed below the first section instead of under the heading",
  );

  assert.ok(prose.includes(SIGNATURE_MEANING), "the signature line still explains nothing");
  const sigLine = prose.indexOf("Signed by:");
  assert.ok(sigLine > 0, "no signature line in the printed package");
  assert.ok(
    prose.indexOf(SIGNATURE_MEANING) < sigLine,
    "what signing means is printed AFTER the line it qualifies",
  );
  // "Approved by" over a line a person signs asserts the thing the sentence
  // above it denies, and on a printed page the label is the louder of the two.
  assert.ok(!prose.includes("Approved by"), 'the signature block still reads "Approved by"');

  // Same sentence in the machine-readable record, so the two cannot drift.
  const record = JSON.parse(readFileSync(join(bundleDir, "approvals/approvalRecord.json"), "utf8"));
  assert.strictEqual(record.whatSigningMeans, SIGNATURE_MEANING);
});

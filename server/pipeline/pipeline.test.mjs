// Pipeline orchestrator tests. Every run gets fresh temp dirs — nothing here
// touches server/pipeline/data/ or the network. The replay walk uses the real
// packager contract if server/package/* has landed, the labeled fallback
// otherwise; the failure-mapping tests inject throwing contracts directly.

import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { STATE } from "../state/states.mjs";
import { MACHINE_PATH } from "../lib/repo-path.mjs";
import { runJob } from "./run-job.mjs";
import { analyzeStl, ExportError, PdfError } from "./contract-stubs.mjs";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const PLAIN_PLATE = join(REPO, "samples", "requests", "plain-plate.json");
const INVALID = join(REPO, "samples", "requests", "invalid-missing-material.json");
const FLUSHMOUNT = join(REPO, "server", "pipeline", "fixtures", "flushmount-rect-lipped.json");

const quiet = { log: () => {} };
const tmp = (tag) => mkdtempSync(join(tmpdir(), `toolcrib-pipe-${tag}-`));
const dirs = (tag) => {
  const d = tmp(tag);
  return { dataDir: join(d, "data"), outRoot: join(d, "out"), root: d };
};
const toSeq = (ledger) => ledger.map((r) => r.to);

// Watertight ASCII cube, outward winding, corner at origin.
function asciiCube(size) {
  const p = [
    [0, 0, 0], [size, 0, 0], [size, size, 0], [0, size, 0],
    [0, 0, size], [size, 0, size], [size, size, size], [0, size, size],
  ];
  const F = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
    [2, 3, 7], [2, 7, 6], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5],
  ];
  const L = ["solid cube"];
  for (const [a, b, c] of F) {
    L.push("facet normal 0 0 0", "  outer loop");
    for (const i of [a, b, c]) L.push(`    vertex ${p[i].join(" ")}`);
    L.push("  endloop", "endfacet");
  }
  L.push("endsolid cube");
  return L.join("\n");
}

function cubeFixtures(sizeMm) {
  const d = tmp("fixtures");
  writeFileSync(join(d, "part.kcl"), "// test cube stand-in\n");
  writeFileSync(join(d, "source.stl"), asciiCube(sizeMm));
  return d;
}

function writeJson(dir, name, obj) {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(obj) + "\n");
  return p;
}

const cubeRequest = (extra = {}) => ({
  title: "test cube",
  prompt: "a plain test cube, no holes",
  material: { name: "aluminum 6061", densityKgM3: 2700 },
  units: "mm",
  requester: "tests@toolcrib",
  ...extra,
});

test("replay walks the trunk to the human gate with a sealed package", async () => {
  const { dataDir, outRoot } = dirs("replay");
  const r = await runJob(PLAIN_PLATE, { backend: "replay", dataDir, outRoot, ...quiet });

  assert.equal(r.finalState, STATE.WAITING_FOR_HUMAN_REVIEW);
  assert.deepEqual(toSeq(r.ledger), [
    STATE.DRAFT, STATE.VALIDATING, STATE.GENERATING, STATE.GEOMETRY_CHECK,
    STATE.PACKAGING, STATE.PDF_GENERATION, STATE.WAITING_FOR_HUMAN_REVIEW,
  ]);
  assert.equal(r.verify.ok, true);

  // gates ran for real against the fixture mesh and the Bambu envelope
  const byGate = Object.fromEntries(r.gates.results.map((g) => [g.gate, g.status]));
  assert.equal(byGate.envelope, "pass");
  assert.equal(byGate.watertight, "pass");
  assert.equal(byGate.mass, "pass"); // range + its arithmetic live in the request's massBasis
  assert.ok(Math.abs(r.gates.measured.massG - 13.0786) < 0.001); // agrees with Zoo /file/mass

  // A verdict with no numbers behind it is not a check. Pin the gate's own
  // computed-vs-expected sentence, and the headline gate line the demo prints
  // — that line is the goal's first-named surface, and "mass=pass" there is
  // the whole point of stating a range in the first place.
  assert.equal(
    r.gates.results.find((g) => g.gate === "mass").detail,
    "computed 13.0786g (4843.9277mm3 x 2700kg/m3) vs expected 12.945-13.207g",
  );
  assert.match(
    r.ledger.find((row) => row.to === STATE.PACKAGING).reason,
    /^gates: envelope=pass, watertight=pass, mass=pass; measured /,
  );

  // reference consult: rules touched, cited, and honestly watermarked
  assert.equal(r.consult.lookups.length, 2);
  assert.equal(r.consult.watermark, "DRAFT — NOT VERIFIED");
  for (const lk of r.consult.lookups) assert.ok(Object.keys(lk.result.citation).length > 0);

  // package sealed and parked
  const bundleDir = r.pkg.bundleDir ?? r.pkg.packageDir;
  assert.match(r.pkg.manifest.packageHash, /^[0-9a-f]{64}$/);
  assert.ok(existsSync(join(bundleDir, "manifest.json")));
  assert.ok(existsSync(join(bundleDir, "notifications.log")));
  const present = r.pkg.manifest.files.filter((f) => f.status === "present").map((f) => f.path);
  assert.ok(present.some((p) => /^cad\/.+\.kcl$/.test(p)), "bundle missing cad KCL");
  assert.ok(present.some((p) => /^exports\/.+\.stl$/.test(p)), "bundle missing stl export");

  // The pipeline measures no per-run API minutes and must not seal a number
  // saying it did. `0` would be a fabricated measurement inside a bundle whose
  // whole pitch is that its numbers are real; `null` + note says "unmeasured"
  // out loud (FN-031).
  if (!r.pkg.stub) {
    assert.strictEqual(r.pkg.manifest.apiRuns.minutesUsed, null);
    assert.notStrictEqual(r.pkg.manifest.apiRuns.minutesUsed, 0);
    assert.ok(/NOT MEASURED/.test(r.pkg.manifest.apiRuns.minutesUsedNote ?? ""));
  }

  // cross-track audit: the packager's own DoD checker signs off on the bundle
  if (!r.pkg.stub) {
    const { dodCheck } = await import("../package/assemble.mjs");
    const dod = dodCheck(bundleDir);
    assert.deepEqual(dod, { complete: true, misses: [] });
  }
});

// A ledger reason is hashed into the chain, so a path leaked there is sealed
// in and cannot be edited out later without breaking the chain. Same reasons
// render in the console UI and PDF section 13; backend notes ride into
// manifest.warnings and PDF section 9. All of it is judge-visible.
//
// MACHINE_PATH is imported, not re-declared. The copy that used to live here
// looked only for a drive letter or a home root, so "/root/<user>/part.stl" or
// the tail of a path containing a space would have scanned green.
const REPO_ABS = REPO.replace(/[\\/]+$/, "");

const scan = (label, text) => {
  const s = String(text);
  assert.doesNotMatch(s, MACHINE_PATH, `${label} leaks an absolute filesystem path`);
  assert.ok(!s.includes(REPO_ABS), `${label} leaks the repo's absolute location`);
};

// Every file under dir, recursively, absolute.
const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

test("no judge-visible surface names the operator's filesystem", async () => {
  const { dataDir, outRoot } = dirs("nopaths");
  const r = await runJob(PLAIN_PLATE, { backend: "replay", dataDir, outRoot, ...quiet });
  assert.equal(r.finalState, STATE.WAITING_FOR_HUMAN_REVIEW);

  // The two lines a judge reads first, pinned byte-for-byte: repo-relative,
  // POSIX separators, identical on Windows and Linux.
  assert.equal(
    r.ledger.find((row) => row.to === STATE.VALIDATING).reason,
    "request file: samples/requests/plain-plate.json",
  );
  assert.match(
    r.pkg.manifest.warnings.find((w) => w.startsWith("replay backend:")) ?? "",
    /^replay backend: artifacts read from samples\/plain-plate-stl /,
  );

  for (const row of r.ledger) scan(`ledger row -> ${row.to}`, row.reason);
  for (const w of r.pkg.manifest.warnings ?? []) scan("manifest warning", w);

  // EVERY file in the bundle, not a filtered subset of manifest.files. The bar
  // is "the generated bundle contains none", and manifest.files does not list
  // manifest.json itself, so an extension filter over it skipped the manifest,
  // both exports and the preview — 6 of the 12 files actually written. Read as
  // latin1 so binaries are scanned as bytes rather than skipped, and unescape
  // "\\" first: PDF content streams and JSON both escape a backslash, so a
  // leaked Windows path would otherwise slip past with doubled separators.
  const bundleDir = r.pkg.bundleDir ?? r.pkg.packageDir;
  const bundleFiles = walk(bundleDir);
  const rel = (abs) => relative(bundleDir, abs).split(sep).join("/");
  for (const abs of bundleFiles) scan(rel(abs), readFileSync(abs, "latin1").replaceAll("\\\\", "\\"));

  // A filter that quietly matches nothing passes vacuously, so the scan has to
  // prove it actually looked at the files a judge opens.
  const names = bundleFiles.map(rel);
  for (const required of ["manifest.json", "notifications.log", "reports/manufacturingPackage.pdf"])
    assert.ok(names.includes(required), `bundle scan never reached ${required}`);
  assert.ok(names.length >= 10, `expected a full bundle to scan, walked only ${names.length} files`);
});

// The demo console is the goal's first-named surface, and the cheapest route
// onto it is a typo: README documents `npm run job <request>`, and a request
// path that does not exist crashes out of readFileSync before any state
// machine runs. Measured against the previous commit, that printed Node's
// ENOENT naming the operator's home directory plus a stack of file:// frames
// naming the repo location. This drives the real CLI, in a child process,
// because the leak lived in the CLI's own catch — not in runJob.
test("a mistyped request path crashes without naming the machine", () => {
  const cli = join(REPO, "server", "pipeline", "run-job.mjs");
  const r = spawnSync(process.execPath, [cli, "samples/requests/no-such-request.json", "--backend=replay"], {
    cwd: REPO,
    encoding: "utf8",
  });
  const out = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 1, `expected a crash exit, got ${r.status}: ${out}`);
  assert.match(out, /pipeline crashed/, `not the crash path we think we are testing: ${out}`);
  scan("CLI crash output", out);
  // Scrubbed, not blanked — the operator still has to be able to fix the typo,
  // and the stack still has to point at a file.
  assert.match(out, /ENOENT/, `the scrub swallowed the diagnosis: ${out}`);
  assert.match(out, /no-such-request\.json/, `the failing leaf was lost: ${out}`);
  assert.match(out, /run-job\.mjs/, `the stack lost its frames: ${out}`);
});

test("invalid request lands in INPUT_ERROR", async () => {
  const { dataDir, outRoot } = dirs("invalid");
  const r = await runJob(INVALID, { backend: "replay", dataDir, outRoot, ...quiet });
  assert.equal(r.finalState, STATE.INPUT_ERROR);
  assert.match(r.ledger.at(-1).reason, /material/);
  assert.equal(r.verify.ok, true);
});

test("oversized part fails the envelope gate into GEOMETRY_INVALID", async () => {
  const { dataDir, outRoot, root } = dirs("oversize");
  const machinePath = writeJson(root, "tiny-machine.json", {
    id: "tiny-test-envelope",
    buildVolumeMm: { x: 10, y: 10, z: 10 },
  });
  const requestPath = writeJson(root, "request.json", cubeRequest());
  const r = await runJob(requestPath, {
    backend: "replay", dataDir, outRoot, machinePath,
    fixturesDir: cubeFixtures(300), ...quiet,
  });
  assert.equal(r.finalState, STATE.GEOMETRY_INVALID);
  assert.match(r.ledger.at(-1).reason, /envelope/);
  assert.match(r.ledger.at(-1).reason, /300x300x300mm/); // measured values in the ledger
  assert.equal(r.verify.ok, true);
});

test("mass gate: enforced when the request states a range, skipped out loud when it does not", async () => {
  const { dataDir, outRoot, root } = dirs("mass");
  const fixturesDir = cubeFixtures(10); // 1000 mm3 x 2700 kg/m3 = 2.7 g

  const failPath = writeJson(root, "too-light.json", cubeRequest({ expectedMassG: { minG: 5, maxG: 6 } }));
  const fail = await runJob(failPath, { backend: "replay", dataDir, outRoot, fixturesDir, ...quiet });
  assert.equal(fail.finalState, STATE.GEOMETRY_INVALID);
  assert.match(fail.ledger.at(-1).reason, /mass/);
  assert.match(fail.ledger.at(-1).reason, /2\.7g/);

  const okPath = writeJson(root, "in-range.json", cubeRequest({ expectedMassG: { minG: 2.5, maxG: 2.9 } }));
  const ok = await runJob(okPath, { backend: "replay", dataDir, outRoot, fixturesDir, ...quiet });
  assert.equal(ok.finalState, STATE.WAITING_FOR_HUMAN_REVIEW);
  assert.equal(ok.gates.results.find((g) => g.gate === "mass").status, "pass");

  // The skip branch is still real behaviour and still has to be covered. It
  // used to be covered incidentally, by plain-plate.json having no range;
  // now that the sample states one, cover it on purpose. A request with no
  // expectation must SAY so and still report the number it computed — the
  // failure mode to guard against is a silent green that measured nothing.
  const nonePath = writeJson(root, "no-expectation.json", cubeRequest());
  const none = await runJob(nonePath, { backend: "replay", dataDir, outRoot, fixturesDir, ...quiet });
  assert.equal(none.finalState, STATE.WAITING_FOR_HUMAN_REVIEW);
  const skipped = none.gates.results.find((g) => g.gate === "mass");
  assert.equal(skipped.status, "skipped:no-expectation");
  assert.equal(skipped.detail, "computed 2.7g; request states no expectedMassG range");
  assert.equal(none.gates.skipped, true); // and the package must carry the warning
});

test("backend failure lands in GENERATION_FAILED", async () => {
  const { dataDir, outRoot, root } = dirs("genfail");
  const empty = join(root, "empty-fixtures");
  mkdirSync(empty, { recursive: true });
  const r = await runJob(PLAIN_PLATE, { backend: "replay", dataDir, outRoot, fixturesDir: empty, ...quiet });
  assert.equal(r.finalState, STATE.GENERATION_FAILED);
  assert.equal(r.verify.ok, true);

  // The failure path seals its reason into the hash chain exactly like the
  // happy path, and renders in the console UI and PDF section 13 the same way.
  // /no part\.kcl/ alone stays green whether the dir renders relative or
  // absolute, so pin the rendering itself: this fixturesDir is a temp dir,
  // which is outside the repo by construction.
  assert.match(r.ledger.at(-1).reason, /^replay fixtures incomplete: no part\.kcl in <outside-repo>\/empty-fixtures$/);
  for (const row of r.ledger) scan(`GENERATION_FAILED ledger row -> ${row.to}`, row.reason);
});

test("flushmount: parks at the gate with the mesh-less bundle loudly incomplete", async () => {
  const { dataDir, outRoot } = dirs("flush");
  const r = await runJob(FLUSHMOUNT, { backend: "flushmount", dataDir, outRoot, ...quiet });
  assert.equal(r.finalState, STATE.WAITING_FOR_HUMAN_REVIEW);
  assert.ok(r.gates.results.every((g) => g.status === "skipped:no-mesh"));
  assert.match(r.ledger.find((row) => row.to === STATE.PACKAGING).reason, /NO MESH PRODUCED/);

  const bundleDir = r.pkg.bundleDir ?? r.pkg.packageDir;
  const kclEntry = r.pkg.manifest.files.find((f) => /\.kcl$/.test(f.path));
  const kcl = readFileSync(join(bundleDir, kclEntry.path), "utf8");
  assert.match(kcl, /PART 1 of 2: PANEL/);
  assert.match(kcl, /PART 2 of 2: INSERT/);

  // the package says so loudly: skipped mesh in the warnings, DoD incomplete
  assert.ok(r.pkg.manifest.warnings.some((w) => /\.stl SKIPPED/.test(w)), "missing loud stl-skip warning");
  if (!r.pkg.stub) {
    const { dodCheck } = await import("../package/assemble.mjs");
    const dod = dodCheck(bundleDir);
    assert.equal(dod.complete, false);
    assert.ok(dod.misses.some((m) => /\.stl/.test(m)));
  }
});

test("flushmount: rejected spec maps to GENERATION_FAILED with the gate's words", async () => {
  const { dataDir, outRoot, root } = dirs("flushbad");
  const bad = JSON.parse(readFileSync(FLUSHMOUNT, "utf8"));
  bad.structuredIntent.flushMount.clearancePerSideMm = 0; // "a flush fit is a deliberate clearance, not zero"
  const requestPath = writeJson(root, "bad-spec.json", bad);
  const r = await runJob(requestPath, { backend: "flushmount", dataDir, outRoot, ...quiet });
  assert.equal(r.finalState, STATE.GENERATION_FAILED);
  assert.match(r.ledger.at(-1).reason, /deliberate clearance/);
});

test("packaging contract errors map to EXPORT_FAILED and PDF_FAILED", async () => {
  const throwing = (Err, msg) => ({
    assemblePackage: () => { throw new Err(msg); },
  });

  const a = dirs("exportfail");
  const r1 = await runJob(PLAIN_PLATE, {
    backend: "replay", dataDir: a.dataDir, outRoot: a.outRoot,
    deps: throwing(ExportError, "STEP writer refused"), ...quiet,
  });
  assert.equal(r1.finalState, STATE.EXPORT_FAILED);
  assert.match(r1.ledger.at(-1).reason, /STEP writer refused/);
  assert.equal(r1.ledger.at(-1).from, STATE.PACKAGING);

  const b = dirs("pdffail");
  const r2 = await runJob(PLAIN_PLATE, {
    backend: "replay", dataDir: b.dataDir, outRoot: b.outRoot,
    deps: throwing(PdfError, "font table exploded"), ...quiet,
  });
  assert.equal(r2.finalState, STATE.PDF_FAILED);
  assert.equal(r2.ledger.at(-1).from, STATE.PDF_GENERATION); // failed FROM the pdf state
  assert.equal(r2.verify.ok, true);
});

// --- live-lane resume: fully offline through the liveBackend client seam ---

function stubZoo({ recordPrompt, code = "// resumed cube kcl\n" } = {}) {
  return {
    startTextToCad() {
      throw new Error("dispatch called during resume — adoption must never spend");
    },
    async waitTextToCad() {
      const record = { ...(recordPrompt !== undefined ? { prompt: recordPrompt } : {}), code };
      return { status: "completed", record, latencyS: 1 };
    },
    async fetchOutputs() {
      return { "source.stl": Buffer.from(asciiCube(20)).toString("base64") };
    },
    decodeOutput: (b64) => Buffer.from(b64, "base64"),
  };
}

test("live resume: matching prompt adopts the generation and walks to the gate", async () => {
  const { dataDir, outRoot, root } = dirs("resume-ok");
  const requestPath = writeJson(root, "request.json", cubeRequest());
  const r = await runJob(requestPath, {
    backend: "live", resumeT2cId: "t2c-resume-ok",
    client: stubZoo({ recordPrompt: cubeRequest().prompt }),
    dataDir, outRoot, ...quiet,
  });
  assert.equal(r.finalState, STATE.WAITING_FOR_HUMAN_REVIEW);
  const genRow = r.ledger.find((row) => row.to === STATE.GEOMETRY_CHECK);
  assert.match(genRow.reason, /resumed text-to-cad t2c-resume-ok, no new dispatch/);
  assert.equal(r.job.artifacts.generation.apiRuns[0].resumed, true);
  assert.equal(r.verify.ok, true);
});

test("live resume: mismatched record prompt is refused — no foreign geometry", async () => {
  const { dataDir, outRoot, root } = dirs("resume-mismatch");
  const requestPath = writeJson(root, "request.json", cubeRequest());
  const r = await runJob(requestPath, {
    backend: "live", resumeT2cId: "t2c-mismatch",
    client: stubZoo({ recordPrompt: "a completely different part" }),
    dataDir, outRoot, ...quiet,
  });
  assert.equal(r.finalState, STATE.GENERATION_FAILED);
  assert.match(r.ledger.at(-1).reason, /different prompt/);
  assert.match(r.ledger.at(-1).reason, /not adopting foreign geometry/);
});

test("live resume: record without a prompt is refused — fail closed, not fail open", async () => {
  const { dataDir, outRoot, root } = dirs("resume-noprompt");
  const requestPath = writeJson(root, "request.json", cubeRequest());
  const r = await runJob(requestPath, {
    backend: "live", resumeT2cId: "t2c-noprompt",
    client: stubZoo({ recordPrompt: undefined }),
    dataDir, outRoot, ...quiet,
  });
  assert.equal(r.finalState, STATE.GENERATION_FAILED);
  assert.match(r.ledger.at(-1).reason, /no prompt field to verify against/);
});

test("resume-job on a job not stranded at GENERATING throws the specific refusal", async () => {
  const { dataDir, outRoot } = dirs("resume-badjob");
  const done = await runJob(PLAIN_PLATE, { backend: "replay", dataDir, outRoot, ...quiet });
  assert.equal(done.finalState, STATE.WAITING_FOR_HUMAN_REVIEW);
  await assert.rejects(
    () => runJob(PLAIN_PLATE, {
      backend: "live", resumeJobId: done.jobId,
      client: stubZoo({ recordPrompt: "irrelevant" }),
      dataDir, outRoot, ...quiet,
    }),
    /requires a job stranded at GENERATING/,
  );
});

test("fallback analyzeStl measures a known solid exactly (binary + ascii)", () => {
  const a = analyzeStl(Buffer.from(asciiCube(20)));
  assert.deepEqual(a.bboxMm, { x: 20, y: 20, z: 20 });
  assert.equal(a.watertight, true);
  assert.ok(Math.abs(a.volumeMm3 - 8000) < 1e-6);
  assert.equal(a.triangles, 12);

  // same cube, binary encoding
  const tris = [];
  const re = /vertex ([-\d.]+) ([-\d.]+) ([-\d.]+)/g;
  const text = asciiCube(20);
  for (let m; (m = re.exec(text)); ) tris.push([+m[1], +m[2], +m[3]]);
  const bin = Buffer.alloc(84 + (tris.length / 3) * 50);
  bin.writeUInt32LE(tris.length / 3, 80);
  tris.forEach((v, i) => {
    const o = 84 + Math.floor(i / 3) * 50 + 12 + (i % 3) * 12;
    v.forEach((n, j) => bin.writeFloatLE(n, o + j * 4));
  });
  const b = analyzeStl(bin);
  assert.deepEqual(b.bboxMm, a.bboxMm);
  assert.equal(b.watertight, true);
  assert.ok(Math.abs(b.volumeMm3 - 8000) < 1e-6);

  // a mesh with a missing face is not watertight
  const holey = text.split("endfacet").slice(1).join("endfacet"); // drop first facet
  assert.equal(analyzeStl(Buffer.from("solid cube" + holey)).watertight, false);
});

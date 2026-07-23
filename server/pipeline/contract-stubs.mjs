// Contract fallbacks for the packager track's modules. run-job.mjs prefers
// the real server/package/stl-analyze.mjs and server/package/assemble.mjs and
// only lands here when those files do not exist yet (ERR_MODULE_NOT_FOUND).
// Same signatures, honest output: every package sealed by this fallback says
// so in its manifest and review sheet.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { canonicalJson } from "../state/store.mjs";

export class ExportError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExportError";
  }
}

export class PdfError extends Error {
  constructor(message) {
    super(message);
    this.name = "PdfError";
  }
}

// ---------------------------------------------------------------- analyzeStl

/**
 * Parse an STL (binary or ASCII) and measure it. Packager-track contract:
 * analyzeStl(buffer) -> {bboxMm:{x,y,z}, watertight:boolean, volumeMm3, triangles}
 */
export function analyzeStl(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const tris = looksAscii(buf) ? parseAscii(buf.toString("utf8")) : parseBinary(buf);
  if (tris.length === 0) throw new Error("STL contains no triangles");

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let vol6 = 0; // 6 x signed volume, divergence theorem over the mesh
  const edges = new Map(); // undirected edge -> [forwardCount, reverseCount]

  for (const [a, b, c] of tris) {
    for (const v of [a, b, c])
      for (let i = 0; i < 3; i++) {
        if (v[i] < min[i]) min[i] = v[i];
        if (v[i] > max[i]) max[i] = v[i];
      }
    vol6 +=
      a[0] * (b[1] * c[2] - b[2] * c[1]) -
      a[1] * (b[0] * c[2] - b[2] * c[0]) +
      a[2] * (b[0] * c[1] - b[1] * c[0]);
    countEdge(edges, a, b);
    countEdge(edges, b, c);
    countEdge(edges, c, a);
  }

  // Watertight: every undirected edge shared by exactly two triangles, once in
  // each direction — a closed, consistently oriented 2-manifold.
  let watertight = true;
  for (const [fwd, rev] of edges.values())
    if (fwd !== 1 || rev !== 1) {
      watertight = false;
      break;
    }

  return {
    bboxMm: { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] },
    watertight,
    volumeMm3: Math.abs(vol6) / 6,
    triangles: tris.length,
  };
}

function looksAscii(buf) {
  const head = buf.subarray(0, 512).toString("latin1");
  if (!head.trimStart().startsWith("solid")) return false;
  return head.includes("facet"); // binary headers may start with "solid" too
}

function parseAscii(text) {
  const tris = [];
  let tri = [];
  const re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
  for (let m; (m = re.exec(text)); ) {
    tri.push([+m[1], +m[2], +m[3]]);
    if (tri.length === 3) {
      tris.push(tri);
      tri = [];
    }
  }
  if (tri.length !== 0) throw new Error(`ASCII STL truncated: ${tri.length} dangling vertex rows`);
  return tris;
}

function parseBinary(buf) {
  if (buf.length < 84) throw new Error(`binary STL too short: ${buf.length} bytes`);
  const n = buf.readUInt32LE(80);
  if (buf.length < 84 + n * 50)
    throw new Error(`binary STL truncated: header claims ${n} triangles, buffer holds ${Math.floor((buf.length - 84) / 50)}`);
  const tris = [];
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50 + 12; // skip the facet normal
    tris.push([
      [buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)],
      [buf.readFloatLE(o + 12), buf.readFloatLE(o + 16), buf.readFloatLE(o + 20)],
      [buf.readFloatLE(o + 24), buf.readFloatLE(o + 28), buf.readFloatLE(o + 32)],
    ]);
  }
  return tris;
}

const vkey = (v) => v.map((n) => n.toFixed(5)).join(",");

function countEdge(edges, p, q) {
  const a = vkey(p);
  const b = vkey(q);
  const forward = a < b;
  const key = forward ? `${a}|${b}` : `${b}|${a}`;
  let rec = edges.get(key);
  if (!rec) edges.set(key, (rec = [0, 0]));
  rec[forward ? 0 : 1]++;
}

// ------------------------------------------------------------ assemblePackage

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/**
 * Packager-track contract (mirrors server/package/assemble.mjs):
 *   assemblePackage(job, artifacts, gates, opts) -> {bundleDir, manifest, analysis}
 *   artifacts: {kcl, stl?, step?, png?, reference?, warnings?, ...}
 *   gates:     [{gate, result: PASS|FAIL|SKIPPED, threshold?, measured?, notes?}]
 *   opts:      {outRoot, expectMesh = true}
 * Fallback behavior: enforce the same required-input rules, write a minimal
 * bundle — request, KCL, exports, gates, review sheet — and seal it with a
 * manifest packageHash over the file digests. No PDF: that is the real
 * assemble.mjs's job, and the review sheet says so.
 */
export function assemblePackage(job, artifacts = {}, gates = [], { outRoot, expectMesh = true } = {}) {
  if (!outRoot) throw new RangeError("assemblePackage fallback: opts.outRoot is required");
  const kcl = artifacts.kcl;
  if (!kcl || kcl.length === 0)
    throw new ExportError("fallback: cad KCL is required and none was provided");
  if ((!artifacts.stl || artifacts.stl.length === 0) && expectMesh)
    throw new ExportError("fallback: a mesh was expected (opts.expectMesh) and none was provided");

  const bundleDir = join(outRoot, job.jobId);
  const files = [];
  const put = (rel, data) => {
    const body = typeof data === "string" ? Buffer.from(data) : data;
    const abs = join(bundleDir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
    files.push({ path: rel, status: "present", sha256: sha256(body), bytes: body.length });
  };

  put("generationRequest.json", JSON.stringify(job.request, null, 2) + "\n");
  put("cad/part.kcl", kcl);
  for (const fmt of ["stl", "step", "png"])
    if (artifacts[fmt]?.length) put(`exports/part.${fmt}`, artifacts[fmt]);
  put("reports/gates.json", JSON.stringify(gates, null, 2) + "\n");
  put("REVIEW.md", reviewSheet(job, artifacts, gates));

  const warnings = [...(artifacts.warnings ?? [])];
  for (const g of gates) if (g.result === "SKIPPED") warnings.push(`gate "${g.gate}" SKIPPED — ${g.notes ?? ""}`);
  for (const r of artifacts.reference ?? []) if (r.watermark) warnings.push(`${r.watermark}: ${r.parameter ?? "reference lookup"} used before operator sign-off`);
  warnings.push("sealed by the pipeline contract fallback — server/package/assemble.mjs not present, no PDF rendered");

  const manifest = {
    jobId: job.jobId,
    revision: job.rev,
    sealedBy: "toolcrib-pipeline contract fallback",
    files,
    warnings,
    packageHash: sha256(files.map((f) => f.sha256).sort().join("\n")),
  };
  writeFileSync(join(bundleDir, "manifest.json"), canonicalJson(manifest) + "\n");
  return { bundleDir, manifest, analysis: null, stub: true };
}

function reviewSheet(job, artifacts, gates) {
  const L = [
    `# Job package: ${job.request?.title ?? job.jobId}`,
    "",
    `- job: ${job.jobId} (rev ${job.rev})`,
    `- requester: ${job.request?.requester ?? "unknown"}`,
    "",
    "## Geometry gates",
    "",
  ];
  for (const g of gates) L.push(`- ${g.gate}: ${g.result} — ${g.notes ?? ""}`);
  if (gates.some((g) => g.result === "SKIPPED"))
    L.push("", "**WARNING: skipped gates above did NOT run — whatever they guard is unchecked.**");
  L.push("", "## Reference basis", "");
  for (const r of artifacts.reference ?? [])
    L.push(`- ${r.parameter}: ${JSON.stringify(r.citation)}${r.watermark ? ` [${r.watermark}]` : ""}`);
  if (!(artifacts.reference ?? []).length) L.push("- none consulted");
  L.push("", "---", "Sealed by the pipeline contract fallback. PDF review sheet pending the packager track (server/package/assemble.mjs).", "");
  return L.join("\n");
}

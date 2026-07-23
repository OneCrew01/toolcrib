// Burn-cert min-wall gate — sampled local wall thickness vs the reference floor.
//
// The FAA's own finding (TN23-65, pending operator verification) is that wall
// thickness is a top-two burn variable the CAD fully controls. This gate
// measures it on the actual mesh: for a deterministic sample of facets, cast
// a ray inward along the facet's -normal and take the nearest opposing
// intersection as the LOCAL wall thickness at that spot. Report min/median vs
// the fail-closed reference floor (server/reference/tables/burn-cert.mjs).
//
// Approximate by nature, and the output says so: facet centroids only, so an
// edge-on facet reads the part's span rather than its wall, and features
// thinner than the sampling density can hide. A PASS here is a screen, not a
// certificate — the disclaimer rides on every report.
//
// analyzeStl (FN-021 module) is imported for the aggregate mesh facts;
// triangle extraction below mirrors its parsing rules (binary iff the
// 80-byte-header + count layout accounts for every byte; stored normals
// ignored — recomputed facts only) because it deliberately exports only
// aggregates and shared files are not edited here.
//
// CLI:  node server/generators/burncert-validate.mjs part.stl \
//         --material=PC-ABS-FR [--samples=200] [--allow-draft]
// Prints the JSON report; exit 1 on a FAIL gate, exit 2 on fail-closed
// (unverified rules, no draft opt-in).

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { analyzeStl } from "../package/stl-analyze.mjs";
import { burnCert, minWallFloor, BURN_CERT_DISCLAIMER } from "../reference/tables/burn-cert.mjs";
import { UnverifiedRuleError } from "../reference/lookup.mjs";

export class BurnCertError extends Error {
  constructor(message, report) {
    super(message);
    this.name = "BurnCertError";
    this.report = report;
  }
}

// ------------------------------------------------------------ triangle math

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.sqrt(dot(a, a));

// Möller–Trumbore; returns distance t along dir, or null. tMin keeps the ray
// from re-hitting its own coplanar face.
function rayHit(orig, dir, [a, b, c], tMin) {
  const e1 = sub(b, a);
  const e2 = sub(c, a);
  const h = cross(dir, e2);
  const det = dot(e1, h);
  if (Math.abs(det) < 1e-12) return null;
  const f = 1 / det;
  const s = sub(orig, a);
  const u = f * dot(s, h);
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  const q = cross(s, e1);
  const v = f * dot(dir, q);
  if (v < -1e-9 || u + v > 1 + 1e-9) return null;
  const t = f * dot(e2, q);
  return t > tMin ? t : null;
}

// ------------------------------------------------------------- STL parsing

function isBinaryStl(buf) {
  if (buf.length < 84) return false;
  return 84 + 50 * buf.readUInt32LE(80) === buf.length;
}

function parseBinary(buf) {
  const n = buf.readUInt32LE(80);
  const tris = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50 + 12;
    tris[i] = [
      [buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8)],
      [buf.readFloatLE(o + 12), buf.readFloatLE(o + 16), buf.readFloatLE(o + 20)],
      [buf.readFloatLE(o + 24), buf.readFloatLE(o + 28), buf.readFloatLE(o + 32)],
    ];
  }
  return tris;
}

const VERTEX_RE = /vertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/g;

function parseAscii(buf) {
  const verts = [];
  for (const m of buf.toString("utf8").matchAll(VERTEX_RE)) {
    const v = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!v.every(Number.isFinite)) throw new RangeError(`burncert-validate: unparseable vertex "${m[0].trim()}"`);
    verts.push(v);
  }
  if (verts.length % 3 !== 0) throw new RangeError(`burncert-validate: vertex count ${verts.length} not divisible by 3`);
  const tris = [];
  for (let i = 0; i < verts.length; i += 3) tris.push([verts[i], verts[i + 1], verts[i + 2]]);
  return tris;
}

const r4 = (n) => Math.round(n * 10000) / 10000;

// ---------------------------------------------------------------- sampling

/**
 * Ray-sample local wall thickness across a mesh. Deterministic: facets are
 * chosen by fixed stride, the sample point is the facet centroid, and the ray
 * runs inward along the recomputed -normal (STL winding convention: outward).
 * @param {Buffer} buffer raw STL bytes (binary or ASCII), coordinates in mm
 * @param {{maxSamples?: number}} [opts]
 * @returns {{method: string, requestedSamples: number, sampledFacets: number, hits: number, minMm: number|null, medianMm: number|null, approximate: string}}
 */
export function sampleWallThickness(buffer, { maxSamples = 200 } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new TypeError("sampleWallThickness: non-empty Buffer required");
  const tris = isBinaryStl(buffer) ? parseBinary(buffer) : parseAscii(buffer);
  if (tris.length === 0) throw new RangeError("sampleWallThickness: no triangles found");

  const picks = [];
  if (tris.length <= maxSamples) {
    for (let i = 0; i < tris.length; i++) picks.push(i);
  } else {
    const stride = tris.length / maxSamples;
    for (let i = 0; i < maxSamples; i++) picks.push(Math.floor(i * stride));
  }

  const thicknesses = [];
  for (const idx of picks) {
    const [a, b, c] = tris[idx];
    const n = cross(sub(b, a), sub(c, a));
    const len = norm(n);
    if (len < 1e-12) continue; // degenerate facet
    const dir = [-n[0] / len, -n[1] / len, -n[2] / len];
    const centroid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    let nearest = null;
    for (let j = 0; j < tris.length; j++) {
      if (j === idx) continue;
      const t = rayHit(centroid, dir, tris[j], 1e-6);
      if (t !== null && (nearest === null || t < nearest)) nearest = t;
    }
    if (nearest !== null) thicknesses.push(nearest);
  }

  thicknesses.sort((x, y) => x - y);
  const hits = thicknesses.length;
  const median = hits === 0 ? null : hits % 2 ? thicknesses[(hits - 1) / 2] : (thicknesses[hits / 2 - 1] + thicknesses[hits / 2]) / 2;
  return {
    method: `ray-sampled, ${hits} samples`,
    requestedSamples: Math.min(maxSamples, tris.length),
    sampledFacets: picks.length,
    hits,
    minMm: hits ? r4(thicknesses[0]) : null,
    medianMm: median === null ? null : r4(median),
    approximate:
      "Approximate by nature: facet centroids only — an edge-on facet reads the part's span, not its wall, and features thinner than the sampling density can hide.",
  };
}

// -------------------------------------------------------------------- gate

// STL floats are 32-bit; a 1e-3 mm grace keeps exact-at-floor walls passing.
const FLOOR_TOL_MM = 1e-3;

/**
 * Sampled min-wall gate: sampled local thickness vs the burn-cert floor for
 * the named material. Fail-closed: consulting PENDING rules without
 * { allowDraft: true } throws UnverifiedRuleError; below-floor throws
 * BurnCertError carrying the full FAIL report.
 * @param {Buffer} buffer raw STL bytes
 * @param {{material?: string, allowDraft?: boolean, maxSamples?: number}} [opts]
 * @param {object} [table] burn-cert rule table override (tests)
 * @returns {object} PASS report
 */
export function burnCertGate(buffer, { material, allowDraft = false, maxSamples = 200 } = {}, table = burnCert) {
  const mesh = analyzeStl(buffer);
  const floor = minWallFloor({ material, allowDraft }, table);
  const sampling = sampleWallThickness(buffer, { maxSamples });
  if (sampling.hits === 0) {
    throw new BurnCertError("burn-cert gate: no wall samples landed — mesh may be open or degenerate; nothing to certify against", null);
  }

  const pass = sampling.minMm + FLOOR_TOL_MM >= floor.floorMm;
  const report = {
    tool: "burncert-validate",
    gate: pass ? "PASS" : "FAIL",
    material: floor.material,
    floorMm: floor.floorMm,
    floorBasis: floor.floorBasis,
    sampledMinMm: sampling.minMm,
    sampledMedianMm: sampling.medianMm,
    marginMm: r4(sampling.minMm - floor.floorMm),
    method: sampling.method,
    approximate: sampling.approximate,
    mesh: {
      triangles: mesh.triangles,
      watertight: mesh.watertight,
      bboxMm: mesh.bboxMm,
      volumeMm3: r4(mesh.volumeMm3),
    },
    chemistryNote: floor.chemistryNote,
    citation: floor.citation,
    verification: floor.verification,
    disclaimer: BURN_CERT_DISCLAIMER,
  };
  if (floor.watermark) report.watermark = floor.watermark;
  if (!mesh.watertight) {
    report.warning = "mesh is not watertight — sampled thickness on an open mesh is even less trustworthy";
  }

  if (!pass) {
    throw new BurnCertError(
      `burn-cert gate FAIL: sampled min wall ${sampling.minMm} mm is below the ${floor.floorMm} mm floor for ${report.material} (${sampling.method})`,
      report,
    );
  }
  return report;
}

// --------------------------------------------------------------------- CLI

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const args = process.argv.slice(2);
  const stlPath = args.find((a) => !a.startsWith("--"));
  const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
  if (!stlPath) {
    console.error("usage: node server/generators/burncert-validate.mjs <part.stl> --material=NAME [--samples=200] [--allow-draft]");
    process.exit(2);
  }
  const opts = {
    material: flag("material"),
    allowDraft: args.includes("--allow-draft"),
    maxSamples: flag("samples") ? Number(flag("samples")) : 200,
  };
  try {
    const report = burnCertGate(readFileSync(stlPath), opts);
    console.log(JSON.stringify(report, null, 2));
  } catch (e) {
    if (e instanceof BurnCertError && e.report) {
      console.log(JSON.stringify(e.report, null, 2));
      console.error(e.message);
      process.exit(1);
    }
    if (e instanceof UnverifiedRuleError) {
      console.error(`fail-closed: ${e.message}`);
      process.exit(2);
    }
    throw e;
  }
}

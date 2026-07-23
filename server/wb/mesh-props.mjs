// Mesh mass properties for weight & balance — the FN-021 integral family,
// one order up. server/package/stl-analyze.mjs (imported, never modified)
// stays the authority on volume, watertightness, and triangle count; this
// module runs its own signed-tetrahedron sweep for the first moments and
// refuses to serve a centroid unless its volume agrees with the analyzer's.
// Two independent sums vouching for each other before a safety-critical
// number leaves the module.
//
// Units: STL carries none. Coordinates are read as millimeters, the same
// convention as the analyzer — every mesh in this pipeline is mm.

import { analyzeStl } from "../package/stl-analyze.mjs";

/**
 * Volume, centroid, and (stretch) inertia tensor of a solid STL mesh.
 *
 * Signed-tetrahedra method: each triangle (a,b,c) forms a tetrahedron with
 * the origin. det = a·(b×c) is 6× its signed volume; the tetra centroid is
 * (a+b+c)/4; the second moment over the tetra is det·A·C·Aᵀ with A = [a b c]
 * and C the canonical-tetrahedron covariance (1/120)(J + I). Summed over a
 * closed, consistently wound mesh the signs cancel interior faces exactly.
 *
 * Inertia reference frame: about the CENTROID, axes parallel to the mesh's
 * own X/Y/Z. Values are unit-density (mm^5); multiply by density in g/mm³
 * to get g·mm² for a uniform solid part.
 *
 * @param {Buffer} buffer binary or ASCII STL bytes
 * @returns {{ volumeMm3: number, centroidMm: number[], watertight: boolean,
 *   triangles: number, bboxMm: { min: number[], max: number[], size: number[] },
 *   inertiaUnitDensityMm5: number[][] }}
 */
export function meshProperties(buffer) {
  const base = analyzeStl(buffer); // authority: volume, watertight, count
  const tris = isBinaryStl(buffer) ? parseBinary(buffer) : parseAscii(buffer);

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let vol6 = 0; // Σ det — 6 × signed volume
  const s1 = [0, 0, 0]; // Σ det × (a+b+c) — first moment × 24
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; // Σ det × (ppᵀ + aaᵀ + bbᵀ + ccᵀ) — 2nd moment × 120

  for (const [a, b, c] of tris) {
    for (const v of [a, b, c])
      for (let i = 0; i < 3; i++) {
        if (v[i] < min[i]) min[i] = v[i];
        if (v[i] > max[i]) max[i] = v[i];
      }
    const det =
      a[0] * (b[1] * c[2] - b[2] * c[1]) +
      a[1] * (b[2] * c[0] - b[0] * c[2]) +
      a[2] * (b[0] * c[1] - b[1] * c[0]);
    vol6 += det;
    const p = [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]];
    for (let i = 0; i < 3; i++) {
      s1[i] += det * p[i];
      for (let j = 0; j < 3; j++)
        cov[i][j] += det * (p[i] * p[j] + a[i] * a[j] + b[i] * b[j] + c[i] * c[j]);
    }
  }

  if (Math.abs(vol6) < 1e-9)
    throw new RangeError("meshProperties: zero enclosed volume — centroid undefined for a degenerate mesh");

  const volumeMm3 = Math.abs(vol6) / 6;
  // Cross-check against the analyzer before serving anything downstream.
  const rel = Math.abs(volumeMm3 - base.volumeMm3) / base.volumeMm3;
  if (rel > 1e-9)
    throw new Error(
      `meshProperties: volume disagreement with stl-analyze (${volumeMm3} vs ${base.volumeMm3} mm³) — refusing to serve a centroid`,
    );

  // det carries orientation sign on both sums, so the ratio is sign-free.
  const centroidMm = s1.map((v) => v / (4 * vol6));

  // Second moment about the origin, orientation-corrected, then shifted to
  // the centroid (parallel axis in covariance form) and folded to inertia.
  const sign = Math.sign(vol6);
  const inertiaUnitDensityMm5 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const cg = centroidMm;
  const covCg = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      covCg[i][j] = (sign * cov[i][j]) / 120 - volumeMm3 * cg[i] * cg[j];
  const trace = covCg[0][0] + covCg[1][1] + covCg[2][2];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      inertiaUnitDensityMm5[i][j] = (i === j ? trace : 0) - covCg[i][j];

  return {
    volumeMm3,
    centroidMm,
    watertight: base.watertight,
    triangles: base.triangles,
    bboxMm: { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] },
    inertiaUnitDensityMm5,
  };
}

// ---------------------------------------------------------------------------
// STL parsing, same rules as stl-analyze.mjs (its parsers are not exported;
// shared files are not edited on this track). Binary iff the header+count
// layout accounts for every byte; "starts with solid" is folklore.

function isBinaryStl(buf) {
  if (buf.length < 84) return false;
  return 84 + 50 * buf.readUInt32LE(80) === buf.length;
}

function parseBinary(buf) {
  const n = buf.readUInt32LE(80);
  const tris = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50 + 12; // skip the stored normal — recomputed facts only
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
    if (!v.every(Number.isFinite))
      throw new RangeError(`meshProperties: unparseable vertex "${m[0].trim()}"`);
    verts.push(v);
  }
  const tris = [];
  for (let i = 0; i < verts.length; i += 3) tris.push([verts[i], verts[i + 1], verts[i + 2]]);
  return tris;
}

// Zero-dependency STL analyzer — the local half of the geometry cross-check.
// The Engine tells us mass over REST (FN-008); this module measures the same
// mesh locally so the two numbers can vouch for each other without trusting
// either side alone.
//
// Units: STL carries none. We read coordinates as millimeters — every mesh in
// this pipeline is requested and exported in mm.

/**
 * Analyze a binary or ASCII STL.
 * @param {Buffer} buffer raw file bytes
 * @returns {{bboxMm: {x: number, y: number, z: number}, watertight: boolean, volumeMm3: number, triangles: number}}
 */
export function analyzeStl(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0)
    throw new TypeError("analyzeStl: non-empty Buffer required");
  const tris = isBinaryStl(buffer) ? parseBinary(buffer) : parseAscii(buffer);
  if (tris.length === 0) throw new RangeError("analyzeStl: no triangles found");

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let vol6 = 0; // 6 × signed volume, summed per tetrahedron (origin, v0, v1, v2)
  const edges = new Map(); // directed edge "keyA|keyB" -> count

  for (const [a, b, c] of tris) {
    for (const v of [a, b, c])
      for (let i = 0; i < 3; i++) {
        if (v[i] < min[i]) min[i] = v[i];
        if (v[i] > max[i]) max[i] = v[i];
      }
    // a · (b × c) — signed tetra volume ×6; a consistently wound closed mesh
    // sums to exactly 6 × enclosed volume.
    vol6 +=
      a[0] * (b[1] * c[2] - b[2] * c[1]) +
      a[1] * (b[2] * c[0] - b[0] * c[2]) +
      a[2] * (b[0] * c[1] - b[1] * c[0]);
    const ka = key(a), kb = key(b), kc = key(c);
    for (const e of [`${ka}|${kb}`, `${kb}|${kc}`, `${kc}|${ka}`])
      edges.set(e, (edges.get(e) ?? 0) + 1);
  }

  // Watertight = every directed edge appears exactly once AND its reverse
  // appears exactly once. Catches holes, non-manifold fins, duplicated faces,
  // and inconsistent winding in one test.
  let watertight = true;
  for (const [e, n] of edges) {
    if (n !== 1) { watertight = false; break; }
    const [ka, kb] = e.split("|");
    if (edges.get(`${kb}|${ka}`) !== 1) { watertight = false; break; }
  }

  return {
    bboxMm: { x: max[0] - min[0], y: max[1] - min[1], z: max[2] - min[2] },
    watertight,
    volumeMm3: Math.abs(vol6) / 6,
    triangles: tris.length,
  };
}

// Exact-coordinate vertex identity. Tessellators emit shared vertices
// bit-identical; welding by tolerance would hide real cracks.
const key = (v) => `${v[0]},${v[1]},${v[2]}`;

// Binary iff the 80-byte-header + count layout accounts for every byte.
// "starts with 'solid'" is folklore — binary headers often say solid too.
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
      throw new RangeError(`analyzeStl: unparseable vertex "${m[0].trim()}"`);
    verts.push(v);
  }
  if (verts.length % 3 !== 0)
    throw new RangeError(`analyzeStl: vertex count ${verts.length} not divisible by 3`);
  const tris = [];
  for (let i = 0; i < verts.length; i += 3) tris.push([verts[i], verts[i + 1], verts[i + 2]]);
  return tris;
}

// Deterministic 12-triangle binary STL box. The wb-demo ballast block and
// the W&B hand-calc test solids are synthesized here rather than exported
// from the API, so the sample assembly rebuilds offline, byte for byte.
// Outward winding, millimeters, normals left zero (recomputed facts only).

/**
 * @param {{ sizeMm: number[], cornerMm?: number[] }} spec box extents and
 *   the minimum corner (defaults to the origin)
 * @returns {Buffer} binary STL
 */
export function boxStl({ sizeMm, cornerMm = [0, 0, 0] } = {}) {
  for (const [name, v] of [["sizeMm", sizeMm], ["cornerMm", cornerMm]]) {
    if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite))
      throw new RangeError(`boxStl: ${name} must be [x, y, z] finite numbers`);
  }
  if (!sizeMm.every((s) => s > 0)) throw new RangeError("boxStl: sizeMm must be positive");

  const [x0, y0, z0] = cornerMm;
  const [x1, y1, z1] = [x0 + sizeMm[0], y0 + sizeMm[1], z0 + sizeMm[2]];
  const tris = [
    [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [[x0, y0, z0], [x1, y1, z0], [x1, y0, z0]], // -z
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1]], [[x0, y0, z1], [x1, y1, z1], [x0, y1, z1]], // +z
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1]], [[x0, y0, z0], [x1, y0, z1], [x0, y0, z1]], // -y
    [[x0, y1, z0], [x1, y1, z1], [x1, y1, z0]], [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1]], // +y
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1]], [[x0, y0, z0], [x0, y1, z1], [x0, y1, z0]], // -x
    [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [[x1, y0, z0], [x1, y1, z1], [x1, y0, z1]], // +x
  ];

  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.write("ToolCRIB synthesized box STL (mm) — BL-004 weight & balance", 0, "latin1");
  buf.writeUInt32LE(tris.length, 80);
  let o = 84;
  for (const t of tris) {
    o += 12; // zero normal
    for (const v of t) for (const c of v) { buf.writeFloatLE(c, o); o += 4; }
    o += 2; // zero attribute byte count
  }
  return buf;
}

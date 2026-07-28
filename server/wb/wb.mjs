// Assembly weight & balance — mass-weighted CG as a deterministic gate.
//
// CG is pure arithmetic over numbers the trust layer already produces:
// per-part volume and centroid (server/wb/mesh-props.mjs, the FN-021
// integral family). This module combines parts placed in a shared assembly
// frame and, when a CG window is armed, refuses to return a report at all if
// the combined CG leaves it — fail-closed, same contract as the reference
// tables. Advisory otherwise: it flags, it does not certify.
//
// Standalone by design, and the README says so too: nothing under
// server/pipeline/, server/package/ or server/api/ imports this module, so
// what the gate below refuses is THIS REPORT, never a job package. The only
// two callers in the repo are wb.test.mjs and run-wb-demo.mjs.
//
// Honest boundaries (BL-004): modeled mass is solid/nominal — printed mass
// depends on infill and filament density, so a part's measuredMassG
// (operator's scale) overrides modeled mass and the basis is labeled per
// part. No aerodynamics of any kind. Never imply "will it fly."

import { meshProperties } from "./mesh-props.mjs";

/**
 * Thrown when the combined CG lands outside the declared window. What it refuses
 * is THIS report — the function returns nothing. No job, no package, no ledger row.
 */
export class CgWindowError extends Error {
  constructor({ axis, cgOnAxisMm, minMm, maxMm, cgMm, totalMassG }) {
    super(
      `combined CG ${cgOnAxisMm.toFixed(3)} mm on ${axis} is outside the declared window ` +
        `[${minMm}, ${maxMm}] mm — report refused`,
    );
    this.name = "CgWindowError";
    this.code = "CG_OUTSIDE_WINDOW";
    Object.assign(this, { axis, cgOnAxisMm, minMm, maxMm, cgMm, totalMassG });
  }
}

export const WB_DISCLAIMERS = Object.freeze([
  "Advisory weight & balance: this report flags, it does not certify.",
  "Modeled mass is solid/nominal; printed mass depends on infill and filament density. A part's measuredMassG (operator's scale) overrides modeled mass, and each row states which basis it used.",
  'No aerodynamics: no lift, stall, control authority, or thrust. Weight and balance only — never implies "will it fly."',
  "Part positions are operator-declared placements in the assembly frame, not solved constraints.",
]);

const AXES = { x: 0, y: 1, z: 2 };
const KG_M3_TO_G_MM3 = 1e-6;

/**
 * Mass-weighted assembly CG with an optional fail-closed window gate.
 *
 * @param {Array<{ name: string, stl?: Buffer, props?: { volumeMm3: number,
 *   centroidMm: number[], watertight?: boolean }, densityKgM3?: number,
 *   measuredMassG?: number, positionMm: number[], rotationDeg?: number[] }>} parts
 *   Each part: exactly one of stl|props; measuredMassG overrides densityKgM3;
 *   positionMm places the part's own origin in the assembly frame;
 *   rotationDeg [rx,ry,rz] (applied X→Y→Z about the part origin) rotates the
 *   part before translation — it affects the CG arm only.
 * @param {{ cgWindow?: { axis: "x"|"y"|"z", minMm: number, maxMm: number } }} opts
 *   cgWindow arms the gate: a combined CG outside [minMm, maxMm] on the axis
 *   throws CgWindowError instead of returning a report.
 * @returns {{ totalMassG: number, cgMm: number[], perPart: Array<{ name: string,
 *   massG: number, basis: "modeled"|"measured", cgMm: number[] }>,
 *   window?: object, disclaimers: readonly string[] }}
 */
export function assemblyWB(parts, opts = {}) {
  if (!Array.isArray(parts) || parts.length === 0)
    throw new RangeError("assemblyWB: parts must be a non-empty array");

  const perPart = parts.map((part, i) => resolvePart(part, i));

  const totalMassG = perPart.reduce((s, p) => s + p.massG, 0);
  const cgMm = [0, 1, 2].map(
    (i) => perPart.reduce((s, p) => s + p.massG * p.cgMm[i], 0) / totalMassG,
  );

  const result = { totalMassG, cgMm, perPart, disclaimers: WB_DISCLAIMERS };

  if (opts.cgWindow !== undefined) {
    const { axis, minMm, maxMm } = validateWindow(opts.cgWindow);
    const cgOnAxisMm = cgMm[AXES[axis]];
    if (cgOnAxisMm < minMm || cgOnAxisMm > maxMm)
      throw new CgWindowError({ axis, cgOnAxisMm, minMm, maxMm, cgMm, totalMassG });
    result.window = { axis, minMm, maxMm, cgOnAxisMm, result: "PASS" };
  }

  return result;
}

// ---------------------------------------------------------------------------

function resolvePart(part, i) {
  const label = `assemblyWB parts[${i}]`;
  if (typeof part?.name !== "string" || part.name.length === 0)
    throw new RangeError(`${label}: name required`);

  if ((part.stl === undefined) === (part.props === undefined))
    throw new RangeError(`${label} "${part.name}": exactly one of stl|props required`);

  let props;
  if (part.stl !== undefined) {
    props = meshProperties(part.stl); // throws on junk / zero volume
    if (!props.watertight)
      throw new RangeError(
        `${label} "${part.name}": mesh is not watertight — volume and centroid are unreliable, refusing`,
      );
  } else {
    props = part.props;
    if (!Number.isFinite(props?.volumeMm3) || props.volumeMm3 <= 0)
      throw new RangeError(`${label} "${part.name}": props.volumeMm3 must be a positive number`);
    vec3(props.centroidMm, `${label} "${part.name}": props.centroidMm`);
    if (props.watertight === false)
      throw new RangeError(`${label} "${part.name}": props declare a non-watertight mesh — refusing`);
  }

  const modeledMassG =
    part.densityKgM3 === undefined ? undefined : modeledMass(part, props, label);
  let massG, basis;
  if (part.measuredMassG !== undefined) {
    if (!Number.isFinite(part.measuredMassG) || part.measuredMassG <= 0)
      throw new RangeError(`${label} "${part.name}": measuredMassG must be a positive number`);
    massG = part.measuredMassG;
    basis = "measured";
  } else if (modeledMassG !== undefined) {
    massG = modeledMassG;
    basis = "modeled";
  } else {
    throw new RangeError(`${label} "${part.name}": densityKgM3 or measuredMassG required`);
  }

  vec3(part.positionMm, `${label} "${part.name}": positionMm`);
  let local = props.centroidMm;
  if (part.rotationDeg !== undefined) {
    vec3(part.rotationDeg, `${label} "${part.name}": rotationDeg`);
    local = rotateXYZ(local, part.rotationDeg);
  }
  const cgMm = [0, 1, 2].map((k) => local[k] + part.positionMm[k]);

  const row = { name: part.name, massG, basis, cgMm, volumeMm3: props.volumeMm3 };
  if (part.densityKgM3 !== undefined) row.densityKgM3 = part.densityKgM3;
  if (modeledMassG !== undefined) row.modeledMassG = modeledMassG;
  if (part.measuredMassG !== undefined) row.measuredMassG = part.measuredMassG;
  return row;
}

function modeledMass(part, props, label) {
  if (!Number.isFinite(part.densityKgM3) || part.densityKgM3 <= 0)
    throw new RangeError(`${label} "${part.name}": densityKgM3 must be a positive number`);
  return props.volumeMm3 * part.densityKgM3 * KG_M3_TO_G_MM3;
}

function validateWindow(w) {
  if (!(w?.axis in AXES))
    throw new RangeError(`cgWindow.axis must be one of x, y, z — got ${JSON.stringify(w?.axis)}`);
  if (!Number.isFinite(w.minMm) || !Number.isFinite(w.maxMm) || w.minMm >= w.maxMm)
    throw new RangeError("cgWindow requires finite minMm < maxMm");
  return w;
}

function vec3(v, name) {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite))
    throw new RangeError(`${name} must be [x, y, z] finite numbers`);
}

// Right-handed rotations about the part origin, applied X, then Y, then Z.
function rotateXYZ(v, [rxDeg, ryDeg, rzDeg]) {
  const rad = (d) => (d * Math.PI) / 180;
  let [x, y, z] = v;
  const [cx, sx] = [Math.cos(rad(rxDeg)), Math.sin(rad(rxDeg))];
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  const [cy, sy] = [Math.cos(rad(ryDeg)), Math.sin(rad(ryDeg))];
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  const [cz, sz] = [Math.cos(rad(rzDeg)), Math.sin(rad(rzDeg))];
  [x, y] = [x * cz - y * sz, x * sz + y * cz];
  return [x, y, z];
}

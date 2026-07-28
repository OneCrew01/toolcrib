// Geometry gates: the measured checks between GENERATING and PACKAGING.
// "Completed" is not "correct" (FN-010) — a part earns PACKAGING by fitting
// the machine, holding water, and weighing what physics says it should.
// A job with no mesh may pass through, but every skipped gate is recorded
// and the package must carry the warning.

/**
 * @param {object} p
 * @param {{bboxMm:{x,y,z}, watertight:boolean, volumeMm3:number, triangles:number}|null} p.analysis  null = no mesh
 * @param {object} p.machine        machine profile (samples/machines/*.json)
 * @param {number} [p.densityKgM3]
 * @param {{minG:number, maxG:number}} [p.expectedMassG]
 * @returns {{ok: boolean, skipped: boolean, results: Array<{gate, status, detail}>, measured: object|null}}
 */
export function evaluateGates({ analysis, machine, densityKgM3, expectedMassG }) {
  const results = [];

  if (!analysis) {
    for (const gate of ["envelope", "watertight", "mass"])
      results.push({ gate, status: "skipped:no-mesh", detail: "no mesh artifact produced — gate did not run" });
    return { ok: true, skipped: true, results, measured: null };
  }

  const { bboxMm, watertight, volumeMm3, triangles } = analysis;
  const env = machine?.buildVolumeMm;
  if (env) {
    // Sorted part dims vs sorted envelope: the part may be stood on any of its
    // sides and turned a quarter at a time, and the smallest dimension only has
    // to clear the smallest side of the box.
    //
    // That is NOT "any orientation", which is what this said. Sorting compares
    // the part square-on to the machine's axes; a part that would only fit
    // lying at 45 degrees across the plate is refused here. The gate is more
    // conservative than the old wording promised, so the wording moved to meet
    // it — a reader who is told the check tried everything reads a rejection as
    // "impossible" when it means "impossible without tilting it".
    const part = [bboxMm.x, bboxMm.y, bboxMm.z].sort((a, b) => a - b);
    const box = [env.x, env.y, env.z].sort((a, b) => a - b);
    const fits = part.every((d, i) => d <= box[i]);
    results.push({
      gate: "envelope",
      status: fits ? "pass" : "fail",
      detail: `part ${fmtBox(bboxMm)} vs ${machine.id ?? "machine"} build volume ${fmtBox(env)} ` +
        `(stood square on any of its sides; the check never tilts the part on the plate)`,
    });
  } else {
    results.push({ gate: "envelope", status: "skipped:no-machine-profile", detail: "no buildVolumeMm in machine profile" });
  }

  results.push({
    gate: "watertight",
    status: watertight ? "pass" : "fail",
    detail: `mesh of ${triangles} triangles is ${watertight ? "a closed 2-manifold" : "NOT closed — open edges or inconsistent winding"}`,
  });

  let massG = null;
  if (typeof densityKgM3 === "number") {
    massG = round4(volumeMm3 * densityKgM3 * 1e-6); // mm3 x kg/m3 -> g
    if (expectedMassG && typeof expectedMassG.minG === "number" && typeof expectedMassG.maxG === "number") {
      const inRange = massG >= expectedMassG.minG && massG <= expectedMassG.maxG;
      results.push({
        gate: "mass",
        status: inRange ? "pass" : "fail",
        detail: `computed ${massG}g (${round4(volumeMm3)}mm3 x ${densityKgM3}kg/m3) vs expected ${expectedMassG.minG}-${expectedMassG.maxG}g`,
      });
    } else {
      results.push({ gate: "mass", status: "skipped:no-expectation", detail: `computed ${massG}g; request states no expectedMassG range` });
    }
  } else {
    results.push({ gate: "mass", status: "skipped:no-density", detail: "request carries no material density" });
  }

  return {
    ok: results.every((r) => r.status !== "fail"),
    skipped: results.some((r) => String(r.status).startsWith("skipped")),
    results,
    measured: { bboxMm, watertight, volumeMm3: round4(volumeMm3), triangles, ...(massG !== null ? { massG } : {}) },
  };
}

const round4 = (n) => Math.round(n * 10000) / 10000;
const fmtBox = (b) => `${r2(b.x)}x${r2(b.y)}x${r2(b.z)}mm`;
const r2 = (n) => Math.round(n * 100) / 100;

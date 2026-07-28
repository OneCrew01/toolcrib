# BL-004 · Assembly weight & balance — mass-weighted CG as a deterministic gate

**Status:** OPERATOR-RELEASED for immediate night-team execution (2026-07-23) —
deadline-safety rules of engagement still bind. **Priority:** 2 of the released pair.
**Scope:** additive.

## Why

Where the weight of an assembly sits is a number people get wrong by guessing, and it
is pure arithmetic over data we already produce: per-part mass and center of mass.
FN-021's divergence-theorem analyzer already computes volume from a mesh; the centroid
(and the inertia tensor, stretch) is the same integral family. An assembly-level
report with a balance-point window gate is the same trust-layer pattern — a number
with its basis printed beside it, and a check that refuses instead of shrugging —
pointed at a number nobody currently checks, and no generative-CAD demo shows it.

## Honest boundaries

1. Modeled mass is solid/nominal; printed mass depends on infill + filament density.
   **Calibration hook is first-class:** a part's `measuredMassG` (operator's scale)
   overrides modeled mass, and the report states which basis each part used.
2. **This is mass and a balance point, nothing else.** It says nothing about whether
   the assembly is strong enough, stiff enough, or safe to use. Mass, balance point
   and (stretch) inertia only.

## Deliverables

- `server/wb/mesh-props.mjs` — extend-by-import (never modify) the FN-021 approach:
  `meshProperties(stlBuffer)` → `{volumeMm3, centroidMm:[x,y,z], watertight}` via
  signed-tetrahedra centroid; stretch: inertia tensor (document the reference frame).
  Validate against `samples/plain-plate-stl/source.stl` — centroid of the symmetric
  plate must land at the geometric center within tolerance; state the measured error.
- `server/wb/wb.mjs` — `assemblyWB(parts, opts)`:
  `parts: [{name, stl|props, densityKgM3 or measuredMassG, positionMm:[x,y,z],
  rotationDeg?}]` → `{totalMassG, cgMm:[x,y,z], perPart:[{name, massG, basis:
  "modeled"|"measured", cgMm}], window?}` — mass-weighted combined CG with per-part
  translation (rotation = stretch). `opts.cgWindow: {axis:"x", minMm, maxMm}` arms
  the gate: outside window throws `CgWindowError` (fail-closed, house pattern).
- `server/wb/wb.test.mjs` — CG math vs hand calc (two known solids at known offsets);
  measured-mass override changes the answer and the basis label; window gate throws
  both sides; degenerate inputs rejected loudly.
- `samples/wb-demo/` — three-part assembly from parts we already have (flush-mount
  panel + insert + a ballast block), `wb-report.json` + `wb-report.md` showing
  per-part rows, total, CG, and a deliberately armed window that PASSES — plus the
  same assembly with the ballast moved, FAILING the gate. Pass/fail pair = the demo.

## Demo money-shot — WITHDRAWN

**The pitch that used to open this section is withdrawn, and it was wrong twice.** It
called the balance point the first number a pilot checks, and it said the gate refuses
the *package*. Both are described here rather than reprinted: quoted whole they read as
claims, and a quote travels without the paragraph that corrects it. What was accurate:

> "Three printed parts, one command: total mass, combined CG, computed from the same
> meshes the trust layer already verifies, calibrated by a kitchen scale."

*Correction (2026-07-28).* Second one first: putting this in a cockpit dressed an
arithmetic tool up as something it is not. It adds up masses and works out where the
balance point lands. That is useful to anyone bolting printed parts together — a camera
rig, a robot arm, a shelf bracket — and the flying language only told a reader who the
tool was really built for. Now the main one: the withdrawn line said the gate refuses
the package, and that is not what shipped. What it refuses is a
**weight-and-balance report**.
`assemblyWB` is a standalone function: nothing under `server/pipeline/`,
`server/package/` or `server/api/` imports it, so no job package is ever in its
hands, and it is not on the `npm run demo` path. The gate itself is real and
fail-closed, and the pass/fail pair in `samples/wb-demo/` is the proof — one assembly
inside the window with its report written out, and the same assembly with the ballast
slid outboard, where the refusal is what got written instead. The pitch's wording was
aspirational; it is corrected here rather than quietly edited out, and the README says
the accurate version.

## Post-contest runway (recorded, NOT in scope now)
RC airframe sectioned to the print bed with design-CG validation (25–33% MAC
convention); inertia-tensor flight-dynamics handoff; measured-mass database per
filament. These wait.

## Sources
FN-021 (analyzer ≡ Engine mass), `server/package/stl-analyze.mjs`,
Zoo `/file/center-of-mass` (cross-check surface), repo fail-closed patterns.

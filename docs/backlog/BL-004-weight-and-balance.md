# BL-004 · Assembly weight & balance — mass-weighted CG as a deterministic gate

**Status:** OPERATOR-RELEASED for immediate night-team execution (2026-07-23) —
deadline-safety rules of engagement still bind. **Priority:** 2 of the released pair.
**Scope:** additive.

## Why

CG is the single most safety-critical number on an aircraft, and it is pure
arithmetic over data we already produce: per-part mass and center of mass. FN-021's
divergence-theorem analyzer already computes volume from a mesh; the centroid (and
the inertia tensor, stretch) is the same integral family. An assembly-level W&B
report with a CG-window gate is the trust-layer pattern pointed at the most aviation
number there is — and no generative-CAD demo shows it.

## Honest boundaries

1. Modeled mass is solid/nominal; printed mass depends on infill + filament density.
   **Calibration hook is first-class:** a part's `measuredMassG` (operator's scale)
   overrides modeled mass, and the report states which basis each part used.
2. **No aerodynamics.** No lift, stall, control authority, thrust. W&B and (stretch)
   inertia only. Never imply "will it fly."

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

## Demo money-shot

> "Three printed parts, one command: total mass, combined CG, and a gate that refuses
> the package when the CG leaves the declared window. Weight and balance — the first
> number any aviator checks — computed from the same meshes the trust layer already
> verifies, calibrated by a kitchen scale."

## Post-contest runway (recorded, NOT in scope now)
RC airframe sectioned to the print bed with design-CG validation (25–33% MAC
convention); inertia-tensor flight-dynamics handoff; measured-mass database per
filament. These wait.

## Sources
FN-021 (analyzer ≡ Engine mass), `server/package/stl-analyze.mjs`,
Zoo `/file/center-of-mass` (cross-check surface), repo fail-closed patterns.

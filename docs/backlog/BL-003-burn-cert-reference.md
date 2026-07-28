# BL-003 · Burn-cert reference library — design-for-flammability-compliance

**Status:** OPERATOR-RELEASED for immediate night-team execution (2026-07-23) —
deadline-safety rules of engagement still bind (new files only, demo path untouched,
suite stays green). **Priority:** 1 of the released pair. **Scope:** additive.

## Why (grounded in primary sources)

FAA technical note TN23-65 quantified flammability of 3D-printed parts: the dominant
variables are **material, wall thickness, and infill percentage**. Same material and
infill, wall 0.10"→0.25": flame time drops from >40 s to <5 s — an ~8× improvement
from geometry alone. Infill <~20% produced burn lengths >3"; higher infill brought
0.5–2.0". UL-94 ratings are thickness-specific (a V-0 material at 3 mm can be V-1 at
1 mm; ULTEM 9085 reaches V-0 at 0.508 mm, PC-ABS-FR needs ~1.5 mm). Geometry the CAD
controls is a top-two burn factor; infill/material/orientation are print-time facts
the CAD cannot enforce but the package can REQUIRE.

## Hard boundaries (never blur these)

1. **Material chemistry sets the floor; geometry cannot overcome it.** A flammable
   filament in a perfect shape still fails.
2. **Nothing here certifies anything.** Real cert is a physical coupon in a burn
   chamber per FAR 25.853. This library delivers *design-for-burn-cert*: geometry
   that follows the FAA's own published findings + the print recipe, reproducibly.
   Flag, don't certify — every output carries the advisory disclaimer.

## Deliverables

- `server/reference/tables/burn-cert.mjs` — rules BC-001.. via `makeTable`, all
  `PENDING_OPERATOR`, each citing document + section (TN23-65 / UL-94 data / FAR
  25.853 context). Fetch the sources to confirm exact values and section numbers;
  where a number cannot be confirmed from a fetched source, mark the citation
  `UNCONFIRMED — verify against the printed source` (never invent). Rule classes:
  min-wall floors (general FR floor + material-specific), wall-vs-flame-time datum,
  min infill % (**non-geometric → package requirement**), material-floor note-rule,
  design rules (uniform thickness, no thin flame-propagating fins/webs — ribs over
  thin webs). Fail-closed lookups exported from the table module (fit-table pattern).
- `server/generators/burncert-validate.mjs` — **sampled min-wall gate**: parse an STL
  (import `server/package/stl-analyze.mjs`, do not modify it), ray-sample local wall
  thickness (per sampled facet: cast inward along −normal, nearest opposing
  intersection = local thickness), report min/median sampled thickness vs the rule
  floor. Approximate by nature — say so in the output (`method: "ray-sampled,
  N samples"`). Throws `BurnCertError` below floor; CLI form for standalone runs.
- `server/generators/burncert-recipe.mjs` — `printRecipe({material, rules})` →
  structured object + markdown block: material, min infill %, min wall, orientation
  note, disclaimer. (Traveler wiring is a one-line future hook — pipeline is frozen;
  the recipe ships in the sample bundle now.)
- `server/generators/burncert.test.mjs` — floor pass/fail both ways on known meshes;
  fail-closed on PENDING table without allowDraft; recipe contains every required
  field + the disclaimer; determinism.
- `samples/burn-cert/` — one compliant part (≥1.5 mm wall) with passing gate output +
  `recipe.md`, one deliberately thin part (0.8 mm) with the failing gate output.
  The pass/fail pair IS the demo.
- `docs/VERIFICATION_LOG.md` — append BC rows (PENDING; operator verifies against the
  fetched/printed sources).

## Demo money-shot

> "This bracket passes the FAA's own wall-thickness findings by construction — and
> here's the same bracket 0.7 mm thinner, caught by the gate before it ever printed.
> The traveler tells the shop the half the CAD can't enforce: PC-ABS-FR, ≥25% infill."

*Correction (2026-07-28).* The pitch above says the bracket "passes the FAA's own
wall-thickness findings," and that reads as though a document graded it. Nothing here
is graded by anyone. FAA TC TN23-65 is a public research report; this repo read a
wall-thickness number out of it, cited the paragraph the number came from, and built a
checker that measures an STL against that number. Passing our checker is passing our
checker, and the row stays marked unverified until a person has read the source and
signed it off — a real burn rating comes from a physical coupon burned in a lab, never
from a mesh. The pitch is corrected here rather than quietly edited out, and the README
says the accurate version. ("Traveler" is shop shorthand for the printed sheet that
travels with a part; it carries the things a CAD file cannot, like which plastic to use
and how solid to print it.)

## Sources
FAA TC TN23-65 (fire.tc.faa.gov/pdf/tctn23-65.pdf) · UL-94 thickness data ·
FAR 25.853 (context only) · existing repo patterns: `flush-mount-fit.mjs`,
`stl-analyze.mjs` (FN-021).

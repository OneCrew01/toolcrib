# BL-001 · Uniform / symmetric apply — one definition across the ends that must line up

**Status:** ready · not started **Priority:** 1 (ship candidate) **Scope:** additive, new files only

## Why (grounded in our own field notes)

Text-to-CAD silently drifts on symmetric intent. Ask for matching features on multiple
ends in prose and you get near-misses: **FN-018** measured a 3.6% mass spread across
phrasings of *one* geometry, with within-phrasing nondeterminism; **FN-020** showed
vernacular phrasings producing "slightly different parts" (28.9753 g vs 28.9452 g) for
the same intent. Panel fabrication needs features that are **equal across the ends that
must line up**, and today the operator has to hand-specify each one and hope the
generator keeps them matched. It doesn't, reliably.

## Goal

A deterministic primitive that applies **one** feature definition to a declared set of
edges/ends and **guarantees** they are identical and aligned — correct by construction,
verified by measurement. Declare once; mirror; prove.

## Deliverables (match the flushmount pattern)

- `server/generators/uniform.mjs` — exports
  `applyUniform(baseSpec, feature, targets, opts)`:
  - `targets` is a **declared set**, e.g. `{ edges: ['x-min','x-max'] }` or
    `{ corners: 4 }` — not repeated prose.
  - `opts` = `{ align: true, mirror: true, tol: 0.01 }`.
  - Emits KCL that places the **same parametric feature** on every target from a single
    definition (loop/pattern in the generator). Deterministic: same spec ⇒ byte-identical
    KCL (assert it, per FN-012 determinism).
- `server/generators/uniform-validate.mjs` — the **alignment gate**, fail-closed:
  - For each pair that must line up, assert positions match within `tol`
    (edge-distance equality), reusing the bbox/edge checks already in the reference gate.
  - Assert each target's **mass contribution is identical** — symmetric features remove
    equal volume; reuse the existing `/file/mass` + local STL analyzer path (FN-021), no
    new API surface.
  - Throw on any mismatch (`UniformAlignmentError`, mirroring `UnverifiedRuleError`).
- `server/generators/uniform.test.mjs` — at minimum:
  1. N identical targets ⇒ N identical measured contributions (gate passes).
  2. A deliberately mis-specified target ⇒ gate **fails closed** (catches the drift).
  3. Determinism: same spec ⇒ byte-identical KCL across runs.
- `samples/uniform-panel/` — one panel with 4 aligned edge features, plus the
  **before/after** artifact: prose-drift masses (A/B/C/D, from a text-to-cad run or the
  FN-020 data) beside the uniform result (X × 4). That side-by-side is the demo.

## The demo money-shot (why this is worth a night)

> "Prose gave me four different corners — masses A, B, C, D. `applyUniform` gave four
> identical, aligned ones — mass X each — and the alignment gate proves it. Same intent,
> zero drift."

That is the trust-layer thesis in a single frame, and it's a stronger 20%-wow beat than
anything the core loop shows on its own.

## Explicitly NOT in scope

No general constraint solver, no arbitrary transforms, no UI, no changes to the demo
path. Just: declare-set → mirror/align → validate. If it grows past that, stop and log it.

## Acceptance criteria

- `applyUniform` produces aligned features from one definition.
- `uniform-validate` catches a broken alignment (test 2 goes red when alignment breaks).
- All new tests green; `npm test` still 100%; `npm run demo` unchanged and still green.
- `samples/uniform-panel/` bundle present with the before/after artifact.
- A field note (or README line) + a `CURRENT_STATE.md` entry recorded.

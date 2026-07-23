# BL-002 · Color as the operation — "paint the op"

**Status:** ready · not started **Priority:** 2 (experimental / roadmap) **Scope:** additive, new files only

## Why

Describing each manufacturing feature in prose is exactly where text-to-CAD drifts
(FN-018/FN-020) — and it's verbose. A **color convention** lets intent be declared once
and read deterministically: instead of re-explaining a countersink five ways, you tag a
face "countersink-red" and the tool knows. This is the Zoo "draw on the model" idea
reframed as a **machine-readable operation tag**.

## Goal

A color→operation convention (a small, documented spec) plus a reader that turns
color-tagged intent into deterministic operations — so a developer declares a feature by
color, not by paragraph.

## Scope — the makeathon-cheap version (a color TAG in config, NOT marker-drawing)

- `server/reference/op-colors.mjs` — the **color map**: a documented, cited table mapping
  named colors / hex to operations + default params, e.g.
  `CS-RED → countersink 100°`, `POCKET-BLUE → CNC pocket`, `TAP-GREEN → tap M5`.
  Fail-closed on unknown colors (`UnverifiedColorError`, matching the reference module's
  `UnverifiedRuleError` pattern). This file alone has standalone value as a published
  convention.
- `server/generators/paintop.mjs` — `fromColorTags(baseSpec, tags)` where
  `tags = [{ face|region, color }]` → resolves each via `op-colors` → emits the
  deterministic feature KCL. **Reuse the flushmount feature builders**; do not write new
  geometry primitives.
- `server/generators/paintop-validate.mjs` — assert every declared color resolved to a
  real op and the resulting geometry carries the expected feature (mass delta per op,
  reusing the mass gate). Fail-closed.
- `server/generators/paintop.test.mjs` — known colors resolve; unknown color fails
  closed; two identical color tags ⇒ identical ops (determinism).
- `samples/paintop-plate/` — one plate described **purely by color tags**, generated and
  validated.

## Honest caveats — encode these, do not overreach

- The **full "draw on the model with a marker and read the color off the B-rep/mesh
  faces"** version is **NOT this task.** Zoo's import/color handling has known quirks
  (FN-023: the engine can't even re-import its own exports without stripping its own
  extension), and reading face color off imported geometry is heavy and unproven on this
  timeline. This task is the **config-level color tag only.** The visual/marker version
  goes in the README "where this goes next," and stays there.
- Lower priority than BL-001 and more experimental. **If the window is short, ship only
  `op-colors.mjs`** — the documented convention + a reader stub. A published color→op
  convention is useful to developers on its own, even without the full generator.

## Acceptance criteria

- `op-colors.mjs` documented, cited, and fail-closed on unknown colors.
- `fromColorTags` emits deterministic ops for known colors (byte-identical KCL on repeat).
- `paintop-validate` confirms the expected feature is present per color.
- All new tests green; `npm test` still 100%; `npm run demo` unchanged and still green.
- `samples/paintop-plate/` present; README "where this goes next" notes the marker
  version as roadmap (not built).

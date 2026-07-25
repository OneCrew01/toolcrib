# BL-005 · Panel-overlay generator — replaceable backlit, two-tone, modular instrument overlays

**Status:** ready · not started **Priority:** 3 (most demo-worthy of the raw ideas) **Scope:** additive, new files only

## Why

The structural aluminum panel stays in the airplane — it carries the mounting loads and
isn't ours to touch. The **overlay** that sits over/around it is a wear-and-style item
that should be **replaceable and plug-and-play**: swap the face without touching
structure. This is the flush-mount generator grown up — it already does pairs,
per-side clearance, chamfers, two colors, and cited fit rules (`flushmount.mjs`,
FMF-001..010). A panel overlay is the same spine plus light channels, legends, and
modular click/slide connectors.

## What Zoo does natively (verified) — build on these

- **Panel body + instrument cutouts:** `subtract` (already proven).
- **Internal light channels + placeholder "shell":** `sweep` a profile along a path or
  `subtract` a channel prism; blind pockets so the backlight strip lays inside without
  breaking the face; model a thin placeholder solid for the light volume and color it for
  preview. `shell`/`hollow` available.
- **Two-tone / multi-color:** `appearance({color,metalness,roughness}, solid)` with
  `appearance::hexString` — per-solid color, native. Dark body + legend layer = two
  solids, two appearances. Prints in color on the P1S.
- **Numeric scales, tick marks, index arcs, graduations:** native — lines, arcs,
  `patternLinear/Circular`. The *marking* half needs no font.
- **Modular click/slide connectors:** snap-fit clips, dovetail slides, tongue-and-groove,
  detents — all geometry (`extrude`/`sweep`/`subtract`/`pattern`).
- **Preview:** in-engine snapshot route (FN-022) renders the two-tone panel before print.

## The one design fork — LOCK THIS FIRST: how the lettering is made

KCL has **no native `text()` and no SVG import in the std lib** (verified). Freeform word
labels ("OIL PRESS", "FUEL") need glyph geometry. Three paths, in recommended order:

1. **RECOMMENDED — font glyph-outline → geometry ("geo-map"):** parse an
   **open-license (SIL OFL) font** (TTF/OTF glyph outlines are quadratic/cubic Béziers),
   convert each glyph to a KCL sketch, then `extrude`/`subtract` for raised or through-cut
   legends. **License gate:** the specific font MUST be OFL or equivalently permissive for
   embedded/derivative geometry, or it can't ship in the public repo — confirm the exact
   font's license before use (many Google Fonts are OFL; verify the one chosen). Ship the
   font file + its license text in the repo.
2. **ALT — parametric single-stroke "engineering font" module:** emit A–Z / 0–9 as KCL
   sketch strokes. No external dependency, fully deterministic, but more build effort.
3. **FALLBACK — engrave labels on the CNC** via `c2d-forge`, or leave through-cuts to be
   filled by translucent filament. Zoo makes the panel; the second machine makes the words.

Numbers/ticks/scales use the native path regardless; the font is only for words.

## Deliverables (match the flushmount pattern)

- `server/generators/paneloverlay.mjs` — spec → panel body + instrument cutouts + light
  channels + numeric scales + snap/slide connectors; deterministic (byte-identical KCL on
  repeat).
- `server/generators/panelfont.mjs` — the chosen text path from the fork (glyph-geo-map
  reader, or the stroke-font). Isolate it so the fork decision lives in one file.
- `server/generators/paneloverlay-validate.mjs` — gate, fail-closed: channel + wall
  dimensions within spec; both color solids present; **snap/slide clearance within the
  FMF class** (reuse `flushmount` fit rules — the click-fit IS a clearance-class problem);
  legend cutout present (bbox / mass delta).
- `server/generators/paneloverlay.test.mjs` — determinism; a broken connector clearance
  fails the gate; a known legend resolves to expected geometry.
- `samples/panel-overlay/` — one two-tone backlit panel with channels, a numeric scale,
  one word label, and a snap/slide edge, plus the in-engine preview PNG.

## Honest boundaries (state these; do not overreach)

- **Translucency is a filament property, not geometry.** Zoo makes the channel and the
  legend through-cut; whether light passes is the filament chosen at print time.
- **Snap-fit retention/flex is not simulated** (no FEA). Fit-test physically with
  clearance coupons — the FMF method already exists for exactly this.
- **No optical sim** for backlight evenness — test the real part on the bench.
- **Font license is a hard gate** — OFL/permissive only, verified per font, license text
  shipped.

## Acceptance criteria

- `paneloverlay` emits body + cutouts + channels + scales + connectors deterministically.
- Legends generate via the locked text path; font license verified + shipped (if path 1).
- `paneloverlay-validate` catches an out-of-clearance connector.
- All new tests green; `npm test` still 100%; `npm run demo` unchanged and still green.
- `samples/panel-overlay/` present with preview.
- Field note / README line + `CURRENT_STATE.md` entry recorded.

## NOT in scope

Optical/light simulation, a full font-rendering engine (one clean font is enough),
kerning perfection, or any change to the demo path. One good backlit two-tone panel with a
working snap edge proves the whole idea.

*Operator note (2026-07-23): filed at operator request; operator is a few days ahead and
will decide with the team whether this becomes a feature project or a post-makeathon HAS
capability. Makeathon scope stays frozen either way.*

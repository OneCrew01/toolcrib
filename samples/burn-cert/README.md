# Burn-cert samples — the pass/fail pair IS the demo

Two coupon plates, same footprint, one wall-thickness change. Both were
authored as KCL, executed and exported to STL by the live Zoo engine
(`mcp export_kcl`, 2026-07-23), then run through the sampled min-wall gate:

```
node server/generators/burncert-validate.mjs samples/burn-cert/plate-2.0mm/part.stl --material=PC-ABS-FR --allow-draft
node server/generators/burncert-validate.mjs samples/burn-cert/plate-0.8mm/part.stl --material=PC-ABS-FR --allow-draft
```

| Bundle | Wall | Gate | Why |
|---|---|---|---|
| `plate-2.0mm/` | 2.0 mm | **PASS** (margin +0.5 mm) | clears the PC-ABS-FR 1.5 mm floor (BC-003) |
| `plate-0.8mm/` | 0.8 mm | **FAIL** (margin −0.7 mm), exit 1 | same plate 0.7 mm thinner — caught before it ever printed |

Each bundle: `part.kcl` (source), `part.stl` (engine export), `gate-output.json`
(the gate's verbatim report). The compliant bundle also carries `recipe.md` —
the half the CAD cannot enforce (material, ≥25% infill, orientation), which the
package REQUIRES rather than pretends to control.

Everything here is watermarked `DRAFT — NOT VERIFIED`: every burn-cert rule is
`PENDING_OPERATOR` until a certificated person signs the rows in
`docs/VERIFICATION_LOG.md` against the printed sources (FAA TC TN23-65 could
not be fetched at build time — 503/403 on both official mirrors).

> ADVISORY — design-for-burn-cert, not certification. Real certification is a
> physical coupon in a burn chamber per 14 CFR 25.853 / Appendix F. Material
> chemistry sets the floor; geometry cannot overcome it. Flag, don't certify.

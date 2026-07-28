# Burn-cert samples — the pass/fail pair IS the demo

Two coupon plates (a coupon is a small test piece you print instead of the real
part, to check one thing about it), same footprint, one wall-thickness change. Both were
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
(the gate's verbatim report). The 2.0 mm bundle also carries `recipe.md` —
the half the CAD cannot enforce (material, ≥25% infill, orientation), which the
package REQUIRES rather than pretends to control.

Everything here is watermarked `DRAFT — NOT VERIFIED`: every burn-cert rule is
`PENDING_OPERATOR` until someone with the printed source in front of them signs
the rows in `docs/VERIFICATION_LOG.md` (FAA TC TN23-65 could not be fetched at
build time — 503/403 on both official mirrors).

> ADVISORY. This compares a design against a wall thickness written down in
> this repo's own reference table. The rows it used are printed beside this
> result — where each number is claimed to come from, and whether anybody has
> signed it off. It proves nothing about how a part burns. The only thing that
> proves that is burning a real sample of the real plastic in a lab
> (14 CFR 25.853 / Appendix F), and this is not that. The plastic you pick sets
> the floor and no shape gets around it. Read this as something to go and check,
> not as an answer.

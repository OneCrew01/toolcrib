## Print recipe — design-for-burn-cert

**DRAFT — NOT VERIFIED** — rules await operator sign-off (docs/VERIFICATION_LOG.md).

- **Material:** PC-ABS-FR
- **Minimum wall:** 1.5 mm (material-specific UL listing (BC-003))
- **Minimum infill:** 25% — print-time — package requirement; CAD geometry cannot enforce infill
- **Orientation:** Record the actual build orientation on the traveler. TN23-65 treated orientation as an interaction effect with material, thickness, and infill (UNCONFIRMED — verify against the printed source); do not rotate the part off its modeled orientation without re-running the min-wall gate on thin features.

> ADVISORY. This compares a design against a wall thickness we read out of a published test report; it proves nothing about how a part burns. The only thing that proves that is burning a real sample of the real plastic in a lab (14 CFR 25.853 / Appendix F), and this is not that. The plastic you pick sets the floor and no shape gets around it. Read this as something to go and check, not as an answer.

> Material chemistry sets the floor and geometry cannot overcome it: a flammable filament in a perfect shape still fails, and a rating held at 3 mm does not follow the material down to 1 mm.

Citations:
- wall floor: UL-94 thickness data — Forge Labs, 'UL-94 Fire Safety Standards in Additive Manufacturing' (secondary source), Ch. UL-94, Sec. Thickness-specific ratings, para Fetched 2026-07-23 (forgelabs.com/blog/ul-94-fire-safety-standards-additive-manufacturing) — confirm against the UL Yellow Card for the exact filament grade
- chemistry: UL-94 thickness data — Forge Labs, 'UL-94 Fire Safety Standards in Additive Manufacturing' (secondary source), Ch. UL-94, Sec. Thickness-specific ratings, para Fetched 2026-07-23 (forgelabs.com/blog/ul-94-fire-safety-standards-additive-manufacturing) — confirm against the UL Yellow Card for the exact filament grade
- infill: FAA TC TN23-65 — An Evaluation of the Flammability of 3D Printed Parts, Ch. Results & conclusions, Sec. Infill percentage vs burn length, para UNCONFIRMED — verify against the printed source


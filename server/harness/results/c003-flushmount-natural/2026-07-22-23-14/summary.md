# c003-flushmount-natural — run 2026-07-22-23-14

Flush-mount pair (panel + insert, 0.15mm/side clearance, chamfered lead-in, two colors) asked seven unique ways: does text-to-cad ever deliver both bodies? Mass gate is loose on purpose — the kcl/ directory is the analysis artifact.

Runs: 7/7 · concurrency 2 · spend **$13.40** (avg $1.914/run) · balance $4944.02

| case | runs | valid | invalid | gen-failed | timeout | other | pass rate | latency s (min/med/max) | note |
|---|---|---|---|---|---|---|---|---|---|
| f1-single-prompt-full-spec | 1 | 0 | 0 | 0 | 0 | 1 | 0% | —/—/— | fully specified; both parts dimensioned explicitly |
| f2-assembly-framing | 1 | 1 | 0 | 0 | 0 | 0 | 100% | 400.8/400.8/400.8 | assembly framing; insert size must be derived (30 − 2×0.15) |
| f3-bezel-product-framing | 1 | 1 | 0 | 0 | 0 | 0 | 100% | 328.2/328.2/328.2 | product framing (face plate + blanking bezel), 32mm opening |
| f4-explicit-two-bodies | 1 | 1 | 0 | 0 | 0 | 0 | 100% | 271.3/271.3/271.3 | modeling requirement stated outright: two separate solids |
| f5-shop-vernacular | 1 | 1 | 0 | 0 | 0 | 0 | 100% | 118.7/118.7/118.7 | shop-floor phrasing: window, plug, sits smooth, a hair small |
| f6-fit-callout | 1 | 0 | 0 | 1 | 0 | 0 | 0% | 900.2/900.2/900.2 | fit callout: 0.3mm TOTAL clearance — must halve it per side |
| f7-minimal-underspecified | 1 | 1 | 0 | 0 | 0 | 0 | 100% | 182.4/182.4/182.4 | underspecified: opening size and chamfer left to defaults |

**Reading it:** `invalid` = Zoo said completed, the mass gate said the geometry is wrong — the category the status field cannot see.

Ledger: `ledger.jsonl` · KCL per run: `kcl/` · Candidate field-note material: any case with invalid>0 or mixed pass/fail.

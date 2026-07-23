# c003-flushmount-natural — run 2026-07-22-23-14 (RECOVERED)

Original run lost 2 entries to early-404 polling (FN-011); re-polled by id.

| case | runs | valid | invalid | gen-failed | outputs-lost | other | pass rate | mass values (g) | kcl chars | note |
|---|---|---|---|---|---|---|---|---|---|---|
| f1-single-prompt-full-spec | 1 | 1 | 0 | 0 | 0 | 0 | 100% | 28.9343 | 8561 | fully specified; both parts dimensioned explicitly |
| f2-assembly-framing | 1 | 1 | 0 | 0 | 0 | 0 | 100% | 28.9343 | 10966 | assembly framing; insert size must be derived (30 − 2×0.15) |
| f3-bezel-product-framing | 1 | 1 | 0 | 0 | 0 | 0 | 100% | 29.6944 | 17880 | product framing (face plate + blanking bezel), 32mm opening |
| f4-explicit-two-bodies | 1 | 1 | 0 | 0 | 0 | 0 | 100% | 28.9343 | 9626 | modeling requirement stated outright: two separate solids |
| f5-shop-vernacular | 1 | 1 | 0 | 0 | 0 | 0 | 100% | 28.9753 | 5838 | shop-floor phrasing: window, plug, sits smooth, a hair small |
| f6-fit-callout | 1 | 0 | 0 | 1 | 0 | 0 | 0% |  |  | fit callout: 0.3mm TOTAL clearance — must halve it per side |
| f7-minimal-underspecified | 1 | 1 | 0 | 0 | 0 | 0 | 100% | 28.9452 | 9351 | underspecified: opening size and chamfer left to defaults |

`invalid` = completed status, geometry outside the analytic mass bounds — the category the status field cannot see.

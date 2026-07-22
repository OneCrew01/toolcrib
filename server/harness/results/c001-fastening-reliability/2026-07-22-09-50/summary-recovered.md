# c001-fastening-reliability — run 2026-07-22-09-50 (RECOVERED)

Original run lost 24 entries to early-404 polling (FN-011); re-polled by id.

| case | runs | valid | invalid | gen-failed | outputs-lost | other | pass rate | mass values (g) | kcl chars | note |
|---|---|---|---|---|---|---|---|---|---|---|
| a-plain-holes | 6 | 0 | 0 | 0 | 6 | 0 | 0% |  | 2436 | baseline; analytic 13.076g ±1% |
| b-countersink | 6 | 0 | 0 | 0 | 6 | 0 | 0% |  | 4804 | FN-006 case; loose bounds (head Ø unspecified) |
| c-counterbore | 6 | 2 | 0 | 0 | 4 | 0 | 33% | 12.6033 | 3570, 3663 | analytic 12.601g ±1.5% |
| d-hole-row | 6 | 2 | 0 | 0 | 4 | 0 | 33% | 10.1679 | 2593, 3331 | analytic 10.164g ±1% |
| e-l-bracket | 6 | 2 | 0 | 0 | 4 | 0 | 33% | 16.4266 | 5830, 4413 | loose bounds; corner modeling ambiguous by design |

`invalid` = completed status, geometry outside the analytic mass bounds — the category the status field cannot see.

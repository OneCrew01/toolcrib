# c001-fastening-reliability — run 2026-07-22-09-50

Reliability of text-to-cad per fastening feature class: identical prompt ×6, mass-gate validation on every completed run.

Runs: 30/30 · concurrency 2 · spend **$5.10** (avg $0.170/run) · balance $4977.94

| case | runs | valid | invalid | gen-failed | timeout | other | pass rate | latency s (min/med/max) | note |
|---|---|---|---|---|---|---|---|---|---|
| a-plain-holes | 6 | 0 | 0 | 0 | 0 | 6 | 0% | —/—/— | baseline; analytic 13.076g ±1% |
| b-countersink | 6 | 0 | 0 | 0 | 0 | 6 | 0% | —/—/— | FN-006 case; loose bounds (head Ø unspecified) |
| c-counterbore | 6 | 2 | 0 | 0 | 0 | 4 | 33% | 106.3/125.8/125.8 | analytic 12.601g ±1.5% |
| d-hole-row | 6 | 2 | 0 | 0 | 0 | 4 | 33% | 119.3/124.5/124.5 | analytic 10.164g ±1% |
| e-l-bracket | 6 | 2 | 0 | 0 | 0 | 4 | 33% | 151.6/176.7/176.7 | loose bounds; corner modeling ambiguous by design |

**Reading it:** `invalid` = Zoo said completed, the mass gate said the geometry is wrong — the category the status field cannot see.

Ledger: `ledger.jsonl` · KCL per run: `kcl/` · Candidate field-note material: any case with invalid>0 or mixed pass/fail.

# c002-phrasing-robustness — run 2026-07-22-21-40

Same countersunk-plate geometry asked five human ways: does phrasing change the part? Mass spread across cases = robustness.

Runs: 20/20 · concurrency 2 · spend **$14.23** (avg $0.712/run) · balance $4957.82

| case | runs | valid | invalid | gen-failed | timeout | other | pass rate | latency s (min/med/max) | note |
|---|---|---|---|---|---|---|---|---|---|
| p1-formal-spec | 4 | 0 | 0 | 0 | 0 | 4 | 0% | —/—/— | C001 case-b baseline phrasing |
| p2-drawing-callout | 4 | 2 | 0 | 0 | 0 | 2 | 50% | 204.6/268.9/268.9 | engineering-drawing callout style |
| p3-shop-vernacular | 4 | 2 | 0 | 0 | 0 | 2 | 50% | 229.5/231.8/231.8 | spoken shop-floor phrasing |
| p4-fastener-first | 4 | 2 | 0 | 0 | 0 | 2 | 50% | 224.8/237/237 | model must DERIVE hole + countersink from the fastener |
| p5-underspecified | 4 | 2 | 0 | 0 | 0 | 2 | 50% | 150.7/184.7/184.7 | angle unspecified — what default does it choose? |

**Reading it:** `invalid` = Zoo said completed, the mass gate said the geometry is wrong — the category the status field cannot see.

Ledger: `ledger.jsonl` · KCL per run: `kcl/` · Candidate field-note material: any case with invalid>0 or mixed pass/fail.

# Current State

*Updated every working session. What works, what's blocked, the next action.*

## 2026-07-22 · Day 1 — thin thread GREEN

**Works (all reproduced live today)**
- Auth (`GET /user` 200) and credits confirmed (FN-001, FN-003).
- Full OpenAPI spec pulled from the API root; export formats mapped (FN-002, FN-004).
- **Full chain proven:** intent → `POST /ai/text-to-cad/step?kcl=true` → constraint-based
  parametric KCL 2.0 → STEP (25 KB) + glTF (111 KB) via `/async/operations/{id}` →
  `POST /file/mass` validation: **13.0786 g vs 13.077 g hand calc (0.02%)**.
  Artifacts in `samples/plain-plate/`.
- `npm run demo` runs the chain headless, zero dependencies (Day-1 gate: PASSED).

**Found (the day's bug harvest — see API_FIELD_NOTES)**
- FN-005/006: countersink flush-mount prompt fails after ~8 min, 2/2 repro, leaking an
  internal cluster URL. This is the founding bug report AND the product thesis: plain
  hole patterns generate beautifully; add flush-mount countersinks and the pipeline
  itself falls over. The gap ToolCRIB exists to close, measured on day 1.
- FN-007: `outputs` only on the async-operations surface; unpadded base64.
- FN-008: REST-only validation is a real trust gate.

**Blocked / open**
- Makeathon minutes grant not identifiable in balance payload (FN-003) — ask Zoo.
- Websockets (`/ws/ml/copilot`, `/ws/modeling/commands`) unexercised; DXF lives there.
- Concurrent Agent session limits unknown.
- GitHub remote not yet created (operator action).

**Next action (Day 2 per build pack)**
- State machine + `StateStore` interface + LocalStore; job walks DRAFT→…→PDF_GENERATION
  with an append-only transition ledger.
- Start the fastening-reference schema (rule + citation shape) — first table: hole
  edge-distance rules (the thing the failed prompt needed).
- File the FN-006 bug as a GitHub issue on Zoo's repo (operator approves posting).

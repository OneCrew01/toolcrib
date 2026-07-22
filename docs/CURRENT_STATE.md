# Current State

*Updated every working session. What works, what's blocked, the next action.*

## 2026-07-22 · Day 1

**Works**
- Auth verified against `GET /user` (FN-001).
- Balance/credits confirmed live (FN-003).
- Full OpenAPI spec pulled from the API root (FN-002); export formats mapped (FN-004).
- First fastening-feature text-to-CAD probe fired (countersunk flush-mount plate);
  timing captured in FN-005.
- Repo scaffolded: README, field notes, decision log, architecture stub, thin-thread
  script, MIT license.

**Blocked / open**
- Makeathon minutes grant not identifiable in the balance payload (FN-003) — confirm
  with Zoo (office hours or Discord).
- Websocket surfaces (`/ws/ml/copilot`, `/ws/modeling/commands`) not yet exercised.
- Concurrent Agent session limits unknown.

**Next action**
- Finish the countersink probe evaluation: does the returned KCL actually place four
  holes at 10 mm edge distance with 100° countersinks? Log verdict.
- Run `/file/mass` validation on the exported STEP (closes the Engine-REST row).
- Start the fastening-reference schema (rule + citation shape).

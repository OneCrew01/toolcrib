# Current State

*Updated every working session. What works, what's blocked, the next action.*

## 2026-07-22 · Day 1 (late night) — harness live, campaign C001 complete

**Works**
- Full thin thread (see morning entry below): intent → KCL → STEP/STL/glTF → mass gate.
- **Reliability harness shipped and battle-tested:** modular campaigns
  (`server/harness/campaigns/`), worker pool, budget cap, JSONL ledger, per-run KCL
  capture, auto-summary — plus `recover-run.mjs`, which salvaged an interrupted run
  from ledger ids alone.
- **Campaign C001 (30 generations, $5.10):** all 30 completed server-side; 6 fully
  mass-validated (analytic agreement ~0.02% on every strict case); 24 hit FN-011
  (outputs stranded) with KCL recovered for all.

**The day's findings ledger (12 field notes, 3 GitHub-issue-grade)**
1. FN-006 — fastening prompts fail non-deterministically under load + internal URL leak.
2. FN-011 — burst-dispatched jobs complete but outputs become permanently unreachable.
3. FN-007 — outputs only on the async-operations surface, unpadded base64.
Plus: cost $0.17/generation (FN-012), near-deterministic codegen, 6× latency jitter.

**Blocked / open**
- Orphaned-outputs re-export path unknown — office-hours Q10 (also: `/file/execute/kcl`
  semantics as a possible server-side KCL→file route).
- Websocket protocol post-upgrade still unexercised (FN-009 = handshake only).
- GitHub issues for FN-006/FN-011 drafted in the field notes; filing needs operator go.

**Next action (Day 2)**
- State machine + StateStore/LocalStore + transition ledger (build pack Day 2).
- First fastening-reference table: hole edge-distance rules.
- Design C002 with phrasing variation per feature class (FN-012 method implication).
- Pre-office-hours: exercise `/ws/modeling/commands` post-upgrade (KCL execute + DXF).

---

## 2026-07-22 · Day 1 (morning) — thin thread GREEN

Auth, credits, spec mapped; chain proven end-to-end with 0.02% mass agreement;
`npm run demo` headless with zero dependencies; artifacts in `samples/`.
See ledger above for the full findings list.

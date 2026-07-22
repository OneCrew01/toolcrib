# Current State

*Updated every working session. What works, what's blocked, the next action.*

## 2026-07-22 · Day 2 — trunk built, protocol cracked, thesis quantified

**Works (all tested: 21/21 across two suites, `npm test`)**
- **State machine** (`server/state/`): SYS/HUMAN actor model with a provable human
  gate, hash-chained transition ledger with tamper detection, LocalStore,
  OUTPUTS_UNREACHABLE and GEOMETRY_INVALID as first-class states.
- **Fastening reference** (`server/reference/`): 10 rules (HED-001..010) with
  citations, fail-closed `UnverifiedRuleError`, DRAFT watermarks;
  `docs/VERIFICATION_LOG.md` awaits operator sign-off against the printed AC.
- **Websocket protocol solved** (`server/spikes/ws-modeling-spike.mjs`): headers-frame
  auth, ~50 ms command round-trips, exact bounding box, real DXF via `export2d`
  (FN-013..016). Three capability rows closed by measurement.
- **C002 phrasing campaign**: 3.6% mass spread across phrasings of one geometry,
  within-phrasing nondeterminism, dedupe discovery (FN-018, FN-011 root cause).
- **Metering cracked** (FN-017): 1 credit ≈ 1 API-second; grant ≈ 10,036 minutes.

**Operator queue**
- VERIFICATION_LOG red-pen session against the printed AC 43.13-1B (10 rules PENDING;
  Figure 4-5 values additionally need the printed figure — unencoded until then).
- Go-ahead to file GitHub issues: FN-006 (reliability+URL leak), FN-011 (dedupe
  orphans outputs), FN-013 (auth doc gap). All drafted in the field notes.

**Next action (Day 3, pre-office-hours)**
- Harness: tag dedupe hits explicitly (latency < 2 s ⇒ `completed_dedupe_hit`); nonce
  campaign prompts that need real generations.
- Wire the trunk end-to-end: job intake → reference (allowDraft) → generation →
  mass gate → package stub, driven by the state machine (build pack Day 3 territory).
- 6:45 AM Thursday: office hours with the kit + field notes open.

---

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

# Current State

*Updated every working session. What works, what's blocked, the next action.*

**Read the dates before you read the numbers.** Every `##` block below is a snapshot
written on the date in its heading and then left standing, so a count inside a block is
as-of that date and is not maintained afterwards — Day 2 night's "15/15 tests" for the
flush-mount generator was exact when written and that suite runs 16 today. The one
figure kept current is the suite total in the newest block, and it carries the date it
was last counted.

## 2026-07-24 · Day 5 — the live lane survives a real crash; Zookeeper joins the console

**Works (`npm test` on 2026-07-28: 297 server tests + `self-checks: 40 passed` +
`leak audit: CLEAN` over 243 tracked files, 0 failures; app builds clean)**

*The count above is the only figure in this file the header promises to keep current,
and it has moved a long way since this block's prose was written: 187 when it was last
counted on 2026-07-26, 297 today. It read 292 under today's date while the suite
actually ran 294: two commits added tests and neither came back here, which is exactly
the failure this file's header is written against. It moved again in the next commit
too, 296 to 297 — the figure is only ever true at the commit that measured it. Nothing
enforces it; it is prose, and `npm test` is the only thing that settles it.
Measured at this commit, 81 of those tests are in
`server/revision/` — the amendment module and its demonstration, D-009 — and 6 are the
citation-freshness sweep (`server/lib/doc-citations.mjs`); neither directory existed on
2026-07-26. The rest is hardening either side of them. None of it appears in the
bullets below, which are a 2026-07-24 snapshot and are not maintained. This file is a
session behind and should get its own block before the repo goes public.*
- **Console theme tokenized** (`app/src/index.css`): the last hardcoded hex/rgba
  values folded into CSS custom properties (hover shades, on-accent text, corner
  radius, shadow tint). Zero computed-value change, verified by diffing the built
  CSS before/after.
- **Live lane proven end-to-end — including its failure mode:** job 7767ef93
  (52×52×2 plate, four corner holes) ran a real generation on Zoo (154.2 s); the
  supervising process died mid-poll, so the live lane grew measured recovery for
  exactly that: `--resume-t2c-id` adopts the orphaned generation with no re-spend
  (prompt-match guarded — a resumed record with no prompt at all is refused
  outright, fail-closed), `--resume-job` re-enters the walk on the stranded job.
  Mass gate: **14.1802 g measured vs 14.1775 g analytic (0.019%)**. Ledger verified,
  dodCheck complete.
- **Zookeeper drafting panel** (`app/src/views/DraftPanel.tsx`,
  `app/src/lib/zookeeper.ts`): operator-mode NL chat over Zoo's copilot websocket,
  pure frame-classifier/aggregator plus a thin socket wrapper, **40 self-checks**
  wired into `npm test` as its last step (not just a dev-mode console warning).
  A hardening pass added a client-instance guard against a stale client's async
  close clobbering a fresh session, and surfaced backend-shutdown reasons in the
  status strip.
- **Nothing new closed in `docs/VERIFICATION_LOG.md`:** all 29 rows (10 HED, 10 FMF,
  9 BC) are still PENDING — the operator's red-pen and bench sign-off loop is still
  open.

**Operator queue (unchanged)**
1. Print the fit coupons and red-pen the AC 43.13-1B / burn-cert table rows against
   the printed sources — still PENDING across the board in `docs/VERIFICATION_LOG.md`.
2. Go/no-go on any FN still queued for filing.
3. The first live token session in the Zookeeper panel is the operator's to run —
   it needs a real Zoo token pasted by a human; nothing in this build can exercise
   operator mode on its own.

**Next (Day 6)**
- Form-created job click-through + the live-job console click-through — the
  console side of the money demo, done by the controller today.
- Video prep.
- Buffer-week submission gates ahead of the August 5 close.

---

## 2026-07-23 · Day 4 — the review console is live

**Works (96/96 server tests; app builds clean; verified by click-through in a real browser)**
- **Backend API** (`server/api/`, `npm start`, :8787): jobs create/list/detail with
  ledger + verification status, named-human decision route (approve → APPROVED →
  DELIVERED; revise requires a reason), package files served with traversal
  protection, live backend gated behind TOOLCRIB_ALLOW_LIVE. Shares the CLI's data
  dir — every prior job appears in the console.
- **Review console** (`app/`, vite :5173 → proxy :8787): job list with live state
  chips; job detail with the transition ledger as centerpiece ("ledger verified ✓"
  badge), gate cards (threshold vs measured), package panel (files + sha256 +
  downloads, engine-rendered preview, full packageHash, DRAFT amber badges), and the
  human-review bar (named actor required, two-click approve, 10 s confirm window).
  Footer states the credential boundary: no API key is baked into the build, and these
  screens talk only to the ToolCRIB backend — the one screen whose *browser* connects to
  Zoo is the Zookeeper panel, with a token the operator pastes (`app/src/App.tsx`). Not
  "the one screen that reaches Zoo": the New Job form's `live` backend makes the *server*
  call Zoo, so the browser scope is the part that is true on every view.
- **Browser-verified end to end:** job 6aabf842 approved through the UI —
  WAITING_FOR_HUMAN_REVIEW → APPROVED → DELIVERED, two HUMAN ledger rows, chain intact.

**Next (Day 5)**
- Form-created job click-through + one supervised LIVE text-to-cad job through the
  console (the money demo for the video).
- web-zookeeper panel (local/operator mode) as the NL intent layer.
- Docs polish sweep: README run-the-console section; screenshots.

## 2026-07-23 · Day 3 — the trunk is live; `npm run demo` IS the product

**Works (full suite green; `npm run demo` = judge path)**
- **Pipeline** (`server/pipeline/`): one request walks DRAFT → … →
  WAITING_FOR_HUMAN_REVIEW; backends replay/flushmount/live behind one interface;
  failures land in the right states with measured values in the ledger reason;
  EXPORT_FAILED + PDF_FAILED added to the machine.
- **DoD package** (`server/package/`): 11-file sealed bundle (10 artifacts +
  `manifest.json`; the pipeline appends an unsealed `notifications.log` afterwards, so
  the directory holds 12), 13-section PDF from a zero-dep
  PDF writer, manifest + recomputable packageHash, `dodCheck` audit — replay bundle
  audits complete, including the engine-rendered preview PNG.
- **Local STL analyzer**: volume/watertight/bbox with zero deps — reproduces Engine
  `/file/mass` to every printed digit (FN-021).
- **Preview route verified** (FN-022): import → zoom_to_fit → take_snapshot, ~2.5 s.
- **New bug found** (FN-023, issue-grade, awaiting operator go): the engine cannot
  re-import its own STEP/glTF exports; glTF fixed by stripping Zoo's own extension.

**Operator queue**
1. Print the fit coupons (unchanged — Design Studio export → P1S).
2. Red-pen the AC table rows (unchanged).
3. Go/no-go: file FN-023 as issue #4 on modeling-api.
4. Office hours Thu 6:45 AM — kit is loaded; add the FN-021 agreement line and the
   live `npm run demo` as the show-and-tell opener.

**Next (Day 4 territory)**
- Live-backend supervised run (one real text-to-cad job through the trunk).
- Fold expectedMassG into the request schema (currently read from the raw file).
- UI first pass: job list + review/approve screen against the backend.
- C004 candidate: text-to-cad iteration endpoint (`/ml/text-to-cad/iteration`) —
  unexplored surface.

**Optional night-team backlog (scope FROZEN — only if idle after core is green):**
Two additive feature specs filed in `docs/backlog/` — [BL-001](./backlog/BL-001-uniform-symmetric-apply.md)
(uniform/symmetric apply, ship candidate) and [BL-002](./backlog/BL-002-color-as-operation.md)
(color-as-operation, experimental). New files only; do not touch the demo path or the
core loop; `npm run demo` + `npm test` must stay green. Read `docs/backlog/README.md`
for the rules of engagement before starting. These are upside, not commitments.

---

## 2026-07-22 · Day 2 night — the first tool ships

**Works**
- **Flush-mount pair generator** (`server/generators/flushmount.mjs`, 15/15 tests):
  spec → panel + insert KCL, arithmetic-gated, chamfers built geometrically (corpus
  has no chamfer stdlib), two colors, optional rear lip; round variant is a single
  revolve. Engine-measured outline validation over the websocket: 3/3 exact bbox.
- **Fit rules** (`flush-mount-fit`, FMF-001..010, 12/12 tests): FDM clearance classes
  + chamfer/insert formulas, fail-closed, bench-verification procedure in the log.
- **C003** (7 phrasings, $13.40): 6/7 plausible, 3 phrasings mass-identical and one
  audited fully correct — but the machinist's fit callout failed hard and casual
  phrasings drifted silently (FN-020). FN-019: litterbox can't execute KCL (or
  anything, currently).

**Operator queue (the fun kind)**
1. **Print the coupon set — STLs are READY, no Design Studio step needed:**
   `samples/flush-mount/coupons/c0.10..c0.25/panel.stl + insert.stl` (exported via the
   live engine, all 12 sample files execute clean — post-Lee websocket lane). Print
   panels and inserts in two colors, then the bench sign-off procedure in
   VERIFICATION_LOG (calipers + initials = FMF rules go VERIFIED).
2. Red-pen session for the AC table rows (unchanged, still waiting on the printed AC).
3. Go/no-go: FN-024 as issue #5 (the engine's error text literally asks for it).

**Next (Day 3, pre-office-hours 6:45 AM Thu)**
- Wire trunk end-to-end: request → reference (allowDraft) → generate (flushmount OR
  text-to-cad) → mass/bbox gate → package stub, all through the state machine.
- Add FN-019 litterbox request ids + FN-020 scorecard to the office-hours flow.

---

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
- ~~GitHub issues~~ **FILED 2026-07-22 (operator-approved):**
  [modeling-api#1291](https://github.com/KittyCAD/modeling-api/issues/1291) (FN-006) ·
  [modeling-api#1292](https://github.com/KittyCAD/modeling-api/issues/1292) (FN-011) ·
  [documentation#957](https://github.com/KittyCAD/documentation/issues/957) (FN-013).

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

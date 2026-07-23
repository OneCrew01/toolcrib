# ToolCRIB backlog — night-team optional work

Two additive feature specs, ready to execute **only if there is genuine idle time
after the core submission is green**. The submission scope is frozen. Nothing here is
required to place; these are upside, not commitments.

## Rules of engagement (read before touching anything)

1. **Additive and optional.** The core scope is locked. Pick these up only when the
   `CURRENT_STATE.md` operator queue is clear and all five win conditions
   (`docs/` + the win-conditions gate) are green with real idle time to spare.
2. **New files only.** Do **not** modify `server/pipeline/`, `server/state/`,
   `server/package/`, the existing `flushmount*` generators, `server/index.mjs`, or the
   `npm run demo` path. If an item would require touching the core loop, **stop** and
   leave a note here for the operator. Adding a *new* generator that the demo does not
   call is fine; changing the demo is not.
3. **Reproducibility is non-negotiable (win condition #1).** `git clone && npm run demo`
   must stay green and `npm test` must stay 100%. Add tests; never weaken or skip an
   existing one to make room.
4. **Match the repo pattern.** Each feature ships as
   `server/generators/<name>.mjs` + `server/generators/<name>-validate.mjs` +
   `server/generators/<name>.test.mjs`, deterministic and arithmetic-gated,
   **fail-closed** like `flushmount.mjs` / the `server/reference/` modules
   (`UnverifiedRuleError` pattern). Reuse the mass/bbox gate and `ws-helpers.mjs`;
   do not re-invent them.
5. **Definition of done, per item:** generator + validation gate + tests (all green)
   + at least one sample bundle under `samples/` + a field note or README line + a
   `CURRENT_STATE.md` entry. If you cannot complete the whole DoD in the window, commit
   only the finished files (behind their own paths, demo untouched) and record the
   remainder in this README. Never leave the trunk half-built.
6. **Priority order:** **BL-001 first** (ship candidate — cheap, deterministic,
   demo-ready). **BL-002 second** (experimental / roadmap — ship the convention even if
   the full feature doesn't land).
7. **Commit convention:** `feat(backlog): <item> — <what landed>`, one item per commit,
   push only when green.

## The one-line frame (for the README, if either lands)

Both items are the **same product, extended** — a deterministic intent layer in front
of generation. BL-001 declares a feature **once across the ends that must line up**;
BL-002 declares a feature **by color instead of prose**. Both kill prose-drift
(FN-018/FN-020); both are proven by measurement. Present them as "the intent layer,
extended," never as two new products.

## Items

| ID | Title | Status | Priority |
|---|---|---|---|
| [BL-001](./BL-001-uniform-symmetric-apply.md) | Uniform / symmetric apply — one definition across aligned ends | ready · not started | 1 (ship candidate) |
| [BL-002](./BL-002-color-as-operation.md) | Color as the operation — "paint the op" | ready · not started | 2 (experimental) |
| [BL-003](./BL-003-burn-cert-reference.md) | Burn-cert reference — design-for-flammability + min-wall gate + print recipe | **LANDED 07-23** (17 tests; pass/fail sample pair; BC rows PENDING operator) | released |
| [BL-004](./BL-004-weight-and-balance.md) | Assembly weight & balance — mass-weighted CG gate | **LANDED 07-23** (12 tests via `node --test "server/wb/*.test.mjs"`; FN-029 frame trap found) | released |

*BL-003/004 released early by explicit operator call (2026-07-23): build now IF the
engineering rules above hold (new files only, demo untouched, suite green). BL-001/002
remain frozen-until-idle.*

*Origin: operator ideas, 2026-07-23 — both born from real panel-fab friction. Filed for
the night team; operator scope stays frozen.*

# ToolCRIB

**Say the joint. Get the joint.**

ToolCRIB is an open-source **trust layer for AI-generated CAD**, built on the
[Zoo.dev](https://zoo.dev) APIs for the Zoo API Makeathon (July 22 – August 5, 2026).

## The problem

Modern text-to-CAD is remarkable at *shapes* and still hard to trust for *features that
fasten things together*. Joints, bolt patterns, holes, countersinks, flush mounting —
these are native, first-class operations in a real CAD kernel, but they are the exact
places where a prompt-to-mesh tool quietly gets it wrong: an edge distance too tight, a
countersink angle nobody specified, a hole pattern that drifted. If those features were
as easy to **say** as they are to model, AI CAD would be a manufacturing tool instead of
a demo.

ToolCRIB attacks that gap two ways:

1. **A codified fastening reference.** Machine-readable rules and tables for holes,
   fasteners, edge distances, and flush mounting, derived from public-domain FAA
   acceptable-practice data (AC 43.13-1B) — the kind of shop knowledge that normally
   lives in a dog-eared binder, exposed as a typed backend reference any generator can
   consult, with every value carrying its source citation.
2. **A traceable generate → validate → document → revise loop.** Intent goes in; Zoo's
   Agent API drafts editable parametric CAD (KCL, not a dead mesh); Zoo's Engine API
   executes and *validates* it (mass properties, geometry checks); Zoo's File Format API
   exports STL/STEP; and the output ships as a documented package a stranger could
   pick up, reproduce, and remix — with a human approval gate before anything is made.

The demo part is small on purpose. The pattern is the product.

## Zoo API usage (verified as we go — nothing claimed that hasn't run)

| Capability | Status | Notes |
|---|---|---|
| Bearer-token auth (`GET /user`) | ✅ verified 2026-07-22 | `Authorization: Bearer <token>` |
| Text-to-CAD (`POST /ai/text-to-cad/{format}?kcl=true`) | ✅ verified 2026-07-22 | async; returns constraint-based, parametric KCL 2.0 — genuinely editable |
| STEP export | ✅ verified 2026-07-22 | via `/async/operations/{id}` outputs (see FN-007); glTF preview comes free |
| Engine mass/volume validation (`/file/mass`) | ✅ verified 2026-07-22 | API mass matched hand calc to 0.02% (FN-008) |
| Agent copilot session (`/ws/ml/copilot`) | ✅ verified 2026-07-23 | full agent round-trip in 49 s: KCL gen → lint → execute → snapshot → analysis (FN-026..028) |
| Engine modeling commands (websocket) | ✅ verified 2026-07-22 | post-upgrade `headers` auth (FN-013); ~50 ms round-trips (FN-014) |
| Engine bounding box | ✅ verified 2026-07-22 | cube → exact dims via `bounding_box` (FN-015); null for imported objects (FN-022) |
| DXF export (`export2d`) | ✅ verified 2026-07-22 | real AC1014 ASCII DXF in ~54 ms (FN-016) |
| Render/preview PNG | ✅ verified 2026-07-23 | import → `zoom_to_fit` → `take_snapshot`, ~2.5 s (FN-022) |
| Round-trip re-import of own exports | ❌ broken | `internal_engine: import failed`; glTF fixable by stripping Zoo's own extension (FN-023) |

Running findings, bugs, and doc gaps are logged in
[`docs/API_FIELD_NOTES.md`](docs/API_FIELD_NOTES.md).

## The first tool: say the joint, get the joint

`server/generators/flushmount.mjs` generates a **flush-mount pair** — panel with a
chamfered opening plus the insert that sits flush in it — from a parameter spec:
clearance per side (backed by the fit-rule table), 45° lead-in chamfers sized
`≥ 2 × clearance`, optional rear registration lip, each part in its own color so the
fit reads visually. Output is remixer-friendly KCL 2.0: your numbers are named
constants, every derived dimension carries its formula as a comment, and the
generator refuses to emit geometry that violates its own arithmetic gates. Printable
fit-coupon sets at four clearances live in `samples/flush-mount/coupons/`.

Why deterministic generation instead of prompting? Campaign C003 (FN-020): text-to-cad
*can* build this pair — when the prompt pre-chews the engineering. Phrase it like a
machinist ("0.3 mm total clearance") and it fails outright; phrase it casually and you
get silently different geometry — with no API signal telling you which you got.

## The reliability harness (the night shift)

Because a `completed` status is not proof of correct geometry (FN-006: the same
fastening prompt failed 2 of 3 runs), this repo measures instead of assumes. A
**campaign** is a designed grid of prompts — one question, N identical repeats per
case, every completed output pushed through the mass-validation gate:

```bash
npm run campaign -- c001-fastening-reliability --dry   # show the plan (free)
npm run campaign -- c001-fastening-reliability         # run it (backgroundable)
```

Each run writes a `ledger.jsonl` (one line per generation), per-run KCL, and a
`summary.md` with pass rates, latency spread, and spend — including the category the
status field cannot see: **completed_invalid**, where Zoo said done but the geometry
is wrong. Add your own experiment by copying
[`server/harness/campaigns/_template.mjs`](server/harness/campaigns/_template.mjs);
the runner, budget cap, and stats come free.

## Status

Built entirely inside the contest window — every line of code and every
measurement. See [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md) for what works
right now and when it landed.

## Setup

```bash
git clone <this repo>
cd toolcrib
npm run demo   # full loop, zero network, zero API minutes, no install step
```

`npm run demo` walks one real request through the entire machine — validation →
cited reference consult → generation (replayed from real prior Zoo outputs) →
measured geometry gates → a hash-sealed job package (CAD source, STL/STEP,
engine-rendered preview, validation report, 13-section manufacturing PDF, tamper-
evident manifest) — and parks it at the human-review gate with the full transition
ledger printed and verified. No token needed, and nothing to install: every import
under `server/` is a `node:` builtin, so the demo has zero npm dependencies and runs
against an empty `node_modules`. (Node versions below.)

Count the bundle directory and you get **12 files, 11 of them sealed**: `manifest.json`
hashes the 10 artifacts beside it (`manifest.files`) into one recomputable
`packageHash`, and is the eleventh file. The twelfth is `notifications.log` — the
parked-for-review line, appended *after* the seal by `server/pipeline/run-job.mjs`, so
it is deliberately outside the hash and is not a manifest entry. Nothing inside the
seal can change without `dodCheck` catching it.

With a Zoo token in `.env` (`cp .env.example .env`), the same pipeline runs live:

```bash
TOOLCRIB_ALLOW_LIVE=1 node server/pipeline/run-job.mjs samples/requests/plain-plate.json --backend=live
```

## Run the review console

The console is the one part of this repo that *does* have dependencies, so it gets one
install of its own — the demo above stays install-free either way:

```bash
npm --prefix app install     # console deps (React + Vite); the demo needs none of this
npm start                    # API on :8787 — the only server process that holds a Zoo token
npm --prefix app run dev     # console on :5173, dev proxy to the API
```

Open `http://localhost:5173`. The job list reads the same flat-file data directory
the CLI writes, so `npm run demo` and `npm run job` runs already show up before you
create anything new. Job detail is the transition ledger as centerpiece — every row
hash-chained, with a "ledger verified ✓ (hash chain intact)" badge (or a loud failure
if a row was ever tampered with) — followed by gate cards (threshold vs. measured,
per gate), the package panel (every file with its own sha256 and a download link,
plus the full packageHash), and, once a job reaches the human-review gate, a review
bar that requires a named human before Approve or Request revision does anything.

## Node versions (declared floor, and the one we actually ran)

The two halves of this repo do not share a floor, so they are stated separately —
and separately from the version this build has been executed on, which is the only
number here that comes from a run rather than a manifest.

| | Declared floor | Where that number comes from |
|---|---|---|
| `npm run demo` + `npm test` | `>=22.6` | `package.json` `engines`; set by the `--experimental-strip-types` step `npm test` uses for the console self-checks |
| `npm --prefix app run dev` / `run build` | `^20.19.0 \|\| >=22.12.0` | Vite's own `engines`, read off the installed `vite@8.1.5` |

**Executed:** `npm test` (0 failures), `npm run demo` (exit 0, `ledger verify: OK`),
and `npm --prefix app run build` (clean) all ran on **Node 24.16.0**. That is the
runtime this build is verified on. Older runtimes are untested here — including the
two declared floors above, which are declarations, not measurements. If you need a
lower floor confirmed, run it and tell us; we won't claim a version we haven't
executed.

Note the gap the two rows create: Node 22.6–22.11 satisfies `engines` and runs the
test suite, but sits below Vite's 22.12 cutoff, so it will not run the console.

## Drafting with Zookeeper (operator mode)

The console's second tab is a natural-language drafting chat with **Zookeeper**,
Zoo's ML copilot, over its websocket (`wss://api.zoo.dev/ws/ml/copilot`). Describe
a part in prose, watch the copilot reason and draft KCL live, then push a finished
turn into the New Job form as design intent — the reviewed pipeline underneath
(gates, ledger, human sign-off) is exactly the same pipeline this panel feeds.

The token boundary is doctrine, not an implementation detail. **The token is entered
at runtime, held in memory only, and talks from your browser straight to Zoo — wiped
the moment you disconnect.** That part is in the code: `app/src/lib/zookeeper.ts`
sends it once in the auth frame and clears its copy immediately. The ToolCRIB backend
has zero involvement in this path — there is no proxy, and we refused to build one on
purpose: a proxy would let anonymous visitors run billable agent sessions under our
identity, which breaks the per-session metering honesty (`api_call_id` = one Zoo API
call per turn) the rest of this repo is built around.

**Hosting policy, stated as policy.** This console is not hosted anywhere today — the
repo carries no deploy configuration of any kind — and the rule for if it ever is: a
public deployment stays replay-only, with no token field and no live sessions. Only a
local operator run connects a browser to Zoo. Be clear about the status of that rule:
it is an operator commitment, **not** something the build enforces. There is no
production guard on the Zookeeper panel and no build flag that strips it, so a naive
`npm --prefix app run build` ships the token field. Anyone who hosts this is the one
enforcing the policy, and wiring a real gate is the prerequisite for doing so.

## Beyond fastening: the same pattern, two more domains

Two additive backlog items (`docs/backlog/BL-003`, `BL-004`) point the same
trust-layer pattern — cited rule, deterministic gate, honest disclaimer — at two
more aviation-adjacent problems. **Design-for-flammability** (`server/reference/
tables/burn-cert.mjs`, `server/generators/burncert-validate.mjs`) codifies FAA
TC TN23-65 / UL-94 wall-thickness findings as a sampled min-wall gate over an STL
(ray-cast local thickness, float32-aware); `server/generators/burncert-recipe.mjs`
(`printRecipe`) emits the print recipe for the half the CAD can't enforce —
material, minimum infill, orientation. Nothing here
certifies anything: real certification is a physical coupon in a burn chamber per
14 CFR 25.853, and every rule ships watermarked accordingly. Sample pass/fail pair
in [`samples/burn-cert/`](samples/burn-cert/). **Assembly weight & balance**
(`server/wb/`) computes a mass-weighted combined CG across an assembly's parts,
labels each part's mass basis as `modeled` or `measured` (a kitchen-scale reading
overrides the modeled value and the report says which one it used), and arms a
fail-closed CG-window gate — `CgWindowError` refuses the package outright when the
combined CG lands outside the declared window. Sample pass/fail pair in
[`samples/wb-demo/`](samples/wb-demo/).

## Safety note

Outputs are advisory fabrication aids. Nothing this tool produces is approved data for
aircraft repair; determinations of airworthiness stay with certificated humans.

## License

MIT — see [LICENSE](LICENSE).

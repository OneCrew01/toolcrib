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

Day 1 of the build window. This repository was initialized inside the contest window and
everything in it was written inside the window. See
[`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md) for what works right now.

## Setup

```bash
git clone <this repo>
cd toolcrib
npm run demo   # full loop, zero network, zero API minutes, no install step
```

`npm run demo` walks one real request through the entire machine — validation →
cited reference consult → generation (replayed from real prior Zoo outputs) →
measured geometry gates → a hash-sealed 11-file job package (CAD source, STL/STEP,
engine-rendered preview, validation report, 13-section manufacturing PDF, tamper-
evident manifest) — and parks it at the human-review gate with the full transition
ledger printed and verified. No token needed; no dependencies beyond Node 18+.

With a Zoo token in `.env` (`cp .env.example .env`), the same pipeline runs live:

```bash
TOOLCRIB_ALLOW_LIVE=1 node server/pipeline/run-job.mjs samples/requests/plain-plate.json --backend=live
```

## Safety note

Outputs are advisory fabrication aids. Nothing this tool produces is approved data for
aircraft repair; determinations of airworthiness stay with certificated humans.

## License

MIT — see [LICENSE](LICENSE).

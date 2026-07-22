# API Field Notes

Real observations from building against the Zoo API. Every entry reproduced before it
was written down. Format per entry: what the docs implied, what actually happened,
minimal repro, suggested fix.

---

## FN-001 · Auth + user endpoint — clean
- **API:** platform · `GET https://api.zoo.dev/user`
- **Date:** 2026-07-22
- **Type:** pleasant-surprise
- **Expected:** bearer-token auth per docs.
- **Actual:** `Authorization: Bearer <token>` → 200 with user record. No surprises.
- **Repro:** `curl -H "Authorization: Bearer $ZOO_API_TOKEN" https://api.zoo.dev/user`

## FN-002 · Root path serves the full OpenAPI spec
- **API:** platform · `GET https://api.zoo.dev/`
- **Date:** 2026-07-22
- **Type:** pleasant-surprise / doc-gap
- **Expected:** docs point at a docs site; spec location not prominent.
- **Actual:** the API root returns the complete OpenAPI document (~1.18 MB). Excellent
  for codegen and capability discovery; deserves a louder mention in the getting-started
  docs.
- **Suggested doc edit:** add "the root of api.zoo.dev serves the OpenAPI spec" to the
  developer-tools landing page.

## FN-003 · Credits vocabulary vs. contest vocabulary
- **API:** billing · `GET /user/payment/balance`
- **Date:** 2026-07-22
- **Type:** doc-gap
- **Expected:** the makeathon announcement speaks of "10,000 free API minutes."
- **Actual:** the balance payload speaks of *credits* (`stable_api_credits_remaining`,
  monetary value). No line item is labeled as the makeathon grant, so an entrant can't
  tell from the API whether the contest grant landed. (This account shows a healthy
  stable-credit balance, so building continues; the mapping of minutes→credits is the
  open question.)
- **Suggested fix:** balance response (or the contest FAQ) should name grants explicitly.
- **Update (same day):** the contest page says eligible registrants "will receive 10,000
  minutes of API access" *automatically*, and to email makeathon@zoo.dev for top-offs.
  So the grant likely IS the stable-credit balance — but nothing in
  `GET /user/payment/balance` identifies it as such, which is the gap: an entrant cannot
  programmatically confirm their grant landed or meter their remaining contest budget in
  the contest's own vocabulary (minutes).

## FN-004 · STEP is a first-class export; DXF lives on a different path
- **API:** File Format · schema `FileExportFormat`, `OutputFormat2d`
- **Date:** 2026-07-22
- **Type:** doc-gap
- **Expected:** one export enum covering the formats a shop needs.
- **Actual:** `FileExportFormat` = `fbx, glb, gltf, obj, ply, step, stl` — STEP ✅. DXF is
  *not* in that enum; it exists as `OutputFormat2d` (type `dxf`, ascii/binary storage)
  reachable through the modeling/engine 2D-export path, not `/file/conversion`.
- **Impact:** anyone hunting "DXF export" in the conversion endpoint concludes it doesn't
  exist. It does — it's just a 2D concern on a different surface.
- **Suggested doc edit:** cross-link DXF/`OutputFormat2d` from the file-conversion docs.

## FN-005 · Text-to-CAD latency varies ~100x with prompt complexity
- **API:** Agent/ML · `POST /ai/text-to-cad/step?kcl=true`
- **Date:** 2026-07-22
- **Type:** rough-edge (UX planning input)
- **Expected:** seconds — a prior trivial-solid prompt (single chess pawn revolve)
  completed in ~5 s.
- **Actual:** a fastening-feature prompt (50×50×2 mm plate, four corner holes at fixed
  edge distance, 100° countersinks for flush flat-head screws) sat `queued` →
  `in_progress` for **8 min 10 s** — and then failed (see FN-006).
- **Impact:** any UI that blocks on generation is unusable for real fastening features;
  async background execution with notify is a requirement, not a nicety.
- **Repro:** POST the prompt above; poll `GET /user/text-to-cad/{id}`.
- **Update (same day):** variance is not only prompt complexity — the *identical*
  plain-holes prompt completed in **113.9 s** and then **716.3 s** on a second run
  (ids `86102d0e…`, `550e91fc…`). Same input, ~6× spread; plan for queue/load jitter.
- **Bonus observations:** requesting `stl` returned STEP + STL + glTF together (the
  bundle appears format-agnostic), and both generations — despite different KCL text
  (2436 vs 2469 chars) — measured mass-identical to 15 decimals via `/file/mass`,
  suggesting deterministic geometry for equivalent prompts.
- **Update 2 (2026-07-22, independent re-verify):** the FN-006 countersink prompt —
  previously only observed failing — **completed in 155.8 s** on a fresh run
  (id `289cec14-f654-4afe-92dc-734c63e52896`, `server/verify-countersink.mjs`). Third
  data point on the same fastening feature class; latency now spans ~156 s (pass) to
  ~490 s (fail-timeout) for near-identical prompts. Variance is the rule — async-first confirmed.

## FN-006 · Fastening-feature generation is non-deterministic — same prompt fails ~2/3, and the failed hop leaks internal cluster DNS
- **API:** Agent/ML · `POST /ai/text-to-cad/step?kcl=true`
- **Date:** 2026-07-22 · **3 runs total: 2 failed, 1 passed** (ids below)
- **Type:** bug (reliability) + bug (error hygiene)
- **Expected:** a moderately-constrained fastening prompt (four positioned 100°
  countersunk holes) either generates geometry or returns a domain error —
  *deterministically*.
- **Actual:** the *identical* prompt is non-deterministic across runs:
  - `5f98c1c2-c670-4f5d-83c8-c56a4b308ba7` — **failed** after 8 m 10 s in `in_progress`
  - `74f6f311-a782-436a-98ac-c14cd17707bc` — **failed** after ~8 min, same error
  - `289cec14-f654-4afe-92dc-734c63e52896` — **completed in 155.8 s**, geometry correct (FN-010)
  On both failures, status flips to `failed` with:
  `Text-to-CAD server: Communication Error: error sending request for url
  (http://text-to-kcl.text-to-kcl.svc.cluster.local:8080/text-to-cad)`
- **Bug 1 — reliability (recharacterized):** *not* a deterministic failure. The same
  fastening prompt fails roughly 2 of 3 times on an ~8-min internal-hop timeout and
  succeeds the rest. For the exact feature class text-to-CAD must win to be a shop tool,
  a single generation cannot be trusted — retries and, more importantly, output
  verification are mandatory.
- **Bug 2 — hygiene:** the error string leaks internal Kubernetes service DNS
  (`*.svc.cluster.local:8080`) to the end user. Should be a request id + a clean message.
- **Repro:** failure 2/2 on the first two ids; success on independent re-run id 3
  (`server/verify-countersink.mjs`). Net **2/3 fail** — non-deterministic.
- **Suggested fix:** map internal transport errors to an opaque code; retry the internal
  hop server-side; surface best-effort KCL when the model produced code before the hop failed.
- **Why this is the thesis:** a `completed` status is not trustworthy and a `failed`
  status is not reproducible — you cannot tell from Zoo's response alone whether you got a
  correct part. That gap is exactly what a validation layer closes (FN-010).

## FN-007 · `outputs` only exists on the async-operations surface (and it's unpadded base64)
- **API:** Agent/ML · `GET /user/text-to-cad/{id}` vs `GET /async/operations/{id}`
- **Date:** 2026-07-22 (id `86102d0e-ccbf-40bd-a60e-3bc79e38cfd2`)
- **Type:** doc-gap / API asymmetry
- **Expected:** the completed text-to-cad record returns the exported files you asked
  for (`output_format=step`).
- **Actual:** `GET /user/text-to-cad/{id}` returns `code` but **no `outputs` field at
  all**. The same id via `GET /async/operations/{id}` returns full `outputs`
  (`source.step`, `source.gltf`). Nothing in the response hints the files live on the
  other surface.
- **Also:** output values are **unpadded** base64 (length ≢ 0 mod 4). Node's lenient
  `Buffer.from(b64, "base64")` accepts it; strict decoders (.NET, some Python paths)
  throw "invalid length" until you re-pad.
- **Impact:** a developer polling the documented user record concludes exports are
  broken; we did, for about ten minutes.
- **Suggested fix:** include `outputs` on the user record (or document the split), and
  pad the base64 (or document that it's unpadded).
- **Nice find en route:** requesting `step` also returned `source.gltf` free — a ready
  in-browser preview asset.

## FN-008 · Engine REST validation closes the loop with 0.02% agreement
- **API:** Engine (REST) · `POST /file/mass?...&src_format=step`
- **Date:** 2026-07-22
- **Type:** pleasant-surprise
- **Actual:** uploaded the generated STEP with aluminum density (2700 kg/m³):
  API mass = **13.0786 g**; first-principles hand calc for a 50×50×2 plate minus four
  Ø5 mm through-holes = **13.077 g**. Agreement to ~0.02% — i.e., the four holes truly
  exist in the exported geometry, provable from a single number, no websocket needed.
- **Impact:** REST-only validation (`/file/mass`, `/file/volume`,
  `/file/center-of-mass`) is enough for a meaningful trust gate on day 1.

## FN-009 · Modeling websocket upgrade succeeds with NO auth — 101 ≠ authenticated
- **API:** Engine · `GET /ws/modeling/commands?webrtc=false` (upgrade handshake)
- **Date:** 2026-07-22 · repro: `server/probe-ws-engine.mjs`
- **Type:** rough-edge / doc-gap (client-safety relevant)
- **Expected:** unauthenticated upgrade rejected with 401 at the handshake.
- **Actual:** the upgrade returns **101 Switching Protocols for all three variants** —
  `Authorization: Bearer` header, `?token=` query param, and **no credentials at all**.
  Auth is evidently enforced after the upgrade (first message / server-side close).
- **Impact:** a client cannot treat a successful upgrade as proof its token is valid;
  health checks and connection pools built on "did we get 101" will lie. Also relevant:
  Node's standard `WebSocket` API cannot send an `Authorization` header, so knowing the
  post-upgrade auth contract (and whether `?token=` is officially supported) matters for
  zero-dependency clients. Follow-up queued for office hours (kit Q7 area).
- **Suggested doc edit:** state where auth is enforced for websocket surfaces and which
  credential carriers are supported.

---

## Day-1 capability matrix (per the pre-window checklist)

| Capability | Verified? | How | Notes / fallback |
|---|---|---|---|
| Auth works | ✅ | `GET /user` → 200 | FN-001 |
| Contest grant active | ◐ | `GET /user/payment/balance` | ~$5k stable credits live; grant unlabeled (FN-003), confirm at office hours |
| Text-to-CAD → editable KCL | ✅ | `POST /ai/text-to-cad/step?kcl=true` | constraint-based KCL 2.0, parametric (samples/plain-plate) |
| Fastening-feature prompts | ❌ **fails** | countersink prompt | 2/2 failures + internal URL leak (FN-006) — the product thesis |
| Streaming / iteration | ☐ | — | `/ml/text-to-cad/iteration` + `/ws/ml/copilot` unexercised |
| Concurrent Agent sessions | ☐ | — | office-hours Q3 |
| Engine execute KCL (websocket) | ◐ | handshake only | 101 for all auth variants (FN-009); protocol spike = Day 2–3 |
| Engine mass/volume/CoM | ✅ | `POST /file/mass` (REST) | 0.02% agreement vs hand calc (FN-008) |
| Engine bounding box | ☐ | — | no REST endpoint found; office-hours Q6; fallback = compute from mesh |
| Render/preview | ◐ | free glTF in outputs | client-side render viable (FN-007); API-side render unexercised |
| Export STL | ✅ | `TOOLCRIB_FORMAT=stl npm run demo` | samples/plain-plate-stl |
| Export STEP | ✅ | via `/async/operations/{id}` | FN-007 (surface split, unpadded base64) |
| Export DXF | ☐ | — | `OutputFormat2d` on modeling websocket only (FN-004) |
| TS SDK auth | ➖ skipped by design | — | zero-dependency client (D-003); raw REST verified instead |

Legend: ✅ verified · ◐ partial · ☐ not yet run · ➖ deliberately skipped · ❌ verified failure


## FN-010 · A "completed" text-to-CAD result is not trustworthy on its own — mass validation proves feature presence
- **API:** Agent/ML `GET /async/operations/{id}` + Engine `POST /file/mass` · repro `server/verify-mass.mjs`
- **Date:** 2026-07-22 · id `289cec14-f654-4afe-92dc-734c63e52896`
- **Type:** pleasant-surprise / thesis-defining
- **Context:** the one countersink run that succeeded (FN-006) returned `status: completed`
  with a STEP export. "Completed" says nothing about whether the four 100° countersinks
  the prompt asked for actually exist in the geometry.
- **Verification — two independent signals:**
  1. KCL grew to **3,878 chars** (vs 2,469 for the plain-holes plate) and carries explicit
     `countersink` / `cone` / `revolve` feature code.
  2. `/file/mass` on the STEP (aluminum, 2700 kg/m³) = **12.717 g** vs the plain-holes
     baseline **13.0786 g** (FN-008). The **0.362 g (2.8%)** deficit is quantitatively
     consistent with four 100° countersinks removing material — the feature is genuinely
     present, provable from one number.
- **Impact — this is the whole product in one data point:** the same single-number check
  that confirms a real feature here would **catch a silent omission** — a "completed" plate
  with the countersinks dropped would weigh ~13.08 g, not ~12.72 g. Trust does not come from
  the API's status field; it comes from deterministic post-generation validation. That is ToolCRIB.

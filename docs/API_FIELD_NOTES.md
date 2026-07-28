# API Field Notes

Real observations from building against the Zoo API. Every entry reproduced before it
was written down. Format per entry: what the docs implied, what actually happened,
minimal repro, suggested fix. Findings that touch a documented surface cite the exact
Zoo doc page they confirm, contradict, or fill — inline where it matters most and in the
**Zoo documentation cross-reference** table at the end. Every cited doc URL was loaded
and confirmed to resolve before it was written down.

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
> **Filed upstream:** https://github.com/KittyCAD/modeling-api/issues/1291
> **Zoo docs — contradicts:** [POST /ai/text-to-cad/{output_format}](https://zoo.dev/docs/developer-tools/api/ml/generate-a-cad-model-from-text) documents a clean `queued → in_progress → completed/failed` lifecycle; it does not disclose that the same prompt is non-deterministic across runs or that a `failed` status can carry an internal-transport error string.
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
- **Update (campaign c001, same day):** the same countersink prompt went **6/6
  completed** in the overnight campaign window. Combined with the morning's 2/3
  failures, the failure mode is load/time-dependent infrastructure, not the prompt —
  which makes single-shot trust *worse*: the same request can fail, succeed, or
  succeed-without-retrievable-outputs (FN-011) depending on when and how it's sent.

## FN-011 · Burst-dispatched jobs complete — but their outputs are permanently unreachable
> **Filed upstream:** https://github.com/KittyCAD/modeling-api/issues/1292 (with the dedupe root cause below)
- **API:** Agent/ML · `POST /ai/text-to-cad/*` + `GET /async/operations/{id}`
- **Date:** 2026-07-22, campaign c001 (24 of 30 runs affected; ids in
  `server/harness/results/c001-fastening-reliability/2026-07-22-09-50/ledger.jsonl`)
- **Type:** bug (severe — data loss from the caller's perspective)
- **Expected:** dispatch returns an id; that id resolves on the async-operations
  surface, which is the only surface carrying `outputs` (FN-007).
- **Actual:** when jobs are dispatched in rapid succession (2 workers, ~1–2 s between
  dispatches), `/async/operations/{id}` returns **404 — and keeps returning 404 an hour
  later** — while `/user/text-to-cad/{id}` shows the same id `completed` with full KCL.
  Since the user surface never carries `outputs` (FN-007), the exported STEP/glTF of a
  completed, billed generation is unreachable through any surface we can find. Jobs
  dispatched immediately after a *completed* generation (rather than after another
  dispatch) resolved normally — 6 of 6 such runs polled fine. Pattern held across all
  5 prompt classes.
- **Impact:** any client doing concurrent generation loses every output file; the only
  recovery is the KCL from the user record. Combined with FN-007 this means the outputs
  contract is: *sometimes on one undocumented surface, sometimes nowhere*.
- **Suggested fix:** carry `outputs` (or output URLs) on `/user/text-to-cad/{id}`, or
  guarantee the async-operations record exists for every accepted job, or provide a
  re-export endpoint for a completed job id.
- **ROOT CAUSE REFRAMED (2026-07-22, campaign c002):** the trigger is not burst
  dispatch — it's **prompt-level deduplication**. Evidence: re-dispatching an
  already-generated prompt returns `completed` **instantly** (first status poll,
  latency ~0 s) with the cached KCL; every such instant-complete has no
  async-operations record and therefore no reachable outputs. Novel prompts run real
  (150–270 s) and their outputs resolve; identical prompts running *concurrently*
  (dispatched before either completes) both run real. C001's pattern re-reads
  perfectly under this lens: reused prompts deduped 6/6, novel prompts ran exactly
  2 real (one per worker) then deduped the rest — matching the observed KCL variant
  counts. Dedupe itself is a sensible optimization; the bug is that **dedupe hits are
  completed jobs whose outputs are unreachable through any documented surface**.

## FN-012 · Economics + determinism: $0.17/generation avg; identical prompts → near-identical programs
- **API:** Agent/ML + billing · campaign c001 (30 generations, 6 mass checks, ~40 polls)
- **Date:** 2026-07-22
- **Type:** pleasant-surprise / metering data
- **Cost:** balance delta **$5.10 for the whole campaign** → ~**$0.170/generation**
  average (mass checks and polling appear ~free). At this rate the ~$5k grant funds
  ~29,000 generations — budget is not a constraint; API reliability is.
- **Determinism:** cases a and b produced **byte-count-identical KCL across all 6
  runs** (2436 and 4804 chars); cases c/d/e produced exactly **two codegen variants
  each** across 6 runs, and where we could measure, variants converged to identical
  mass (12.6033 g / 10.1679 g / 16.4266 g — matching analytic values to ~0.02%).
- **Method implication:** repeating an *identical* prompt mostly measures Zoo's
  infrastructure, not the model. Future campaigns should vary *phrasing* within a
  feature class to measure model robustness (planned for c002).

## FN-013 · Websocket auth: `?token=` is silently ignored — auth is a post-upgrade JSON frame
> **Filed upstream:** https://github.com/KittyCAD/documentation/issues/957 (docs PR offered)
- **API:** Engine · `wss://api.zoo.dev/ws/modeling/commands`
- **Date:** 2026-07-22 · repro: `server/spikes/ws-modeling-spike.mjs --rung=1`
- **Type:** doc-gap (client-breaking for non-browser clients)
- **Actual:** the 101 upgrade succeeds with any or no auth (FN-009), and `?token=<tok>`
  changes nothing: the server nags `auth_token_missing` once per second — the nag text
  itself documents the real protocol — then hard-drops the socket (1006, no close
  frame) at ~4–5 s. Authentication is the `headers` variant of `WebSocketRequest`:
  send `{"type":"headers","headers":{"Authorization":"Bearer <tok>"}}` immediately
  after open; success is `modeling_session_data` (with a traceable `api_call_id`)
  ~290 ms later. One nag always races in before the auth frame processes — clients
  must not treat it as fatal.
- **Why it matters:** the standard browser/Node `WebSocket` API cannot send an
  `Authorization` header, so the query param is the natural first guess — and nothing
  in the docs says it's a no-op.
- **Suggested doc edit:** state the post-upgrade auth frame explicitly in the
  websocket docs; consider rejecting unknown auth query params loudly.

## FN-014 · Modeling protocol: uuid-correlated JSON frames, ~50 ms round-trips
- **API:** Engine websocket · **Date:** 2026-07-22 · repro: spike `--rung=2`
- **Type:** pleasant-surprise / protocol notes
- Envelope: `{"type":"modeling_cmd_req","cmd":{...},"cmd_id":"<uuid>"}` →
  `{"success":true,"request_id":"<same uuid>","resp":{"type":"modeling","data":
  {"modeling_response":{...}}}}`. Every command acked in 47–75 ms — four orders of
  magnitude faster than text-to-cad (FN-005). Unsolicited `metrics_request` arrives
  every ~10 s (ignorable; empty metrics response is schema-valid). No keepalive needed
  ≤ 25 s idle. Quirk: client `close(1000)` is always reported back as 1006 — the server
  aborts TCP rather than completing the close handshake; don't alarm on it.

## FN-015 · Engine bounding box verified: 7 commands → exact cube dimensions
- **API:** Engine websocket · **Date:** 2026-07-22 · repro: spike `--rung=3` (×3 sessions)
- **Type:** capability verified
- `start_path` → `move_path_pen` → 3× `extend_path` → `close_path` → `extrude(10)` →
  `bounding_box` (`entity_ids: []` = whole scene) returns center (5,5,5), dimensions
  (10,10,10) mm — exact, in ~450 ms total. Raw coordinates default to mm. Notes:
  `close_path` takes `path_id` (not `path`) and returns a `face_id`. This closes the
  printer-envelope-check capability row: a live sub-second geometry oracle.

## FN-016 · The buried DXF path works: `export2d` → real AC1014 DXF in 54 ms
- **API:** Engine websocket · **Date:** 2026-07-22 · repro: spike `--rung=4`
- **Type:** capability verified + doc-gap
- `export2d` with `format:{type:"dxf",storage:"ascii"}` on a closed sketch returns
  `output.dxf`: 4,644 bytes of valid ASCII DXF (AC1014, one LINE entity per segment,
  correct coordinates). The spec says exported RawFiles come back "as binary/bson";
  observed reality is base64 strings inside ordinary JSON text frames (cf. FN-007's
  base64 habit). Export does not terminate the session.
- **Suggested doc edit:** document `export2d` from the file-conversion/DXF angle —
  nothing today routes a "how do I get DXF?" reader to this command.

## FN-017 · Metering cracked by arithmetic: 1 credit ≈ 1 API-second; the "$5k balance" IS the 10,000-minute grant
- **API:** billing · **Date:** 2026-07-22, campaigns c001+c002 as instrument
- **Type:** doc-gap resolved (answers FN-003)
- **The math:** subscription reports `pay_as_you_go_api_credit_price: $0.0083`;
  granted balance was 602,214 credits = $4,998.38. 602,214 credits ÷ 60 ≈ **10,036
  minutes** — the contest's "10,000 minutes," delivered as credits. Real generations
  (150–270 s each) bill ≈ their runtime: C002 spent $14.23 across 9 real generations
  (~2,000 API-seconds ≈ $16 predicted; dedupe hits appear ~free). The earlier "$0.17/
  run average" (FN-012) was distorted by unbilled dedupe hits, and the post-C001
  balance drift was the 716 s run settling.
- **Practical rate:** ~$0.50 per generation-minute. Grant ≈ 165 hours of generation.
- **Suggested fix:** the balance endpoint labeling the grant (FN-003) would have made
  this arithmetic unnecessary.

## FN-018 · Phrasing changes the part: 3.6% mass spread across five ways of saying the same geometry
- **API:** Agent/ML · **Date:** 2026-07-22, campaign c002 (20 runs, 9 real generations)
- **Type:** model-robustness measurement (the trust-layer case, quantified)
- **Setup:** one target geometry — 50×50×2 plate, four Ø5 corner holes at 10 mm edge
  distance, 100° flush countersinks — phrased five human ways (formal spec, drawing
  callout, shop vernacular, fastener-first, underspecified).
- **Results (aluminum mass, analytic no-countersink ceiling 13.076 g):**
  drawing-callout 12.6097 ×2 · shop-vernacular **12.6097 and 12.7174** (same words,
  two different parts) · fastener-first 12.3934 ×2 (derives a larger flat-head
  countersink from "M5", systematically more material removed) · underspecified
  **12.6482 and 12.8477** (model picks its own countersink twice, differently).
- **Read:** every one of these is `completed`, plausible, and silently different —
  up to **3.6% mass spread** on nominally identical intent, plus within-phrasing
  nondeterminism on 2 of 4 novel phrasings. Nothing in the API response distinguishes
  them; only downstream validation (mass gate here; edge-distance rules next) can.
- **This is the entry's thesis measured end-to-end:** fastening intent needs a
  deterministic rule layer in front of generation, and a validation gate behind it.

## FN-019 · `/file/execute/{lang}` cannot execute KCL — and currently cannot execute anything
- **API:** platform (litterbox) · `POST /file/execute/{lang}` · **Date:** 2026-07-22
- **Type:** doc-gap + outage observation
- **Actual:** (a) the `lang` path param accepts only `go|python|node` —
  `POST /file/execute/kcl` → 400 `unknown variant 'kcl'`. (b) Control probes with the
  *supported* languages both fail server-side with 500 `Internal` (request ids
  `59c8b1ee…` node, `915ebd98…` python; reproduced; preserved in
  `samples/flush-mount/validation.json`).
- **Impact:** there is no server-side KCL execution on public REST. KCL becomes
  geometry only client-side (Design Studio / kcl compiler) or by hand-compiling to
  modeling-websocket commands. For a tool that emits KCL, that means validation runs
  over the websocket (as ours now does) and STL export of authored KCL needs Design
  Studio in the loop.
- **Ask for Zoo:** is litterbox deprecated or down? A `kcl` variant here (code in →
  executed geometry + exports out) would be the single most useful endpoint for
  library authors.

## FN-020 · Can text-to-cad make a flush-mount pair? Yes — if you do its engineering for it (campaign C003)
- **API:** Agent/ML · **Date:** 2026-07-22 · 7 unique phrasings × 1 run, $13.40
- **Type:** capability measurement (nuanced — and it strengthens the thesis)
- **Setup:** every case asked differently for the same thing: 60 mm panel + separate
  insert, flush front face, 0.15 mm/side clearance, chamfered lead-ins, two colors.
- **The good:** 6/7 completed with plausible mass. Three engineering-literate
  phrasings (fully-specified, assembly-framing, explicit "two separate solids")
  converged on the **identical** mass — 28.9343 g — and the explicit-two-bodies
  result audits line-by-line correct: parametric `insertSize = holeSize − 2 ×
  clearancePerSide`, proper 0.5×45° chamfers on both leading edges, true flush face,
  both colors.
- **The failures live exactly where real users live:** the machinist's fit callout
  ("0.3 mm TOTAL clearance" — requires halving per side) burned **15 minutes and
  failed outright** (FN-006 class); product framing silently dropped the two-color
  requirement; vernacular and underspecified phrasings produced *slightly different*
  parts (28.9753 g, 28.9452 g) — silent geometry drift.
- **The point:** outcome quality tracked prompt-engineering skill, not intent —
  and the API emits no signal separating the perfect results from the drifted ones.
  We only know which is which because we hand-derived expected mass and read the KCL.
  A deterministic generator (`server/generators/flushmount.mjs`) plus a validation
  gate removes both problems: correct by construction, verified by measurement.

## FN-021 · Offline mesh analysis reproduces Engine `/file/mass` to every printed digit
- **API:** Engine (as cross-check) · **Date:** 2026-07-23 · repro: `server/package/stl-analyze.mjs`
- **Type:** pleasant-surprise / architecture input
- A ~60-line zero-dependency STL analyzer (divergence-theorem volume, edge-pairing
  watertightness) over the real Zoo export `samples/plain-plate-stl/source.stl`
  (540 triangles) computes 4,843.9277 mm³ → **13.0786 g** at 2700 kg/m³ — identical
  to Zoo's `/file/mass` (13.078606 g, FN-008) to every printed digit.
- **Consequence:** the geometry/mass gate costs zero API spend once a mesh exists;
  the Engine call becomes a cross-check, not a dependency. The trust layer can audit
  the API with independent math — and does, on every job.

## FN-022 · Render route verified: import → zoom_to_fit → take_snapshot, ~2.5 s per PNG
- **API:** Engine websocket · **Date:** 2026-07-23 · repro: `server/spikes/ws-snapshot-spike.mjs`
- **Type:** capability verified (last open capability row closed)
- One session: `import_files` (or build commands) → `zoom_to_fit {padding:0.2}` →
  `take_snapshot {format:"png"}` → base64 `contents` → valid PNG (`\x89PNG`). Real
  plate render: 42.7 KB PNG in ~2.3 s wall. `import_files` works fine as plain JSON
  text frames at ~450 KB despite the spec's binary/bson note. Caveat: `bounding_box`
  returns null dimensions for *imported* objects (works for path-built solids).
- Every DoD bundle artifact type is now producible: **10** of them (8 required + 2
  optional, `server/package/assemble.mjs`), which with `manifest.json` make the 11 sealed
  files inside a 12-file bundle. *(Correction 2026-07-26 — this line read "all eleven DoD
  bundle artifact types". Eleven is the sealed-**file** count, not the artifact-type
  count: `git show 2a4dcef:server/package/assemble.mjs` shows the DoD list was already
  8+2 on the day this note was filed, so the miscount was in the note, never in the code.
  README and CURRENT_STATE now spell out the same 12-files/11-sealed/10-artifact split.)*

## FN-023 · The engine cannot re-import its own exports
- **API:** Engine websocket `import_files` · **Date:** 2026-07-23 · repro: spike `--fmt step|gltf`
- **Type:** bug (round-trip integrity)
- **Actual:** importing Zoo's own AP242 STEP export of a part fails
  (`internal_engine: import failed` — and sometimes no reply at all, >15 s silent);
  importing Zoo's own glTF export fails the same way — **until you strip Zoo's own
  `KITTYCAD_boundary_representation` extension**, after which the identical mesh
  imports perfectly. GLB repacking does not help; the extension is the trigger.
- **Impact:** any workflow that exports from Zoo and re-imports to Zoo (iteration,
  preview-of-prior-work, remix) breaks out of the box; the fix for glTF is a local
  strip pass, for STEP the workaround is REST `step→obj` conversion then import.
- **Filed upstream:** https://github.com/KittyCAD/modeling-api/issues/1293

## FN-024 · "The Zoo engine cannot handle this 3D subtraction yet" — boolean fails on cut-crossing tools, with absolute-scale sensitivity
- **API:** Engine (KCL executor / modeling booleans) · **Date:** 2026-07-23
- **Type:** bug (engine-side; the error text itself asks for a report)
- **Symptom:** `subtract()` fails with *"The Zoo engine cannot handle this 3D
  subtraction yet. Please report this as an issue."* Deterministic per geometry
  (failing cases reproduced 2–4×; passing cases repeat clean).
- **Minimal repro:** 40×40×3 plate → cut a 20×20 through prism → subtract a wedge
  prism riding the opening's entry edge → dies on the second subtract.
- **Trigger characterization (10-probe matrix):** NOT "second subtract" — a 5-boolean
  chain executes clean when each wedge shaves virgin corners of an uncut extrusion
  (our insert). FAILS when the tool crosses edges/faces created by a prior cut, or
  when a loft cutter carries a coplanar middle-profile seam. **Strangest finding:
  absolute-scale sensitivity — the identical 3-profile loft cutter passes against a
  60×60 blank and fails against a 40×40 blank.** (Text-to-cad's own f4 output only
  executes at f4's exact numbers.)
- **Workaround (shipped in `server/generators/flushmount.mjs`):** decompose into
  simple convex booleans — straight opening prism + separate 2-profile chamfer
  frustum. Executes at every sampled scale (12/12 sample files).
- **Filed upstream:** https://github.com/KittyCAD/modeling-api/issues/1294
- **Zoo docs — fills a gap:** the [`subtract()` standard-library page](https://zoo.dev/docs/kcl-std/functions/std-solid-subtract) documents the boolean as "removes tool solids from base solids" with no stated limitation; it does not warn that the operation can fail on tools that cross prior-cut edges, nor that success is sensitive to the model's absolute scale. A "known limitations" note on that page would have saved the decomposition hunt.

## FN-025 · web-zookeeper: excellent spec, no README, and the package can't be installed as published
- **Surface:** github.com/KittyCAD/web-zookeeper (the copilot reference client) · **Date:** 2026-07-23
- **Type:** doc-gap (the kind this contest exists for)
- The repo's only doc is SPECIFICATION.md — genuinely excellent — but there's no
  README, no install/usage instructions, and the package isn't on npm.
  `package.json` declares `files:["dist"]` and `main: dist/web-zookeeper.js`, yet
  `dist/` isn't committed and there's no `prepare` script — so
  `npm i github:KittyCAD/web-zookeeper` installs a package whose entrypoint doesn't
  exist. Build needs `make` (Windows friction); the real steps are
  `node esbuild.config.mjs` + `tsc -p tsconfig.types.json`.
- **Offer:** a README + `prepare` script is a 30-minute PR; queued for operator go.

## FN-026 · Copilot socket opens every session with a FAKE auth failure
- **API:** `wss://api.zoo.dev/ws/ml/copilot` · **Date:** 2026-07-23 · repro: `server/spikes/ws-copilot-spike.mjs`
- **Type:** rough-edge / doc-gap (client-breaking)
- Auth headers sent 2 ms after open; the server still opens every session (3/3) with
  `error: Please send { headers: … } over this websocket.` The official client
  swallows it by **exact string comparison** of the error text. Any independent
  client's natural reading is "auth failed, abort." Also undocumented outside source
  comments: send nothing until the first server payload arrives, or the backend may
  close the socket.

## FN-027 · Duplicate server frames, no sequence numbers
- **API:** copilot websocket · **Date:** 2026-07-23 (3/3 sessions)
- `conversation_id` arrives twice every session; an identical 1,463-byte
  `tool_output` arrived twice in the prompt run. No seq/request-id on server frames —
  clients can only dedupe by content equality.

## FN-028 · Three wire encodings in one protocol — and the SDK disagrees with itself
- **API:** copilot websocket + `@kittycad/lib` · **Date:** 2026-07-23
- Live: everything is JSON text EXCEPT `replay` (one MessagePack binary whose inner
  messages are UTF-8 JSON byte arrays). Images in `files` frames are JSON `number[]`
  bytes (~4× inflation: 129 KB of JSON for a ~33 KB JPEG). Meanwhile `@kittycad/lib`
  ships an unused BSON encoder and its `MlCopilotWs.parseMessage` fallback tries
  JSON→**BSON** while the shipped worker tries JSON→**msgpack** — follow the lib
  helper and you cannot decode replay.
- **Also captured (capability row CLOSED):** full copilot lifecycle verified live —
  headers auth (FN-013 pattern), `list_modes` (auto default; fast/thoughtful disabled
  on this plan), one prompt → skill activation → KCL via `edit_kcl_code` → constraint
  check → lint → format → execute → 4-view snapshot → physical analysis →
  `end_of_stream.whole_response` in 45.5 s server-side. Metering handle:
  `session_data.api_call_id` = `end_of_stream.id` — one API call per turn.

## FN-029 · `/file/center-of-mass` answers in a Y-up frame — agreement to 1.4e-6 mm once you map it
- **API:** File · `POST /file/center-of-mass` · **Date:** 2026-07-23 · repro: `server/wb/zoo-com-crosscheck.mjs`
- **Type:** convention trap + agreement datum (FN-021 companion)
- Local signed-tetrahedra centroid of the real plate export: [~0, ~0, 1.000] mm in the
  mesh's own coordinates. Zoo returns [≈0, **1.0000014**, ≈0] — the value moved from Z
  to Y. A deliberately asymmetric probe box (centroid [5,10,20]) returns exactly
  [5, 20, −10]: **(x,y,z)_zoo = (x, z, −y)_mesh**. After mapping back, max |Δ| =
  **1.4e-6 mm** — FN-021's trust extends from mass to first moments.
- **Impact:** a weight-and-balance gate armed against Zoo's axis labels without the
  frame map would gate the WRONG axis while looking perfectly healthy. ToolCRIB
  computes locally in the mesh frame and treats the API as cross-check only.
- **Suggested doc edit:** state the response coordinate convention on the
  `/file/center-of-mass` page.

## FN-030 · STL export quantizes to float32 — exact-at-spec walls need an epsilon
- **Surface:** any STL export path · **Date:** 2026-07-23
- **Type:** gotcha (gate-design input)
- A Zoo-exported 0.8 mm plate reads z-span `0.79999995`. Any gate comparing
  STL-measured geometry against a spec floor must carry a float32 grace (our min-wall
  gate uses 1e-3 mm) or an exactly-at-floor wall false-fails. Bonus datum: hand-
  authored KCL 2.0 constraint sketches export clean through `export_kcl` — millimeters
  preserved as authored, minimal watertight binary STL.

## FN-031 · Per-run minute accounting is unavailable on every surface we exercised — so a package claims 0 minutes only when it counted 0 requests
- **Surface:** billing `GET /user/payment/balance` · Agent/ML `GET /user/text-to-cad/{id}` and
  `GET /async/operations/{id}` · copilot websocket frames · **Date:** 2026-07-25
- **Type:** measurement gap (doc-gap + self-audit finding)
- **Expected:** the contest meters entrants in *minutes* (FN-003), so a per-job package ought
  to be able to state the minutes that job consumed — in the same unit the grant is denominated in.
- **What we actually measured — two things, and neither of them is minutes:**
  1. Per-run **wall-clock latency, client-side**. The poll loop timestamps itself
     (`server/lib/zoo.mjs`, `waitTextToCad`) and the live backend records it as
     `apiRuns[].latencyS` (`server/pipeline/backends.mjs`, `liveBackend`). That is elapsed time
     observed from our side. It is not billed minutes, and this package never claimed it was.
  2. The **count of HTTP requests** a run issues, counted at the one place they all pass through
     (`server/lib/zoo.mjs`, the `httpRequests` counter on `zooClient`). Also not minutes — but it
     is the one fact that licenses a package to state `minutesUsed: 0`, because a run that issued
     zero requests cannot have been billed for any. See the second defect below for why we now
     count rather than infer this.
- **What we searched, and what each surface returned:**
  - `GET /user/text-to-cad/{id}` — status, prompt, `code`. No duration, minutes, credits, or cost field.
  - `GET /async/operations/{id}` — `outputs` (FN-007). Same: nothing about cost.
  - `GET /user/payment/balance` — the **only** spend signal we found, and it is account-level:
    `stable_api_credits_remaining_monetary_value` (`server/lib/zoo.mjs`, `balanceUsd`). Attributing one
    job's spend means differencing that balance across the job, which requires real spend and is
    only stable at campaign granularity. That is exactly how FN-017 derived the ≈1 credit /
    API-second rate — from campaigns c001+c002 as an instrument, never from a per-run field.
  - copilot websocket — of the frame keys this client classifies
    (`app/src/lib/zookeeper.ts:64-83`, three live sessions, FN-026…FN-028) not one carries a
    minutes or cost field. Two near-misses worth naming rather than hiding behind a flat "no":
    `session_data.api_call_id` is a metering **handle** — an id, not a quantity — and
    `end_of_stream` does carry server-side `started_at`/`completed_at`
    (`app/src/lib/zookeeper.ts:159-160`), i.e. a genuine *server-side duration* per turn
    (FN-028 clocked one at 45.5 s). That is still not billed minutes: converting duration to
    minutes-charged needs FN-017's ≈1 credit/API-second rate, which is **our arithmetic
    inference, not a published or returned figure** — and this pipeline generates through
    text-to-cad, not copilot, so no job it packages has an `end_of_stream` to read anyway.
    **Caveat, stated rather than papered over:** we
    deliberately leave four key families unmodelled (`replay`, `files`, `request_attachments`,
    and the `metrics` family). The spike logged them raw but nobody audited them field-by-field
    for a cost value, so treat them as **unaudited, not cleared**. The one adjacent datum we do
    have points away from billing: on the *modeling* socket the metrics traffic is the server
    *requesting* metrics from the client, answerable empty (FN-014) — telemetry flowing the
    other way.
- **What remains UNKNOWN — two things, named:**
  1. We did **not** enumerate the full OpenAPI document (FN-002, ~1.18 MB at the API root)
     hunting for a metering or api-call-listing endpoint, and no copy of it is cached in this repo.
  2. The unmodelled copilot frame families above were never read field-by-field.
  So the claim this note supports is bounded: **no surface this client exercises exposes per-run
  minutes** — *not* "no such surface exists." Settling either point takes a live generation to
  spend against, which this pass deliberately did not do.
- **Impact — defect 1, the one this note was opened for:** `server/pipeline/run-job.mjs` hardcoded
  `minutesUsed: 0`, which flowed into every sealed `manifest.json` and `logs/apiRun.json`. Nobody
  measured zero; zero was the default that shipped. In a bundle whose entire pitch is that its
  numbers are real and hash-sealed, a fabricated measurement is the worst class of defect — it is
  sealed, tamper-evident, and wrong.
- **Impact — defect 2, found by adversarial review OF THE FIRST FIX, and worse in one respect:**
  the first fix replaced the fabricated `0` with `null` plus a note reading *"NOT MEASURED — not
  because this run consumed zero."* That sentence was stamped on **every** run without a supplied
  measurement, including runs that provably consumed zero. The demo bundle — the artifact a judge
  actually opens — then contained, in one file, `warnings[0]: "replay backend … zero network"` and
  an apiRuns note denying that the run consumed zero. A bundle contradicting itself inside the
  field added to make that exact distinction legible is a worse failure than the number it
  replaced. Its root cause was a **second fabricated measurement sitting right beside the first**:
  `apiRuns.totalCalls` was `artifacts.apiRuns.length`, which on replay counts **fixture files read
  off disk** (the demo sealed `totalCalls: 2` for a run that opened no socket) and on live counts
  **generations** — sealing `1` for a text-to-cad run that issues a dispatch, a poll every `pollS`,
  and up to six outputs fetches, i.e. a dozen-odd requests for a 60-second generation. With no
  honest call count, the assembler had no signal with which to tell a free run from an unpriced one.
- **Fixed — one counted fact, three distinct states, no fourth:**
  - `zooClient` counts every request it issues, incremented *before* the await so a request that
    404s or throws still counts (it was still issued). Backends report that count as a delta
    across their own generation; replay and flushmount report a literal `0` because no `fetch` is
    reachable from those code paths (`server/lib/zoo.mjs`, `server/pipeline/backends.mjs`).
  - The packager (`server/package/assemble.mjs`) seals `totalCalls` as **a count or `null`** —
    never `?? 0`, and never a length borrowed from an array of something else. It then derives:
    a caller-supplied number ships bare; `totalCalls === 0` ships `minutesUsed: 0` with a basis
    note saying the zero is *entailed by the counted request total, not read off a billing
    surface*; anything else ships `null` with a note saying NOT MEASURED and *"unknown, not free."*
  - Each array travels under the name of what is in it — `calls` for per-request records,
    `generations` for text-to-cad runs, `replayedRecords` for fixture provenance — so nothing is
    counted twice by a reader trusting a field name.
  - `manifest.json` mirrors `logs/apiRun.json` field for field, notes included; the summary a
    reviewer reaches for first no longer carries a different account from the log beside it.
  - When minutes are genuinely unknown, that now reaches **PDF section 9**, the page a human signs.
    Ordering constraint worth knowing before editing: `warnings` is handed to the PDF builder by
    reference and rendered during that call, so anything pushed after it lands in
    `manifest.warnings` and never in the document — the API accounting is computed above the build
    for exactly that reason.
- **Deliberately not done:** `latencyS / 60` is a tempting stand-in — FN-017 measured that real
  generations bill ≈ their runtime — but a derived estimate sitting in a field named `minutesUsed`
  is the same fabrication with arithmetic in front of it. If that estimate ever ships it ships
  under its own name, with its basis attached.
- **Repro:** `npm run demo`, then read `server/pipeline/data/packages/<jobId>/manifest.json` →
  `apiRuns` is `{totalCalls: 0, minutesUsed: 0, minutesUsedNote: "…issued ZERO requests…"}`, and
  `logs/apiRun.json` carries the identical account plus the two `replayedRecords`. Before defect 1
  was fixed the same block read `{totalCalls: 2, minutesUsed: 0}` with nothing marking either as
  invented; between the two fixes it read `{totalCalls: 2, minutesUsed: null}` with a note denying
  the run's own zero. A live run instead seals its counted request total with `minutesUsed: null`.
  Regression-locked in `server/lib/zoo.test.mjs` (the counter, incl. failed requests and poll
  loops), `server/package/package.test.mjs` (all three states, plus that the unmeasured case
  reaches the PDF) and `server/pipeline/pipeline.test.mjs` (the demo bundle may not contradict its
  own zero-network warning; the live seam seals the client's counted delta).
- **Suggested doc edit:** the text-to-cad and async-operation records should carry the billed cost
  of that call (credits and/or API-seconds), and the balance page should state plainly that
  per-call cost is not retrievable per call today. FN-003 asked for the grant to be labeled; this
  is the same gap one level down — an entrant metered in minutes cannot attribute minutes to a job.

## FN-032 · Boolean-built solids report an inflated bounding box — XY × 1.2, Z + 0.1 × chamferDepth, exact on 5 of 5
- **Surface:** Engine · bounding box over executed KCL (`calculate_bounding_box`)
- **Date:** 2026-07-28 · 5 parameter sets on the live engine, two agents independently
- **Type:** bug (silent — the number is plausible, and it is wrong)
- **Expected:** the bounding box of an executed solid is the box that solid occupies. FN-015
  measured exactly that: a path-built 10 mm extrusion returned centre (5,5,5) and dimensions
  (10,10,10) mm, exact, in ~450 ms.
- **Actual:** for a solid built by SUBTRACTING cutters — this repo's chamfer route, forced by
  FN-024 — the reported box is bigger than the part, and bigger by a fixed ratio rather than by
  noise. A native `chamfer()` call on the same nominal part returns the true part every time.

  | case | boolean-built | native `chamfer()` | true part |
  |---|---|---|---|
  | base_c015 | 23.64 × 23.64 × 3.08 | 19.70 × 19.70 × 3.00 | 19.7 × 19.7 × 3 |
  | deep_chamfer | 23.64 × 23.64 × 3.28 | 19.70 × 19.70 × 3.00 | 19.7 × 19.7 × 3 |
  | tiny_scale | 4.752 × 4.752 × 0.96 | 3.96 × 3.96 × 0.90 | 3.96 × 3.96 × 0.9 |
  | micro_clear | 23.976 × 23.976 × 3.005 | 19.98 × 19.98 × 3.00 | 19.98 × 19.98 × 3 |

- **The pattern is the reportable part:** XY = **1.2 × the true part**, Z = **part + 0.1 ×
  chamferDepth**, arithmetic-exact on every row. One row is checkable end to end against a file
  this repo ships: base_c015's true part matches
  `samples/flush-mount/coupons/c0.15/insert.kcl` on all four numbers — a 19.7 × 19.7 × 3 insert at
  `chamferDepth = 0.8` — and 19.7 × 1.2 = 23.64, 3 + 0.1 × 0.8 = 3.08, both to the digit. Run the
  same arithmetic backwards on the other three and the implied chamfer depths are 2.8, 0.6 and
  0.05 — **back-derived from the very pattern they would otherwise be evidence for**, so they are
  not corroboration and are not offered as any. The case names do not supply it either:
  `deep_chamfer` is the only one that names a depth at all; `tiny_scale` names a scale reduction,
  and 0.6 mm on a 0.9 mm part is two thirds of the plate's thickness — nothing about that row is
  tiny except its overall scale; `micro_clear` names a clearance, which its true part does confirm
  — 19.98 = 20.0 − 2 × 0.01 — while saying nothing about a chamfer. base_c015 is the row the claim
  stands on. Five parameter sets were measured and the pattern held in all five; the four with
  recorded numbers are tabulated.
- **Mechanism: UNKNOWN, and deliberately not guessed.** One thing it is *not* is the raw extent of
  the cutters, and the shipped file is enough to say so.
  `samples/flush-mount/coupons/c0.15/insert.kcl` declares
  `wedgeSpanY = insertHeight + 2 * chamferReach + 2mm` = 19.7 + 3.6 + 2 = 25.3 mm, extruded
  `symmetric = true`, so each wedge prism reaches **±12.65 mm**; in its own sketch plane the same
  wedge spans 8.05 → 10.2 mm across and 1.85 → 4.0 mm in Z. The part plus every cutter is
  therefore 25.3 × 25.3 × 4.0 mm. The reported box is neither that nor the part: it sits *strictly
  between* them on all three axes — 11.82 mm per side against 9.85 for the part and 12.65 for the
  cutters, 3.08 mm tall against 3.0 and 4.0. Beyond that we have two round factors — 1.2 and 0.1 —
  that track the part and the chamfer depth rather than the tool, and nothing that says why.
  Naming a cause we did not measure would be the defect this repo exists to stop.
- **What it does NOT touch:** the exported mesh. Both meshes — boolean-built and native — are
  watertight, 0 degenerate, 0 sliver, 20 triangles, 12 vertices, and agree on volume to
  2.4e-6 mm³ (1139.7366463938852 vs 1139.7366440254093) — a relative agreement of 2.1e-9. *(Filed
  here first as "2.4e-9 mm³": the relative figure wearing the absolute one's units, three orders
  out. It was caught by subtracting the two numbers printed next to it, which is the entire
  argument for putting arithmetic in a test rather than in a sentence —*
  `server/generators/chamfer-claims.test.mjs` *does that subtraction now.)* The part is right; only
  the measurement of it is wrong, which is what makes this dangerous rather than annoying —
  nothing downstream fails.
- **Impact:** any consumer that trusts `calculate_bounding_box` is silently corrupted, and a 20 %
  XY inflation is exactly the size that reads as plausible rather than broken. The concrete
  casualty here is the printer-envelope check FN-015 closed: a 23.64 mm box on a 19.7 mm part
  rejects nothing today, but on a part near the plate limit it rejects a job that would have
  printed — and a build-volume rejection is precisely the kind of answer nobody re-derives by hand.
  Counting this one, the same measurement now has three behaviours: exact on path-built solids
  (FN-015), null dimensions on imported ones (FN-022), inflated on boolean-built ones (here). Only
  the third lies quietly.
- **Repro — and what is missing from it.** The offline half runs in this repo:
  `node --test server/generators/chamfer-claims.test.mjs` measures the shipped mesh
  `samples/flush-mount/coupons/c0.15/insert.stl` with `server/package/stl-analyze.mjs` (the offline
  analyzer FN-021 pinned against `/file/mass`) → 19.7 × 19.7 × 3.0 watertight over 20 triangles,
  reads the cutter extents above out of the shipped `.kcl`, and holds the engine figures beside
  them so every piece of arithmetic in this note is a test rather than a sentence. It runs as part
  of `npm test`. The engine half does not run here: execute
  `samples/flush-mount/coupons/c0.15/insert.kcl` — shipped, and the base_c015 row — and ask for its
  bounding box → 23.64 × 23.64 × 3.08. **The 35-call probe harness that produced that figure is not
  committed to this repo**, because re-running it spends API minutes. The consequence is worth
  stating rather than leaving to be discovered: nothing here re-measures the engine, so if a
  release quietly fixes the bounding box, this note goes stale and no test goes red. The other
  three rows are the same generator at other parameters (`server/generators/flushmount.mjs`).
- **Suggested fix:** return the bounding box of the resulting solid after a boolean. If the value
  is instead a deliberate conservative envelope, say so in the response and on the docs page — an
  unlabelled envelope is indistinguishable from a measurement, and gets used as one.

## FN-033 · `chamfer()` with a bare profile tag chamfers the WRONG END — and volume, area and bounding box all agree with the right part
- **Surface:** Engine · KCL `chamfer(tags = [...])` on an extruded solid
- **Date:** 2026-07-28
- **Type:** bug (silent-wrong-result) + doc-gap — the silence is the finding, not the offset
- **Expected:** `tags = [solid.sketch.tags.s0 … s3]` on a solid extruded from that sketch chamfers
  the four side edges at the end you extruded toward. A contract written against this call
  elsewhere recorded it as passing on exactly that reading.
- **Actual:** it chamfers the **z = 0 end** — on a flush-mount insert, the show face, the one face
  on the part that must stay flat. `getOppositeEdge(...)` is required to reach the other end.
  The [chamfer page](https://zoo.dev/docs/kcl-std/functions/std-solid-chamfer) uses
  [`getOppositeEdge`](https://zoo.dev/docs/kcl-std/functions/std-sketch-getOppositeEdge) in its
  examples but never states the rule, and nothing in the response says which end you got.
- **Why this is a trap rather than an inconvenience — every scalar check passes:**

  | measurement | correct part | wrong-end part |
  |---|---|---|
  | volume mm³ | 1139.7366 | 1139.7366 |
  | surface area mm² | 974.5916 | 974.5916 |
  | bounding box mm | 19.70 × 19.70 × 3.00 | 19.70 × 19.70 × 3.00 |
  | centre of mass, z mm | **1.473491907119751** | **1.52650785446167** |

  Only the first moment separates them, and the reason is arithmetic rather than luck: chamfering
  the other end of the same prism yields the **mirror image about the mid-plane**, so every
  symmetric measurement is invariant by construction. The two z values sum to 2.999999761581421 —
  3.000 mm to within 2.4e-7, i.e. to float32, which is FN-030's quantisation showing up as
  confirmation.
- **Impact:** this is a generated-KCL problem specifically. A human in Design Studio sees the
  chamfer on the wrong face immediately; a generator does not look. And it defeats the check this
  repo was built on: FN-010's thesis is that a `completed` status means nothing and downstream
  measurement is what you trust — but mass, volume, area and envelope are all identical here, so
  every gate ToolCRIB shipped before this note passes a part whose show face is chamfered and whose
  lead-in is flat. It prints, it looks correct, and it does not sit flush. The one check that
  separates them is centre of mass, which we compute locally and cross-check (FN-029) — and which
  has to be computed in the right frame to be worth anything, per that same note.
- **Repro — and what is missing from it.** On the engine: extrude a rectangular profile;
  `chamfer(tags = [solid.sketch.tags.s0, s1, s2, s3])`; read the centre of mass (mapping the axis
  convention per FN-029). Repeat with each tag wrapped in `getOppositeEdge()`. Everything except
  the centroid matches. **That probe is not committed to this repo** — it is a hand-written KCL run
  against the live engine, and re-running it spends API minutes; this repo calls `chamfer()`
  nowhere, so there is nothing here to point at. What *is* committed is the arithmetic that makes
  the two centroids diagnostic: `node --test server/generators/chamfer-claims.test.mjs` pins that
  they sum to the part height to float32 — the mirror-image argument above, stated as a check
  instead of a sentence. If a release changes which end a bare tag resolves to, nothing in this
  repo will notice.
- **Suggested doc edit:** the chamfer page's `tags` parameter should say in prose which end of an
  extruded solid a bare profile-edge tag resolves to, and that `getOppositeEdge()` addresses the
  other one. The examples demonstrate the call; they do not say what happens when you omit it.
  Stronger version of the same ask: when an operation can return a valid, plausible, *different*
  part depending on tag resolution, the response should name the edges it actually chamfered.

## FN-034 · Native `chamfer()` cannot reach an interior opening rim — `tags` yields a sketch-edge tag, the operation wants a face tag, and the alternative is marked do-not-use
- **Surface:** Engine · KCL `chamfer()` edge selection on an inner-loop (hole / opening) profile
- **Date:** filed 2026-07-28. First hit while building `server/generators/flushmount.mjs`, and the
  repo brackets that rather than dating it: the commits that built the chamfer route land
  2026-07-23 (`9be61ca`, `dffc65a`), and the generator's header carries a `Measured 2026-07-23`
  — but that date is attached to the *boolean-subtract* failure (FN-024), and the header's reason
  for not calling `chamfer()` at all is a different one, undated ("the sampled KCL corpus contains
  no chamfer()/fillet() call"). Nothing in this repo dates the inner-loop failure specifically.
  Treat 2026-07-23 as the bracket, not as a record; the errors quoted below are verbatim, the
  calendar around them is not evidence.
- **Type:** documented limitation — **Zoo already knows**. This note is a timeline question, not a
  bug report.
- **The feature:** a panel with a rectangular opening and a chamfered lead-in on the opening rim.
  The chamfer is on the INTERIOR — the rim of the hole, not the outside of the plate.
- **Actual — two routes, two distinct executor errors, verbatim:**
  1. tags taken straight off the inner-loop sketch segments →
     `Entity found but wrong type / no edges match`
  2. those same tags through `getOppositeEdge()` (the FN-033 fix) →
     `Tag i0 refers to a sketch edge, but this operation requires a face tag`

  The second error is the useful one and it names the whole problem: `chamfer()` wants a **face**
  tag, an inner loop hands you a **sketch-edge** tag, and no documented conversion connects them.
- **Why this is filed as a gap and not as news:** the third route — the experimental `edges`
  selector on the same page — carries Zoo's own warning in the kcl-std docs: *"Experimental.
  Experimental face API. Do not use in generated or user-facing KCL yet; prefer `tags` until
  point-and-click and migration support ships."* So the published advice is to prefer `tags`, and
  `tags` is precisely the route that cannot address an interior rim. That is a known, deliberately
  staged gap; we are not reporting a surprise, we are asking about the schedule.
- **Impact:** every chamfered hole, counterbore lead-in, bore break-edge and flush-mount opening in
  *generated* KCL is outside `chamfer()`'s reach today — and in fastening work the interior chamfer
  is the common one, not the exotic one. You break the edge of a hole far more often than you
  chamfer the corner of a plate. Our workaround is the boolean decomposition already documented in
  FN-024 (straight opening prism + a 2-profile frustum loft), which is why this repo does not call
  `chamfer()` anywhere.
- **The question for Zoo, which is the only thing we actually want:** when the face API leaves
  experimental, will an inner loop be addressable through it — and until it does, is there a
  supported way to get from a sketch-edge tag on an inner loop to the face tag `chamfer()`
  requires? If the answer is "no, decompose into booleans", one line saying so on the chamfer page
  would have saved us a day and would save it for everyone generating KCL.
- **Repro:** sketch a rectangle with an inner rectangular loop; extrude; tag the inner-loop
  segments; call `chamfer()` on them → error 1. Wrap each tag in `getOppositeEdge()` → error 2.
- **Suggested doc edit:** state on the chamfer page that `tags` addresses the outer-profile edges
  of an extruded solid and does not reach inner-loop rims, and cross-link the supported route for
  interior edges — or say plainly that there isn't one yet. The experimental warning already tells
  a reader not to use `edges`; it does not tell them what to do instead when `tags` cannot express
  the feature they came for.

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
- **Zoo docs — fills a gap:** [GET /async/operations/{id}](https://zoo.dev/docs/developer-tools/api/api-calls/get-an-async-operation) is the only reference page that carries `outputs`; the [text-to-CAD endpoint page](https://zoo.dev/docs/developer-tools/api/ml/generate-a-cad-model-from-text) never states that the exported files live on the async-operations surface rather than the user record. Neither page mentions the unpadded-base64 encoding.
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
- **Zoo docs — confirms + extends:** the gate is built on [POST /file/mass](https://zoo.dev/docs/developer-tools/api/file/get-cad-file-mass) used exactly as documented; the finding extends the doc by showing a single mass value functions as a feature-presence proof, which the endpoint page does not itself claim.

---

## Zoo documentation cross-reference

Every finding above that touches a documented Zoo surface is mapped here to the exact doc
page it **confirms** (behaves as documented), **contradicts** (behaves against the doc), or
**fills** (a real gap the doc does not cover). Each URL was fetched and confirmed to resolve
on 2026-07-23. GitHub-issue filings are listed inline in the notes; this table is Zoo's own
documentation only.

| Finding | Zoo surface | Zoo doc page | Relationship |
|---|---|---|---|
| FN-001 | Bearer auth on `GET /user` | [API reference overview](https://zoo.dev/docs/developer-tools/api) | confirms |
| FN-002 | OpenAPI spec served at API root | [API reference overview](https://zoo.dev/docs/developer-tools/api) | fills — spec location under-advertised |
| FN-003 · FN-017 · FN-031 | `GET /user/payment/balance` | [Get balance for your user](https://zoo.dev/docs/developer-tools/api/payments/get-balance-for-your-user) | fills — grant not labeled; no credits→minutes mapping; balance is account-level, so no per-call cost attribution |
| FN-004 · FN-016 | Export formats / DXF path | [Convert CAD file](https://zoo.dev/docs/developer-tools/api/file/convert-cad-file-from-one-format-to-another) | fills — DXF (`OutputFormat2d`/`export2d`) not cross-linked |
| FN-005 · FN-006 · FN-018 · FN-020 | Text-to-CAD generation | [Generate a CAD model from text](https://zoo.dev/docs/developer-tools/api/ml/generate-a-cad-model-from-text) | contradicts — latency variance + non-determinism undocumented |
| FN-007 · FN-011 | `outputs` surface split | [Get an async operation](https://zoo.dev/docs/developer-tools/api/api-calls/get-an-async-operation) | fills — outputs live only here; dedupe hits carry no async record |
| FN-008 · FN-010 · FN-021 | Mass / volume validation | [Get CAD file mass](https://zoo.dev/docs/developer-tools/api/file/get-cad-file-mass) | confirms — 0.02% agreement; reproduced offline to every digit |
| FN-019 | `POST /file/execute/{lang}` | [Executor API](https://zoo.dev/docs/developer-tools/api/executor) | confirms lang enum · fills — no `kcl` variant, endpoints 500 |
| FN-024 | KCL boolean `subtract()` | [`subtract()` standard library](https://zoo.dev/docs/kcl-std/functions/std-solid-subtract) | fills — no note on cut-crossing / absolute-scale failure |
| FN-033 · FN-034 | KCL `chamfer()` edge selection | [`chamfer()` standard library](https://zoo.dev/docs/kcl-std/functions/std-solid-chamfer) | fills — which end a bare profile tag resolves to is shown by example but never stated; inner-loop rims are unreachable via `tags`, and the `edges` alternative is marked "do not use in generated or user-facing KCL yet" |
| FN-033 | `getOppositeEdge()` | [`getOppositeEdge()` standard library](https://zoo.dev/docs/kcl-std/functions/std-sketch-getOppositeEdge) | confirms — takes a `TaggedEdge`, which is exactly why the inner-loop route in FN-034 is refused |
| FN-009 · FN-013 · FN-014 · FN-015 · FN-022 · FN-023 · FN-032 | Modeling command websocket / engine geometry queries | [Engine API](https://zoo.dev/docs/developer-tools/engine-api) | fills — post-upgrade auth frame + protocol not in the overview; nothing states that the bounding box of a boolean result is not the bounding box of the part |
| FN-025 · FN-026 · FN-027 · FN-028 | Copilot websocket / agent client | [Agent API](https://zoo.dev/docs/developer-tools/agent-api) | fills — copilot ws lifecycle + encodings undocumented |

*Method note: doc pages were verified by fetching each URL; two candidate deep-links
(`/api/executor/get-an-async-operation`, `/api/file/get-mass`) returned 404 during
verification and were replaced with the correct paths above rather than cited blind.
The two kcl-std pages added on 2026-07-28 (`std-solid-chamfer`, `std-sketch-getOppositeEdge`)
were fetched the same day; the experimental-selector warning quoted in FN-034 was read off the
chamfer page rather than paraphrased from memory.*

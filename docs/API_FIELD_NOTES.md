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

## FN-006 · Fastening-feature prompt fails after 8 min and leaks an internal cluster URL
- **API:** Agent/ML · `POST /ai/text-to-cad/step?kcl=true`
- **Date:** 2026-07-22 (id `5f98c1c2-c670-4f5d-83c8-c56a4b308ba7`)
- **Type:** bug (two bugs, really)
- **Expected:** either generated geometry or a domain error ("couldn't satisfy the
  countersink constraint").
- **Actual:** after 8 m 10 s in `in_progress`, status flips to `failed` with:
  `Text-to-CAD server: Communication Error: error sending request for url
  (http://text-to-kcl.text-to-kcl.svc.cluster.local:8080/text-to-cad)`
- **Bug 1 — reliability:** a moderately-constrained fastening prompt (four positioned
  countersunk holes) appears to time out an internal hop rather than degrade gracefully.
  This is the exact feature class where text-to-CAD needs to win to be a shop tool.
- **Bug 2 — hygiene:** the error string leaks internal Kubernetes service DNS
  (`*.svc.cluster.local:8080`) to the end user. Should be a request id + a clean message.
- **Repro:** CONFIRMED 2/2. Same prompt, two independent runs, same failure + same
  leaked URL: ids `5f98c1c2-c670-4f5d-83c8-c56a4b308ba7` and
  `74f6f311-a782-436a-98ac-c14cd17707bc` (both 2026-07-22, ~8 min each).
- **Suggested fix:** map internal transport errors to an opaque error code; surface
  partial/best-effort KCL when the model produced code before the hop failed.

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

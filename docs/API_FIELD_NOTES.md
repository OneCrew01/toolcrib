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
  `in_progress` for **minutes**, not seconds (see CURRENT_STATE for final timing).
- **Impact:** any UI that blocks on generation is unusable for real fastening features;
  async background execution with notify is a requirement, not a nicety.
- **Repro:** POST the prompt above; poll `GET /user/text-to-cad/{id}`.

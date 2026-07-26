# `app/` — the ToolCRIB review console

The web client for the pipeline in `server/`. React + TypeScript on Vite; this is the
only TypeScript in the repo (the backend is plain `.mjs`). Start here:
[root README → "Run the review console"](../README.md#run-the-review-console) and
[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

```bash
npm --prefix app install     # the console is the only part of the repo with deps
npm start                    # from the repo root: API on :8787
npm --prefix app run dev     # console on :5173, proxying /api and /health to :8787
```

Run the API first — the console has no data source of its own.

## What's in here

| Path | What it is |
|---|---|
| `src/App.tsx` | The whole router: four views, one switch. `react-router` is deliberately not installed. |
| `src/views/JobList.tsx` | Jobs newest-first with live state chips. |
| `src/views/NewJob.tsx` | The request form; `POST /api/jobs`. |
| `src/views/JobDetail.tsx` | Transition ledger as centerpiece, gate cards, package panel, human-review bar. Polls every 2 s. |
| `src/views/DraftPanel.tsx` | Operator-mode Zookeeper drafting chat. |
| `src/lib/api.ts` | The only place that knows the API's shape. Relative paths only. |
| `src/lib/zookeeper.ts` | Native client for Zoo's ML copilot websocket — pure frame classifier/aggregator plus a thin socket wrapper. |
| `src/lib/zookeeper.selfcheck.ts` | Recorded-frame fixtures through those pure functions. Runs as the **last step of the root `npm test`**, not just in dev. |
| `vite.config.ts` | Dev proxy: `/api` and `/health` → `http://localhost:8787`. No port override, so Vite's default `:5173` is the console's port — and `:5173` is exactly what the API's CORS allowlist admits (`server/api/server.mjs`). |

## The credential rule, which is not a detail

Every view except one holds **no** Zoo credentials and talks only to the ToolCRIB API
over relative paths — the footer says so on screen. The single exception is the
Zookeeper panel (operator mode): there the operator pastes a Zoo token at runtime, it
lives in that tab's memory only, it is sent once in the auth frame straight from the
browser to Zoo, and it is wiped the instant that frame is on the wire and again on
disconnect. The backend is never in that path and there is no proxy — on purpose. The
footer swaps to say the stronger thing on that screen. Any hosted deployment of this
console stays replay-only: no token field, no live sessions.

## Testing

There is no separate test command here. `src/lib/zookeeper.selfcheck.ts` is wired into
the root `npm test` (`npm run test:app` →
`node --experimental-strip-types app/src/lib/zookeeper.selfcheck.ts`), prints
`self-checks: N passed`, and exits non-zero on any failure. The same fixtures also run
on every `npm run dev` boot from `main.tsx`, dev-only, warning to the console.
Type errors are caught by `npm --prefix app run build` (`tsc -b && vite build`).

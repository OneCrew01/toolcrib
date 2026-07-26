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

Complete inventory of `src/` — if a file is not in this table, it does not exist yet.
Keep it that way.

| Path | What it is |
|---|---|
| `src/main.tsx` | Entry point. Mounts `App` in `StrictMode` and, **dev builds only** (`import.meta.env.DEV`, line 9), dynamically imports the Zookeeper self-checks so a broken protocol client is noisy on boot. The guard drops that import from production bundles. |
| `src/App.tsx` | The whole router: four views, one switch. `react-router` is deliberately not installed. Also polls `/health` every 5 s for the connected/unreachable chip. |
| `src/components.tsx` | The six shared presentational atoms every view builds from: `StateChip`, `ActorBadge`, `GatePill`, `PulseDot`, `CopyButton`, `ErrorBanner`. No fetching, no state beyond their own. |
| `src/views/JobList.tsx` | Jobs newest-first with live state chips. Polls every 2 s. |
| `src/views/NewJob.tsx` | The request form; `POST /api/jobs`. |
| `src/views/JobDetail.tsx` | Transition ledger as centerpiece, gate cards, package panel, human-review bar. Polls every 2 s. |
| `src/views/DraftPanel.tsx` | Operator-mode Zookeeper drafting chat. The one screen with a token field — see the credential rule below. |
| `src/lib/api.ts` | The only place that knows the API's shape, and the only `fetch` call site in `app/`. Relative paths only. |
| `src/lib/usePoll.ts` | The polling hook behind every "polls every N s" claim above. Fixed interval, overlapping requests skipped so a slow response never stacks another behind it, stale responses from a previous `key` dropped. **Change the cadence here and this table goes stale — update both.** |
| `src/lib/format.ts` | Pure display formatters (`formatTimestamp`, `timeAgo`, …). No fetch, no DOM, no React, so the type-checker can pin them down. |
| `src/lib/zookeeper.ts` | Native client for Zoo's ML copilot websocket — pure frame classifier/aggregator plus a thin socket wrapper. **The only file in `app/` that opens a socket to a third party** (`COPILOT_URL`, line 42) **and the only one that sends a credential off-machine** (line 504). `DraftPanel.tsx` collects the token into component state and hands it here; nothing else in `app/` touches one. |
| `src/lib/zookeeper.selfcheck.ts` | Recorded-frame fixtures through those pure functions. Runs as the **last step of the root `npm test`**, not just in dev. |
| `src/index.css` | The whole theme, tokenized: color/font/radius live in the `:root` block at the top, so a reskin is variable edits there. Two brand accents only (`--panel`, `--insert`). Two values are deliberately literals rather than tokens — the `.brand-mark::after` 1px logo inset and the 50% radius on status dots — and the file's header comment says why. |
| `vite.config.ts` | Dev proxy: `/api` and `/health` → `http://localhost:8787`. No port override, so Vite's default `:5173` is the console's port — and `:5173` is exactly what the API's CORS allowlist admits (`server/api/server.mjs`). |

## The credential rule, which is not a detail

Every view except one holds **no** Zoo credentials and talks only to the ToolCRIB API
over relative paths — the footer says so on screen. Say it that way, not "the backend is
the only Zoo client": this is a single bundle, so `zookeeper.ts` and the literal
`wss://api.zoo.dev/ws/ml/copilot` are shipped to the browser on *every* view, and a judge
grepping `dist/` will find them. What is true on every view is that no key is baked into
the build and that only one screen's *browser* connects to Zoo. Keep that scope too: the
New Job form offers backend `live`, and choosing it makes the **server** call Zoo
(`server/pipeline/backends.mjs`, `liveBackend`), so "the only screen that reaches Zoo" is
a claim the New Job screen falsifies while the footer is visible on it. The single
browser-side exception is the Zookeeper panel (operator mode): there the operator pastes
a Zoo token at runtime, it lives in that tab's memory only, it is sent once in the auth
frame straight from the browser to Zoo, and it is wiped the instant that frame is on the
wire and again on disconnect. The backend is never in that path and there is no proxy — on purpose. The
footer swaps to say the stronger thing on that screen.

There is also a hosting policy — a public deployment stays replay-only, no token field,
no live sessions. It lives in one place, the [root README's "Drafting with Zookeeper"
section](../README.md#drafting-with-zookeeper-operator-mode), and it is not restated
here on purpose: it is an operator commitment that **nothing in this build enforces**.
`DraftPanel.tsx` has no production guard, `App.tsx` renders its nav link
unconditionally, and the token field is present in `npm --prefix app run build` output.
If you are the one wiring that gate, this paragraph is the thing to delete once it is
real.

## Testing

There is no separate test command here. `src/lib/zookeeper.selfcheck.ts` is wired into
the root `npm test` (`npm run test:app` →
`node --experimental-strip-types app/src/lib/zookeeper.selfcheck.ts`), prints
`self-checks: N passed`, and exits non-zero on any failure. The same fixtures also run
on every `npm run dev` boot from `main.tsx`, dev-only, warning to the console.

The other two checks are manual — nothing in CI runs them, because there is no CI:

- `npm --prefix app run build` (`tsc -b && vite build`) is what catches type errors.
- `npm --prefix app run lint` (`oxlint`) is the third script in `app/package.json` and
  is easy to miss. It currently exits 0 with one known warning —
  `react(only-export-components)` on `DraftPanel.tsx`'s `composeDesignIntent` export, a
  fast-refresh nicety about a non-component export sharing the file. Warning, not error;
  left alone deliberately. (Cited by symbol, not line: the line number moves whenever
  anything above it in the file is edited, and a stale one is a false claim.)

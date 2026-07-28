# Architecture

*Grows with the build; every section below describes code that exists. See
DECISION_LOG for the why behind each piece.*

```
        ┌────────────── CAPTURE + DELIVERY WRAPPER ──────────────┐
        │  1 · Intent: part + fastening requirements (form / NL)  │
        │                          ↓                              │
        │  2 · FASTENING REFERENCE (typed rules + citations)      │
        │      holes · fasteners · edge distance · flush mounting │
        │      → resolves intent into checked parameters          │
        │                          ↓                              │
        │  ┌──────────── ZOO API CORE — THE HERO ─────────────┐   │
        │  │ Agent API  → parametric design intent → KCL       │  │
        │  │ Engine API → execute · VALIDATE · mass/volume     │  │
        │  │ File API   → STL (print) · STEP (interchange)     │  │
        │  └───────────────────────────────────────────────────┘  │
        │                          ↓                              │
        │  4 · Documented build package (PDF + CAD + citations)   │
        │                          ↓                              │
        │  5 · Human approval gate → deliver / revise (rev+1)     │
        └─────────────────────────────────────────────────────────┘
```

Box 5's **revise** leg is the one place this diagram runs ahead of the build, so it
is flagged here rather than left for a reader to discover: the state machine below
carries the `rev+1` edge and the store walks it, but nothing in the runner, the API
or the console drives it yet. See "The revision half" for exactly what is built.

## Components

- **`server/`** — Node backend, written in plain ESM JavaScript (`.mjs` — there is no
  TypeScript under `server/`). Every import is a `node:` builtin, so the backend has
  zero npm dependencies and nothing to install. Holds the Zoo API token; the only
  *backend* path to Zoo. Exposes a small HTTP API to the UI.
- **Fastening reference** — typed rules/tables, each value carrying its source citation
  (public-domain FAA acceptable-practice data). Deterministic: no model call is needed
  to look up a rule. AI parses intent; rules compute parameters.
- **StateStore** — interface; local implementation first (see D-004). Append-only
  transition ledger per job.
- **`app/`** — thin web client: this is where the TypeScript lives (React + Vite,
  `.ts`/`.tsx`). It holds no key and never calls Zoo — with exactly one deliberate
  exception, the operator-mode Zookeeper panel, which opens a browser-side websocket
  to Zoo with a token the operator pastes at runtime (see "The intent layer" below).
  Nothing else in the app ever leaves the ToolCRIB API.

## State machine

Every generation job walks one machine (`server/state/states.mjs`):

```
DRAFT -> VALIDATING -> GENERATING -> GEOMETRY_CHECK -> PACKAGING -> PDF_GENERATION
           |               |                |                                  |
           |               |                +-> GEOMETRY_INVALID               v
           |               +-> GENERATION_FAILED           WAITING_FOR_HUMAN_REVIEW == GATE
           |               +-> OUTPUTS_UNREACHABLE (FN-011)     |            |
           +-> INPUT_ERROR                                      v            v
           +-> CAPABILITY_MISSING                          APPROVED   REVISION_REQUESTED
                                                                |            |
                                                            DELIVERED     DRAFT (rev+1)
```

Each state carries an actor class answering "who may move a job OUT of here": SYS
states advance automatically; HUMAN states advance only on an explicit, named human
action — the machine can park a job at the gate, never push past it. Every transition
appends to a per-job JSONL ledger where each row's hash commits to the previous row's
hash (sha256 chain), so `verifyLedger()` proves the recorded history is the history
that happened: edit or drop any row and every hash after it breaks. "Completed" is not
"correct" (FN-010), and outputs can vanish (FN-011) — the machine encodes both as
first-class states instead of exceptions.

`REVISION_REQUESTED -> DRAFT` is drawn above because the map really carries it
(`states.mjs:77`) and `store.transition()` bumps the job's `rev` across it
(`store.mjs:171`, walked end to end by `state.test.mjs:66`). What no shipped caller
does is walk it: `POST /api/jobs/:id/decision {action: "revise"}` writes
`REVISION_REQUESTED` and stops (`api/server.mjs:335`), and `run-job.mjs` never
re-enters a job at `DRAFT`. The edge is built and unused, which is a different thing
from planned.

`VALIDATING -> CAPABILITY_MISSING` is the **second** branch drawn above that nothing
walks, and it gets its own paragraph for the same reason the revise leg got one: a
diagram that flags one dead branch and draws another in silence reads as selective,
and a reader is right to grade the whole picture by the branch that was not flagged.
The state is declared, the machine permits the move
(`server/state/states.mjs:52`), and the console knows how to color it if it ever
arrives (`app/src/lib/api.ts:30`) — but grep the tree for the name and not one hit is
code that *sets* it. Every hit is a declaration (the state constant, the branch, its
terminal entry), a list that merely contains the name (the console's failure-state
list, the diagram above), or prose about it — this paragraph, the comment above the
branch, and the pins that hold the two citations above honest. Nothing sets it, so no
job can reach it. It is a hook for an idea that is not built: a measured capability
ledger, where a request naming a feature class this repo has *not* proven Zoo can
produce reliably would park here instead of generating. Nothing measures that today.
So unlike the revision edge — which is half-built, and whose halves are named above —
this one has no half: it is a reserved name and an empty branch, drawn because
deleting it would hide the intent, not because it runs.

## The revision half: amendment as a pure module

`server/revision/amend.mjs` answers the question the bench asks after a print: *the
insert binds — what should the model say instead?* `proposeAmendment({parentRequest,
measurement, allowDraft})` takes the parent request and one caliper reading and
returns a frozen proposal: the parent request with only its fit parameters changed,
plus the shown work for why, plus the warnings that ride with it. Every number in it
is labelled `cited` (an encoded row holds exactly this number, with its rule id and
citation) or `computed` (our arithmetic, shown, and disclaimed — no row in the
reference authorises deriving a clearance from a caliper reading).

Where it sits: **beside** the pipeline, not inside it.

```
  reference/tables/flush-mount-fit.mjs   fail-closed lookups: the band, the lead-in
                 |                        (both PENDING today -> allowDraft or throw)
                 v
  revision/amend.mjs  --asks-->  generators/flushmount.mjs   "would this build?"
                 |                        (the real generator, twice: parent, then
                 |                         amendment — no gate is re-implemented here)
                 v
        a frozen proposal  ->  a caller decides what to do with it
                               (today: revision/demo-amend.mjs and the tests,
                                and nothing else)
```

What it deliberately does not touch, each for a stated reason:

- **The state machine and the store.** No transition, no `rev` bump, no job. The
  module is pure — no I/O, no clock, no randomness — so it can be reasoned about and
  tested without a store, and so it cannot half-write a job it then throws on. (It
  does call `state/request.mjs`, which is the pure envelope validator living in that
  directory, not the machine: it returns a result and throws nothing.)
- **The ledger and the package.** Nothing it returns is sealed, hashed into a
  manifest, or appended anywhere. A proposal is not a decision.
- **The HTTP API and the console.** No route, no button. See D-009 for why the
  wiring was cut rather than rushed.
- **The generator's own spec gates.** It re-implements none of them. It runs
  `generateFlushMountPair` on the parent (a request that does not build was never
  printed, so there is nothing to amend) and then on the amendment, and reports the
  real refusal verbatim. A hand-rolled subset here could drift out of date against
  the generator; asking the generator cannot.
- **`insertSize` (FMF-009).** Not consulted, deliberately: the generator sizes the
  insert from the opening and the clearance itself, so a third fail-closed gate here
  would guard a number nobody reads.

`npm run amend` (`server/revision/demo-amend.mjs`) is the module's only caller outside
its own tests, and its whole demonstration surface: offline, deterministic,
argument-free, and it prints the sha256 of the parent and amended KCL for both parts
so the "only the insert moved" claim is a measurement a reader can reproduce rather
than a sentence. `demo-amend.test.mjs` pins that demonstration against its own data,
including the two places the printed text states an outcome — it renders the demo
over data where the panel moved, and over data where the two programs stopped
lining up, and requires the output to stop making the claim in each case.

Read that as the measurement it is, not as a rule about the generator. The amendment
writes **three** fields, not one — the clearance and both lead-in chamfer values
(`revision/amend.mjs:832-837`) — and the panel emitter reads the chamfer even though it
never reads the clearance (`generators/flushmount.mjs:272` rectangular,
`generators/flushmount.mjs:411` round, both destructuring the angle and the depth). The
panel comes out byte-identical in this demonstration because the two chamfer writes land
on the parent's own numbers: the angle is unchanged at 45°, and the parent's 0.8 mm
lead-in already clears the minimum for 0.2 mm per side, so the amendment keeps it. Had
the correction needed a deeper lead-in, the panel program would have changed too — and
should have. What the hashes prove is that clearance alone does not reach the panel; they
do not promise the panel can never move.

## The fastening reference: rules as data, citations as schema, fail-closed verification

Fastening rules live in `server/reference/` as frozen data, not prose: each rule is
`{id, parameter, value|formula, basis, source, verification}` where `source` pins the
exact document/chapter/paragraph (AC 43.13-1B or FAA-H-8083-31A) and `formula` carries
both a callable and its plain-text form ("2 × fastener diameter"). No model call is
involved — AI parses intent, the reference computes parameters deterministically.
The compliance stance is fail-closed: every encoded value ships `PENDING_OPERATOR`
and `lookup.mjs` throws `UnverifiedRuleError` until a certificated person compares
the row against the printed text and signs it off in `docs/VERIFICATION_LOG.md`
(flipping the rule's status in the same commit). Callers may opt into drafts with
`{allowDraft: true}`, and every draft result is watermarked "DRAFT — NOT VERIFIED".

## Engine websocket protocol (measured, not assumed)

`wss://api.zoo.dev/ws/modeling/commands?webrtc=false`. Auth is a post-upgrade JSON
frame (`{"type":"headers","headers":{"Authorization":"Bearer <tok>"}}` — the `?token=`
query param is silently ignored, FN-013). Commands ride
`{"type":"modeling_cmd_req","cmd":{...},"cmd_id":"<uuid>"}` and correlate by uuid;
observed round-trips ~50 ms — four orders of magnitude faster than text-to-cad. A
10 mm cube built from 7 commands measures center (5,5,5), dims (10,10,10) exactly
(FN-015), and `export2d` returns genuine AC1014 ASCII DXF in ~54 ms (FN-016).
Rerunnable evidence: `server/spikes/ws-modeling-spike.mjs`.

## Day-1 thin thread (what exists right now)

`server/day1-thinthread.mjs`: prompt → `POST /ai/text-to-cad/{format}?kcl=true` → poll →
write KCL + exported files to `samples/` → `POST /file/mass` on the export for a
validation readout. Plain Node fetch, no dependencies.

## The review API and console

`server/api/server.mjs` (`node:http`, zero dependencies) is a thin HTTP door onto the
same flat-file job store the CLI pipeline writes — one `dataDir`, so a job created by
`npm run demo`, `npm run job`, or `POST /api/jobs` all land in the same `GET /api/jobs`
list.

```
GET  /health                        liveness
GET  /api/jobs                      list, newest first
POST /api/jobs                      { request, backend } -> 202 { jobId }
GET  /api/jobs/:id                  job + ledger + ledgerVerified + gates + manifest
POST /api/jobs/:id/decision         { action: approve|revise, actorName, reason? }
GET  /api/jobs/:id/files/*          package bundle files, streamed
```

`POST /api/jobs` does not await the pipeline: it watches the new job's ledger file
for the breadcrumb `runJob()` writes on its first transition (`reason: "request
file: <path>"`), so the 202 response's `jobId` is real before generation has even
started — every later outcome, success or failure, still lands through the state
machine and reads back on the next `GET`. The decision route is the machine's HUMAN
gate lifted to HTTP verbatim: `actorName` is still required, `revise` still refuses
without a `reason`, and both actions still go through `store.transition()` — the API
grants no authority the CLI didn't already have. The files route resolves every
request against the job's own bundle directory and rejects any path that would
resolve outside it (`abs.startsWith(bundleDir + sep)`), so a crafted `../` segment
400s instead of walking off the package.

Nothing on this API authenticates, so the two POST routes are fenced by where the
server listens and who is allowed to talk to it. `server/index.mjs` binds `127.0.0.1`
with no environment override, and every state-changing request must carry
`content-type: application/json` (else 415) and either the console's `Origin` or none
at all (else 403). The threat is specific and it is not CORS: a plain HTML form on any
page the operator is browsing can POST to a localhost port, the same-origin policy does
not stop form submissions, and the CORS block only decides who may *read* a response —
which a form never needs to do. A form cannot send `application/json`, and a script
that does is preflighted into the OPTIONS handler, which admits the console only.
Origin-absent is admitted deliberately (curl, operator scripts); the reasoning is in
`server/api/server.mjs` beside the check. `server/api/listen.test.mjs` drives the real
boot file and reads the bound host back off the listening socket; the forgery guards in
`server/api/api.test.mjs` try the whole form-enctype vocabulary and three foreign
origins against a job parked at the gate, and assert the job did not move.

`app/` is a thin client: it polls the API (2 s on the job-detail view), renders
whatever the API returns, and holds no Zoo credentials at all — the footer says so
on every screen except the Zookeeper panel, which says something stronger (below).
Four views, no router (`react-router` is not installed on purpose): job list, new
job, job detail, and the Zookeeper draft panel.

## The intent layer: Zookeeper drafting panel

`app/src/lib/zookeeper.ts` is a native client for Zoo's ML copilot websocket
(`wss://api.zoo.dev/ws/ml/copilot`), written from the reference client's own
SPECIFICATION.md rather than depending on that package: `web-zookeeper` is credited
as the reference but not installed, because it is unpublishable as released — its
`dist/` is not committed and there is no `prepare` script, so
`npm i github:KittyCAD/web-zookeeper` installs a package whose declared entrypoint
does not exist (FN-025). Everything the client below assumes about the wire was
measured live instead, in `server/spikes/ws-copilot-spike.mjs` (FN-025..028).

Connection phases (`ConnectionPhase`):

```
idle --connect()--> connecting --(handshake)--> ready --disconnect()--> closed
                                               |
                                               +-> failed   (pre-ready error, or any close that is not disconnect()'s own)
```

Structure follows the same pure-reducer shape used by the state machine and the
fastening reference: `classifyFrame` (one server frame → a typed `ServerFrame`) and
`applyFrame`/`beginTurn` (frame + `SessionAggregate` → next aggregate + effect) carry
zero socket or DOM dependencies, and are the entire surface `zookeeper.selfcheck.ts`
exercises — recorded frame fixtures run through the same pure functions the browser
runs live, including FN-026's one-time spurious-auth swallow and FN-027's
content-keyed duplicate dedupe. `ZookeeperClient` wraps a browser `WebSocket` around
that reducer: open → send the auth frame → wipe the token → wait for the first
server payload before sending anything else (racing ahead risks the socket being
closed, FN-026) → `list_modes` → `conversation_id` → ready to draft.

Token boundary, in words: the token is entered at runtime, held in memory only,
sent once inside the auth frame straight from the browser to Zoo, and wiped the
instant that frame is on the wire — and again on disconnect. The backend is never
in this path; see the README's operator-mode section for why no proxy exists.

The self-check gate is wired into `npm test` itself, not just dev-mode console
warnings: `node --experimental-strip-types app/src/lib/zookeeper.selfcheck.ts` runs
as the suite's last step, prints `self-checks: N passed`, and exits non-zero on any
failure. The same fixtures also run on every `npm run dev` boot (`main.tsx`,
dev-only, `console.warn` on failure) — a regression to the reducer shows up before
a real prompt is ever sent.

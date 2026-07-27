# Decision Log

Decisions that shape the build, with the reasoning at the moment they were made.

---

## D-001 · 2026-07-22 · Scope: fastening features, not a patch generator
The knowledge core codifies **holes, fasteners/bolted joints, edge distance, and flush
mounting** as machine-readable rules with citations, sourced from public-domain FAA
acceptable-practice data (AC 43.13-1B). We are **not** building a sheet-metal repair
patch generator. Rationale: these features are native, first-class operations in Zoo's
kernel; the gap is that they are hard to *say*. Building intent-level tools for them
improves the platform for every developer instead of shipping one vertical app.
The demo slice (a flush-mounted bracket/bezel) exists to exercise holes + countersinks +
fastener selection in one small part.

## D-002 · 2026-07-22 · Trust-layer loop is the product frame *(correction appended 2026-07-27)*
Generate → validate → document → (human approve) → revise. The bracket is the demo; the
reusable pattern — typed rule reference, validation gate, documented output package,
revision trail — is the product. README and demo video lead with this.

*Correction (2026-07-27).* The body above stands as written — it is the frame, and the
frame held. What it does not say, and what a reader could fairly take from it, is that
all four legs are equally finished. Three are: generate, validate and document run end
to end in `npm run demo`. **Revise is half-built, and the halves are worth naming.**

Built: a human at the gate can request a revision (`POST /api/jobs/:id/decision`,
`api/server.mjs:335` — named actor and a reason both required), the state map carries
`REVISION_REQUESTED -> DRAFT` (`state/states.mjs:77`), the store bumps the job's `rev`
across it (`state/store.mjs:171`), and that walk is exercised end to end
(`state/state.test.mjs:66`). Also built, as of today: `revision/amend.mjs`, which turns
a caliper reading into an amended request with its work shown, demonstrated by
`npm run amend`.

Not built: anything that connects those two. No route, no console control and no runner
path drives `REVISION_REQUESTED -> DRAFT`, so the only caller that has ever walked that
edge is a test, and the amendment module is not called from the pipeline at all. D-009
is why that gap was left open deliberately rather than closed badly.

## D-003 · 2026-07-22 · Node backend, dependency-light *(amended 2026-07-25)*
Dependency-light above all: the backend is plain ESM JavaScript (`.mjs`) importing
nothing but `node:` builtins, so `npm run demo` runs from a fresh clone with no install
step at all. TypeScript is used where it pays — the `app/` console (React + Vite) — and
nowhere under `server/`.

*Amendment (2026-07-25).* Both the heading and the body above were rewritten on this
date. The 2026-07-22 entry read, in full and verbatim (`git show
d4adfb4:docs/DECISION_LOG.md`):

> ## D-003 · 2026-07-22 · TypeScript/Node backend, dependency-light
> One language across backend and web UI. The day-1 thin thread is plain Node 18+ fetch
> with zero npm dependencies so `npm run demo` works from a fresh clone with no install.

Two of those claims did not survive the build. "TypeScript/Node backend … one language
across backend and web UI": `server/` shipped as `.mjs` with no `.ts` file in it, so the
repo runs two languages, not one. "Node 18+": the repo's declared floor is
`engines: {"node": ">=22.6"}` (`package.json`), and no build of this repo has been
executed on 18. The third claim — zero npm dependencies, fresh clone, no install — held,
and is the part carried forward. What each half is actually verified on is in the
README's "Node versions" section, which keeps declared floors and executed runtime
visibly apart, because they are not the same kind of claim.

## D-004 · 2026-07-22 · Local state first *(amended 2026-07-26)*
`StateStore` interface with a **flat-file** local implementation as the headline store, so
a judge reproduces everything with zero third-party setup. Cloud sheet storage stays
possible behind the same interface and deliberately unbuilt — it is not the architecture.

*Amendment (2026-07-26).* The body above was rewritten on this date. The 2026-07-22 entry
read, in full and verbatim (`git show d4adfb4:docs/DECISION_LOG.md`):

> ## D-004 · 2026-07-22 · Local state first
> `StateStore` interface with a local JSON/SQLite implementation as the headline store, so
> a judge reproduces everything with zero third-party setup. Cloud sheet storage is an
> optional integration behind the same interface, not the architecture.

"JSON/**SQLite**" did not survive the build, and nothing ever moved toward it: no SQLite
file, schema, or driver import exists anywhere in the repo, and after this amendment,
every hit `grep -rni sqlite` finds across `docs/`, `server/`, `app/src` and
`package.json` is inside this D-004 entry. The shipped store is flat files only: one JSON
snapshot per job at `<dataDir>/jobs/<jobId>.json` plus one append-only, hash-chained JSONL
ledger at `<dataDir>/jobs/<jobId>.ledger.jsonl` (`server/state/store.mjs:99-102`). The rest
of the entry held. The interface is real (`StateStore` typedef,
`server/state/store.mjs:43-51`) and `LocalStore` is the only implementation of it in the
repo — the second sentence is now written as the design position it always was, rather than
present tense that could be read as a shipped integration.

## D-005 · 2026-07-22 · Async generation is mandatory
Measured text-to-CAD latency spread (~5 s trivial solid → minutes for fastening
features, FN-005) makes background execution + notify a hard requirement. No UI blocks
on generation.

## D-007 · 2026-07-22 · Sourcing the fastening reference: verify, don't invent
The FAA's canonical AC 43.13-1B PDF refuses automated fetch (403); Ch. 4 Sec. 4 text
was recovered from a mirror of the official section PDF. Read verbatim and encoded
with exact citations: para 4-57c(1) (edge distance ≥ 2D, spacing ≥ 3D) and 4-57g(3)
(rivet dia ≈ 3 × thicker sheet). Figure 4-5 (multi-row minimums) is a scanned image —
values unreadable, deliberately NOT encoded. Flush-head 2.5D, preferred values, and
typical pitch practice are AMT-handbook material, encoded citing FAA-H-8083-31A with
paragraph "UNCONFIRMED" rather than an invented AC paragraph. Every rule ships
PENDING_OPERATOR regardless of source until checked against the printed text
(docs/VERIFICATION_LOG.md).

## D-006 · 2026-07-22 · License MIT
Maximum remixability; matches the contest's remix-and-expand theme. (Revisit before the
repo goes public if a different open license is preferred.)

## D-008 · 2026-07-25 · Account identity is scrubbed forward, and guarded by fingerprint
The two replay fixtures (`samples/plain-plate/validation.json`,
`samples/plain-plate-stl/validation.json`) are captured `GET /file/mass` responses, and a
captured response carries the account that made the call: `user_id` held the operator's
real Zoo account uuid. The replay backend reads both files into `replayedRecords`, so the
value travelled into every generated bundle (`logs/apiRun.json`) and out to a browser
through `GET /api/jobs/:id/files/logs/apiRun.json`, which streams bundle files verbatim —
and every path-leak scan in the repo stayed green over it, because `MACHINE_PATH`
(server/lib/repo-path.mjs) knows path *shapes* and an account uuid has none.

The HTTP channel is stated precisely because the first version of this entry got it wrong.
It said the value went out "through the API's job-detail payload", a claim inherited from
the task brief and never checked. Measured, with a synthetic uuid planted in the fixture
and the real API driven end to end: `GET /api/jobs/:id` returned 7,929 bytes with **zero**
occurrences — it composes `job`/`ledger`/`ledgerVerified`/`gates`/`manifest`/`warnings` and
never touches `replayedRecords` — while `GET /api/jobs/:id/files/logs/apiRun.json` returned
1,520 bytes with one. The detail payload does carry `manifest.files`, which advertises
`logs/apiRun.json`, so the file route is one click from the console. Both channels are now
pinned by a test (server/api/api.test.mjs) rather than by a sentence.

Three decisions:

**Scrub forward, not backward.** Both fields now read the RFC 9562 Nil UUID
(`00000000-…-000000000000`) — same key, same string type, self-evidently "no such
account". History is not rewritten. The in-window commit timestamps are the contest's
evidence that this repo was built from scratch inside the window, and a `user_id` is an
identifier, not a credential: nothing is revoked by editing it out of a past commit, and
the audit trail is worth more than the erasure.

**A second detector, not a case in the first one.** server/lib/identity.mjs is separate
from the path detector on purpose. It matches two things: identifiers already known to be
the operator's, and — the forward-looking half — any uuid sitting in a field whose *name*
means account (`user_id`, `org_id`, `account_id`, `customer_id`, `billing_id`,
`owner_id`). The shape rule is what catches a fixture captured tomorrow from an account
nobody has ever fingerprinted. Job, run and metering handles (`id`, `request_id`,
`conversation_id`, `api_call_id`, `textToCadId`) are deliberately NOT account fields —
they name an artifact, not a person.

That rule reads the *key*, not the punctuation around it: it walks backwards from each
uuid and strips the separators, so all of `"user_id":"…"`, the escaped `\"user_id\":\"…\"`
a stringified record takes inside a ledger reason, the unquoted `user_id: …` of a YAML or
field-note snippet, `'user_id'`, `org-id`, `user.id`, `{"user":{"id":…}}` and prefixed
forms like `end_user_id` collapse to the same trail. The first version anchored on the
opening quote and caught two of those ten; the widening is measured, and the walk stops at
a comma or a newline so an account word loose in prose cannot claim the next uuid it
happens to precede.

**Fingerprints, never literals.** A detector that spells out the identifier it hunts has
republished it, and the detector is itself a tracked file inside the corpus it sweeps. So
identity.mjs stores one-way SHA-256 commitments; a uuid's ~122 bits make the digest a
check and not a copy. The same reasoning drives the control token being assembled from
pieces rather than written out. Every `scanIdentity()` call runs a three-probe self-test —
one probe per rule plus a negative — and refuses to return a verdict at all on an empty
corpus, a zero-byte corpus, or a scanner that fails its own probes. Failure messages carry
a locator, not the value: 8 hex of a uuid is greppable and identifies nobody, but 8
characters of an email is most of the local part, so an address is withheld outright and
the file name plus the digest prefix do the locating instead.

Wired into `npm test` in three places: the working-tree contents of every git-tracked path
(server/lib/identity.test.mjs — the index, not HEAD, so an uncommitted leak is caught while
it can still be stopped), every file of a freshly generated bundle plus its ledger reasons
and manifest warnings (server/pipeline/pipeline.test.mjs), and both HTTP channels
(server/api/api.test.mjs).

## D-009 · 2026-07-27 · The amendment ships as a pure module, and the wiring does not

`server/revision/amend.mjs` — a caliper reading plus a cited band becomes an amended
request — landed **unwired**: no route, no console control, no ledger row, and no
pipeline path that drives `REVISION_REQUESTED -> DRAFT`. Its only caller is
`server/revision/demo-amend.mjs` (`npm run amend`). This entry records why, because
"we ran out of time" is the explanation a reader will assume and it is not the one.

The wired version was designed three times, adversarially, and each pass killed the
design it was reviewing. Every one of the four findings below is a defect in *our*
plan, not a limitation of Zoo's APIs:

1. **The demonstration lane would have lied about mass.** The plan was a second
   pipeline lane that "re-ran" a job with the amended request. The replay backend
   reads its artifacts from a fixture directory (`pipeline/backends.mjs:46`), so a
   revised run has to be pointed at a *different* fixture directory — and the mass
   gate then compares that different mesh against the request's `expectedMassG`. The
   revision would have shown a mass delta, on stage, that came from swapping fixtures
   and not from the amendment. A demo whose headline number is an artefact of its own
   plumbing is worse than no demo.
2. **The concurrency fix deadlocked every job.** Re-entering a job at `DRAFT` means
   two walks can touch one job, which argues for serialising `transition()`. It
   cannot be serialised naively: `runValidation()` calls `this.transition` twice
   (`state/store.mjs:190` on the invalid branch, `:198` on the valid one), so a lock
   taken around a transition and held across the call deadlocks the *happy path* of
   every job in the repo, not just revised ones. The store is the load-bearing piece
   of this build. It was put out of scope rather than rewritten in an afternoon.
3. **The resume path walked around the live-spend gate.** Re-entering a job at
   `DRAFT` re-enters it with its backend already chosen. `--backend=live` is gated on
   an explicit `TOOLCRIB_ALLOW_LIVE` at the two entry points that exist
   (`pipeline/run-job.mjs:339`, `api/server.mjs:255`); a third entry point that
   resumes an existing job inherits the backend and does not pass either check. That
   is a revision that quietly spends real API minutes, which is exactly the class of
   surprise this repo exists to prevent.
4. **The PDF assertions were unsatisfiable as specified.** "The amendment appears in
   the manufacturing PDF" was to be pinned by asserting the amended clearance and its
   citation appear in the rendered document. They cannot be: `package/pdf.mjs` wraps
   text (`wrapText`, `pdf.mjs:35`) and emits each wrapped line as its own `Tj`
   operator, so a multi-word string never appears contiguously in the file. Assert on
   the model, not on the PDF.

**The decision.** Ship the reasoning, not the plumbing. A pure module is honest about
what it is: it computes a proposal, it labels every number `cited` or `computed`, it
refuses to invent a fact about the parent part, and it can be read, tested and
demonstrated without a store, a job or a network. `npm run amend` makes it a runnable
artifact rather than a described one — it prints the sha256 of the parent and amended
KCL for both parts, so the claim that the amendment moved the insert and left the panel
byte-identical is a measurement anyone can reproduce in one command.

**The cost, stated.** The loop is not closed. A judge who wants to click "Request
revision" and watch rev 2 appear cannot, and README, ARCHITECTURE and D-002 now all say
so in those words rather than leaving the diagram to imply otherwise. Closing it is the
next increment, and the order it has to happen in is: serialise the store safely
(finding 2), give the resume path its own spend gate (finding 3), then wire the route.

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

## D-002 · 2026-07-22 · Trust-layer loop is the product frame
Generate → validate → document → (human approve) → revise. The bracket is the demo; the
reusable pattern — typed rule reference, validation gate, documented output package,
revision trail — is the product. README and demo video lead with this.

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

## D-004 · 2026-07-22 · Local state first
`StateStore` interface with a local JSON/SQLite implementation as the headline store, so
a judge reproduces everything with zero third-party setup. Cloud sheet storage is an
optional integration behind the same interface, not the architecture.

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
value travelled into every generated bundle (`logs/apiRun.json`) and out through the API's
job-detail payload — and every path-leak scan in the repo stayed green over it, because
`MACHINE_PATH` (server/lib/repo-path.mjs) knows path *shapes* and an account uuid has none.

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

**Fingerprints, never literals.** A detector that spells out the identifier it hunts has
republished it, and the detector is itself a tracked file inside the corpus it sweeps. So
identity.mjs stores one-way SHA-256 commitments; a uuid's ~122 bits make the digest a
check and not a copy. The same reasoning drives the control token being assembled from
pieces rather than written out. Every `scanIdentity()` call runs a three-probe self-test —
one probe per rule plus a negative — and refuses to return a verdict at all on an empty
corpus, a zero-byte corpus, or a scanner that fails its own probes. Wired into `npm test`
in two places: every tracked file at HEAD (server/lib/identity.test.mjs) and every file of
a freshly generated bundle (server/pipeline/pipeline.test.mjs).

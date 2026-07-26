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

*Amendment.* As written on 2026-07-22 this entry said "TypeScript/Node backend — one
language across backend and web UI" and cited a "Node 18+" floor. Neither claim
survived the build, so the entry is corrected rather than left standing: `server/`
shipped as `.mjs` with no `.ts` file in it, and the repo's declared floor is
`engines: {"node": ">=22.6"}` (`package.json`). What the two halves are actually
verified on is stated in the README's "Node versions" section — declared floors and
executed runtime kept visibly apart, because they are not the same kind of claim.

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

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

## D-003 · 2026-07-22 · TypeScript/Node backend, dependency-light
One language across backend and web UI. The day-1 thin thread is plain Node 18+ fetch
with zero npm dependencies so `npm run demo` works from a fresh clone with no install.

## D-004 · 2026-07-22 · Local state first
`StateStore` interface with a local JSON/SQLite implementation as the headline store, so
a judge reproduces everything with zero third-party setup. Cloud sheet storage is an
optional integration behind the same interface, not the architecture.

## D-005 · 2026-07-22 · Async generation is mandatory
Measured text-to-CAD latency spread (~5 s trivial solid → minutes for fastening
features, FN-005) makes background execution + notify a hard requirement. No UI blocks
on generation.

## D-006 · 2026-07-22 · License MIT
Maximum remixability; matches the contest's remix-and-expand theme. (Revisit before the
repo goes public if a different open license is preferred.)

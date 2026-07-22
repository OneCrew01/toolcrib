# Architecture

*Day-1 stub — grows with the build. See DECISION_LOG for the why behind each piece.*

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

## Components

- **`server/`** — TypeScript/Node backend. Holds the Zoo API token; the only thing that
  talks to Zoo. Exposes a small HTTP API to the UI.
- **Fastening reference** — typed rules/tables, each value carrying its source citation
  (public-domain FAA acceptable-practice data). Deterministic: no model call is needed
  to look up a rule. AI parses intent; rules compute parameters.
- **StateStore** — interface; local implementation first (see D-004). Append-only
  transition ledger per job.
- **`app/`** — thin web client. Never holds a key, never calls Zoo directly.

## Day-1 thin thread (what exists right now)

`server/day1-thinthread.mjs`: prompt → `POST /ai/text-to-cad/{format}?kcl=true` → poll →
write KCL + exported files to `samples/` → `POST /file/mass` on the export for a
validation readout. Plain Node fetch, no dependencies.

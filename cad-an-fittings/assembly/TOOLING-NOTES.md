# Zoo Tooling & Language Notes

**2026-07-30.** Separated from `ENGINE-LIMITS.md` per Zoo Keeper review #3 —
none of the below is a geometry-engine acceptance criterion, and mixing them
in diluted the assembly case.

---

## 1. `mock_execute_kcl` does not validate engine topology capability

**Class:** tooling / workflow. **Severity: high, because it misleads.**

Mock execution passed all three of the following before the real engine
rejected them:

- `union([extrude, sweep])` — ENGINE-LIMITS §1
- `union([loft, extrude])` — ENGINE-LIMITS §2
- a non-G1 sweep path — ENGINE-LIMITS §5

Mock validates syntax and semantics. It does **not** validate that the engine
can build the requested topology.

> **A green mock is not evidence that a model builds.**

This inverts the usual cheap-check-first instinct and was the single largest
source of wasted iterations in this build. After adopting "render is the real
test", the next build rendered clean first try.

**Suggested fix:** either have mock exercise the same topology paths, or label
its success clearly as syntax-only so nobody reads it as a build guarantee.

---

## 2. Definition-order errors are reported at the importing file

**Class:** language diagnostic. **Severity: low, but wastes time.**

`parameters.kcl` failed twice with a value used before its declaration —
`bracketT`, then `washerT` — each time because a derived export referenced a
constant declared later **in the same file**.

The diagnostic reads:

```
semantic: Error loading imported file (...parameters.kcl). Open it to view more details.
  `washerT` is not defined
   ╭─[19:1]
19 │ import * from "parameters.kcl"
```

The caret points at the `import` line in `main-rev2.kcl` — a different file
from the actual error. The message does say which file to open, but gives no
line number within it.

**Suggested fix:** report the line in the source file where the undefined
symbol is referenced.

---

## 3. `/org/*` endpoints return 403

**Class:** account / API access. **Not an assembly or geometry concern.**

```
list_org_skills → HTTP 403 Forbidden: GET https://api.zoo.dev/org/skills
```

The geometry engine, KCL samples and docs endpoints all work normally on the
same credentials. Likely an org-membership permission rather than a fault.
Recorded only so it is not mistaken for an engine problem.

---

## 4. Snapshot camera behaviour

**Class:** tooling ergonomics. **Severity: cosmetic.**

`snapshot_of_kcl` defaults to `zoom = true`, which re-fits the whole model and
silently overrides the `vantage` distance in a custom `camera_view`. Setting
`zoom = false` honours the vantage, but the camera then works in model units,
so a vantage chosen for the fitted view lands inside the geometry and renders
a blank or solid-colour frame.

Not a bug, but worth documenting: **custom camera distance and zoom-to-fit are
mutually exclusive**, and there is no feedback when zoom silently wins.

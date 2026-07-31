# Zoo Geometry Engine — Observed Limits

**2026-07-30.** Reproduced directly against the live engine while building the
AN-4 assembly benchmark. Classified per Zoo Keeper review #3.

Scope: **geometry engine behaviour only.** Tooling and language-diagnostic
observations are in `TOOLING-NOTES.md` so they do not dilute the assembly case.

---

## 1. `union([extrude, sweep])` is rejected — BLOCKER

```
engine: The Zoo engine cannot handle this 3D union yet. Please report this as an issue
```

Minimal deterministic reproducer:

```kcl
@settings(defaultLengthUnit = in, kclVersion = 2.0)
shank = startSketchOn(XY) |> circle(center = [0,0], radius = 0.1875) |> extrude(length = 0.44)
th    = helix(angleStart = 0, ccw = true, revolutions = 8, length = 0.43, radius = 0.21875, axis = Z)
ridge = startSketchOn(XZ)
  |> startProfile(at = [0.1875, 0.005])
  |> line(end = [0.03125, 0.022])
  |> line(end = [-0.03125, 0.022])
  |> close()
  |> sweep(path = th)
threadedStud = union([shank, ridge])   // rejected
```

**Impact — this is the most consequential limit found.** A swept helical thread
cannot be combined into the fitting it belongs to. Downstream:

- `an815Thread` must remain a separate body, labelled cosmetic
- `an818Nut` must use a plain bore, because there is no point cutting a real
  female helix when no male counterpart can exist as one solid
- **no thread mesh, engagement or interference can be evaluated at all**

Any threaded-fastener assembly benchmark is blocked on this.

---

## 2. `union([loft, extrude])` is rejected — BLOCKER

Same error text. A `loft()` result cannot be unioned with an extrude.

**Impact:** a 37° flare cone cannot be joined to its tube, and a flare seat
cannot be added to the AN815 union body. The flare geometry is therefore
absent from this model, and is documented as absent rather than faked with a
named datum.

---

## 3. `union()` rejects coincident faces

Two solids sharing an exact planar boundary are rejected. Workaround used
throughout: a deliberate `bodyOverlap = 0.020`, **intra-part only**.

**Note this forces a modelling compromise:** the engine requires overlap to
build a single part, while good assembly practice requires no overlap between
parts. The package keeps these strictly separate.

---

## 4. Some multi-body unions fail at low body counts

**Corrected classification (review #3).** Earlier wording claimed a body-count
limit. That is not supported by the evidence.

Failures were observed at **9 bodies** and also at **3 bodies**. Failure at
both counts indicates the determining factor is **not** body count — topology,
body lineage, contact type, or the combination of input kinds is more likely.

> Some multi-body unions fail at low body counts. **No reliable body-count
> threshold has been established.**

The smallest deterministic reproducer available is §1 above: **two bodies**,
one extrude and one sweep. That suggests input *kind* rather than *quantity*
is the real variable, and §1 should be treated as the canonical case.

---

## 5. `sweep()` G1 continuity — diagnostic and ergonomics, not a defect

```
engine: Trajectory curve must be G1 continuous (with continuous tangents)
```

**Corrected classification (review #3).** The rejection itself is
*geometrically correct*. If a `tangentialArc` turns 85° and the following
segment is axis-aligned, that line genuinely is not tangent to the arc exit.
The engine is right to refuse it. Earlier wording framed this as an engine
defect; it is not.

The real, useful complaints are:

1. **Tangent continuation is hard to express.** There is no obvious way to say
   "continue along the arc's exit tangent for distance *d*" — the author must
   compute the exit direction by hand and hope it matches.
2. **The API does not offer automatic tangent continuation.**
3. **The diagnostic does not identify the offending junction.** It names the
   `sweep()` call, not which segment pair broke tangency, so on a multi-segment
   path the author must bisect manually.

Practical consequence worth documenting for users: arcs must be exactly ±90°
before an axis-aligned run, and the sign is CCW-positive — heading `+Z`, use
`-90` to exit toward `+X`. That is a *usage note*, not a bug report.

---

## 6. Suggested priority

1. §1 — unblocks all threaded-fastener assemblies
2. §2 — unblocks flare, chamfer and transition geometry
3. §5.3 — a clearer diagnostic naming the non-tangent junction
4. §3 — accepting coincident faces would remove the overlap compromise

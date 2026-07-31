# AN-4 Hose / Adel Clamp — Assembly Acceptance Test

**Rev 3 · 2026-07-30** — corrections from Zoo Keeper review #3.
Entrypoint: **`main-rev2.kcl`** (there is deliberately no `main.kcl`, see §0).

---

## 0. Response to review #3

| Finding | Status |
|---|---|
| Two-diameter rule violated by own geometry | **Fixed.** `hoseStraight` now *derived* from `minStraightFromFitting`. Was 0.550 against a 1.000 requirement — a real bug. |
| `hoseOD` not derived from `hoseOR` | **Fixed.** `hoseOD = 2.0 * hoseOR`. |
| Union/socket mating face does not exist | **Fixed properly.** `unionSeatZ` **deleted**, not renamed. Socket now seats on the nut collar top — real geometry. See §2. |
| Bracket contains assembly knowledge | **Fixed.** Mounting face at local `y = 0`; assembly places it. |
| Fastener file is a subassembly | **Fixed.** Split into `an3Bolt`, `an960Washer`, `an365Nut`. |
| Bolt morphs to fit the stack | **Fixed.** `requiredGrip` computed, discrete `boltGripSelected` chosen, `gripMargin` reported. |
| "Seated" but 0.005 gap | **Fixed.** Model state declared **assembled and tightened**; bearing contact = 0. |
| `clampSlide` unbounded | **Fixed.** `clampSlideMin/Max` derived, range check documented. |
| "One part per file" overclaim | **Fixed.** Terminology corrected to *logical assembly components, some multi-body*. |
| Stale monolithic file in package | **Fixed.** Moved to `archive/rev1-monolithic-reference.kcl`. |
| §5.4 body-count claim too broad | **Fixed.** Rewritten, ENGINE-LIMITS §4. |
| §5.5 framed as engine defect | **Fixed.** Reclassified as ergonomics + diagnostics, ENGINE-LIMITS §5. |
| `/org` 403 diluting the case | **Fixed.** Moved to TOOLING-NOTES §3. |
| Definition order misclassified | **Fixed.** Now a language diagnostic, TOOLING-NOTES §2. |
| `main.kcl` shadowed in sandbox | **Fixed.** Entrypoint renamed `main-rev2.kcl`; no `main.kcl` exists in this package. |

---

## 1. Structure

```
assembly/
├── parameters.kcl        dims, clearances, DERIVED placement, provenance
├── an815Union.kcl        union + cosmetic thread
├── an818Nut.kcl          coupling nut
├── an4Hose.kcl           socket + swept hose
├── adelClamp.kcl         split cushion/band + two ears
├── supportBracket.kcl    structure (assembly-independent)
├── an3Bolt.kcl           bolt          — purchased part
├── an960Washer.kcl       washer        — purchased part
├── an365Nut.kcl          self-locking nut — purchased part
├── main-rev2.kcl         ENTRYPOINT: imports + transforms only
├── ENGINE-LIMITS.md      geometry-engine findings
├── TOOLING-NOTES.md      tooling / language findings
└── ASSEMBLY-ACCEPTANCE-TEST.md
archive/
└── rev1-monolithic-reference.kcl   superseded, do not review
```

**Terminology:** each file is a *logical assembly component*. Several remain
multi-body (union + cosmetic thread; hose + socket; clamp = cushion + band +
2 ears) because the engine cannot union the required primitives. **This
package does not claim one manufactured solid per file.**

---

## 2. The seat correction — what was actually wrong

Rev 2 exported `unionSeatZ = 0.830` and placed the socket there. Two faults:

1. The union's rigid body ends at `z = 0.720`, so the datum floated **0.110
   above any solid**.
2. Naming a coordinate does not create a face.

**The fix is not a longer union.** In a real AN joint the tube flare is
clamped between the union's 37° cone and the AN818 nut — nothing bears on an
exposed union face at all. So the stack was corrected to be physically true:

```
union hex top   z = 0.300   ← nut bearing face seats here      (real face)
nut collar top  z = 0.820   ← hose socket base seats here      (real face)
```

`unionSeatZ` was **deleted**. The 37° cone remains unmodelled because
`union([loft, extrude])` is rejected (ENGINE-LIMITS §2), and that absence is
stated rather than concealed behind a datum name.

---

## 3. Clearance policy

**Model state: ASSEMBLED AND TIGHTENED.**

| Interface | Value | Type |
|---|---|---|
| nut ↔ union hex | 0.000 | bearing contact |
| socket ↔ nut collar | 0.000 | bearing contact |
| ear A ↔ ear B | 0.000 | bearing contact |
| bracket ↔ ear B | 0.000 | bearing contact |
| cushion ↔ hose | 0.010 | **slip fit** — required by criterion 4 |
| nut bore ↔ thread | 0.005 | slip fit |
| nut collar ↔ tube | 0.010 | slip fit |
| `bodyOverlap` | 0.020 | **intra-part boolean only** — never between parts |

---

## 4. Expected behaviours

| # | Criterion | Status |
|---|---|---|
| 1 | Hose and fitting share a centre axis | ✅ both on world Z |
| 2 | Hose end meets a real fitting face without overlap | ✅ socket on nut collar top, contact = 0 (§2) |
| 3 | Clamp concentric with hose | ✅ bore derived from `hoseOR` |
| 4 | Clamp may slide along the hose axis | ✅ demonstrated; bounded `0.150 ≤ clampSlide ≤ 1.300` |
| 5 | Clamp ears align with support hole axis | ✅ both on `boltWorldZ` |
| 6 | Bolt passes through both ears and bracket | ✅ grip 0.180, selected 0.1875, margin 0.0075 |
| 7 | Parts remain separate bodies | ✅ no boolean in `main-rev2.kcl` |
| 8 | Changing hose bend/diameter updates relationships | ✅ all derived from the path |

**Straight-run rule, now self-enforcing:**

```
hoseOD                 = 2.0 * hoseOR              = 0.500
minStraightFromFitting = 2.0 * hoseOD              = 1.000
hoseStraight           = minStraightFromFitting + 0.100 = 1.100   PASS
```

Previously 0.550 against a 1.000 requirement. Deriving it from the rule means
the violation cannot silently recur.

---

## 5. Remaining gaps — stated plainly

- **Solver sketches not converted.** All files are `kclVersion = 2.0` and the
  pipe API renders correctly under it, but profiles are **not** solver-backed:
  no proof of full constraint, dimensions embedded in profile construction, no
  relational sketch constraints, datum drift undetectable. Largest formal gap.
- **Datums are metadata, not constraints.** Exported axes and faces are not
  checked against the solids. Nothing fails if geometry drifts.
- **No thread mesh.** Blocked by ENGINE-LIMITS §1.
- **No 37° flare geometry.** Blocked by ENGINE-LIMITS §2.
- **Range check is documentation, not an assert.** `clampSlideValid` is a flag
  a human must maintain.
- ~~**Thread specs unverified.**~~ **RESOLVED 2026-07-31.** 7/16-20 for AN-4 and
  9/16-18 for AN-6 are corroborated by two independent industry sources and are
  now `[CD]`. Governing standards identified: originally MIL-F-5509, now
  SAE AS4841/4842/4843/4875, flare form SAE J514. **Residual gap:** the thread
  SERIES (UNF vs military UNJF) is still unconfirmed - the size is right, the
  series designation is not asserted. Full table in
  `data/an-hardware.json` -> `fluidFittings.threadTable`.
  Original wording follows for the record: 7/16-20 for AN-4 was an `[A]` assumption; the FAA
  sources consulted never map thread size to AN fitting size.

---

## 6. Validation renders

| File | Shows |
|---|---|
| `rev3-assembly.jpg` | Rev 3 full assembly — note the longer straight run |
| `rev2-assembly.jpg` | `clampSlide = 0.600` |
| `rev2-clampslide-1150.jpg` | `clampSlide = 1.150` — clamp, bracket, fastener all moved |
| `assembly-nut-side.jpg` | ear / bracket / washer / nut stack |

Criterion 4 is demonstrated by diffing the two `clampslide` renders: one
parameter changed, nothing else edited.

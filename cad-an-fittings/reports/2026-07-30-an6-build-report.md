# AN-6 Flare Fitting — CAD Build Report

**Date:** 2026-07-30
**Author:** Claude (Opus 5), via Zoo MCP + NotebookLM MCP
**Deliverables:** `kcl/an6-flare-joint.kcl`, `kcl/an6-assembled.kcl`, `renders/`

---

## 1. What was built

A complete **AN-6 37° flared tube joint** modelled parametrically in KCL, with **real helical
threads** (not cosmetic grooves), rendered on the Zoo engine.

| Part | Standard | Modelled |
|---|---|---|
| Male union | AN815-6 | hex body, male 9/16-18 helical thread, 37° flare seat cone, through bore |
| Sleeve | AN819-6 | 37° cone + ring, bored for 3/8" tube |
| Tube | 3/8" OD | 37° flare formed by loft, bored |
| Coupling nut | AN818-6 | hex, internal thread bore, tube-clearance collar |

Two views: **exploded** (all four parts) and **assembled** (nut torqued onto union, tube exiting).

The threads are genuine helices — `helix()` generating the path, a trapezoidal profile
`sweep()` along it. Male thread is an added ridge; female is the same profile subtracted.
Because both use the same pitch and radii, they are geometrically matable.

---

## 2. Data provenance — what is grounded and what is not

Grounded via NotebookLM cross-notebook query against **AC 43.13-1B Ch.9** and the
**FAA AMT General Handbook** (found in *Aircraft Weight and Balance Handbook* and
*Part 147 Curriculum* notebooks).

### CONFIRMED by sources

| Fact | Value |
|---|---|
| Dash number meaning | tube OD in sixteenths → **AN-6 = 3/8" OD** |
| Flare angle | **37°** aviation. 45° automotive tools **prohibited** — cause misfit, stress, system failure |
| Double flare rule | **mandatory** on soft aluminium alloy tube **3/8" OD and under** |
| Joint hardware | **AN818 (MS20818)** nut + **AN819 (MS20819)** sleeve; **AN815** male union |
| Torque, AN-6 | aluminium **110–130 in-lb** · steel **270–300 in-lb** |
| Torque, AN-4 | aluminium **50–65 in-lb** · steel **135–150 in-lb** |
| Min bend radius, AN-6 | aluminium **15/16"** · steel **1-5/16"** |
| Material codes | D = aluminium (**blue**), no letter = steel (**black**), B = brass, Z = alu-bronze |
| Flexible hose slack | **5–8%** — never stretch tight between fittings |
| Assembly rule | nut + sleeve go on **before** flaring; lubricate with hydraulic fluid only; **never** compound on the flare face |

### NOT IN SOURCES — my own general knowledge, flagged in-file as `[ASSUMPTION]`

Both notebooks stated these are **absent** and must come from SAE AS50881, AS4841 or MIL-F-5509:

- **9/16-18 UNF** thread mapped to AN-6 (thread tables list the size, but never link it to the fitting)
- **11/16" hex across flats**
- All nut/union lengths, wall thicknesses, and the UNJF controlled-root-radius variant

**Consequence:** the joint's *proportions* are provisional. Its *standards, torques and
angles* are citable. Anyone using this model for anything load-bearing must verify the
thread spec against a real AN standard first.

---

## 3. Zoo engine findings

This is the part worth keeping. Several of these are undocumented and cost real iterations.

### 3.1 `mock_execute_kcl` is not a reliable gate — **most important finding**

Mock execution passed code the real engine then rejected, **three separate times**:
the multi-solid union, the loft-union, and the G1 discontinuity. Mock validates *syntax
and semantics*, not *engine geometry capability*.

> **Implication:** never treat a green mock as proof. Budget for a real render as the
> actual test. This inverts the usual cheap-check-first assumption.

### 3.2 `union()` limitations

Three distinct failure modes, all reported as engine errors, not KCL errors:

1. **Coincident faces fail.** Two solids sharing an exact planar boundary are rejected.
   *Fix:* overlap them deliberately (0.02" used throughout).
2. **Too many solids fail.** `"The Zoo engine cannot handle this 3D union yet.
   Please report this as an issue"` — hit at 9 bodies, and again at 3.
3. **A `loft()` result cannot be unioned with an extrude.** Same error text.
   *Fix:* never union a loft; subtract from each solid separately, using a **separate
   cutter solid per subtract** (cutters appear to be consumed).

*Working pattern:* union only same-kind extrudes, few at a time; do one subtract pass
with all cutters at the end; leave the rest as separate solids in the assembly.

### 3.3 `sweep()` requires G1 continuity

`"Trajectory curve must be G1 continuous (with continuous tangents)"`

A `tangentialArc` followed by a straight line only works if the arc turns **exactly 90°**
and the line runs along the arc's exit tangent. 85° and 88° both failed. There is no
tolerance — this is exact.

**Arc sign is CCW-positive.** A path heading +Y needs `angle = 90` to exit toward −X;
a path heading −Y needs `angle = -90` to exit toward −X.

### 3.4 What works well

- `helix(angleStart, ccw, revolutions, length, radius, axis)` — standalone, no cylinder needed
- `sweep(profile, path = helix)` for threads, both additive and subtractive
- `loft([sketchLo, sketchHi])` for cones and flares — clean, and the right tool for a 37° flare
- `polygon(radius, numSides, center)` for hex stock
- Pipe syntax (`startSketchOn |> ... |> extrude`) coexists fine with the newer
  constraint-solver `sketch(on=){}` syntax used in the official samples
- Custom cameras `{up, vantage, center}` — markedly better framing than the
  `isometric_*` presets for assemblies

### 3.5 Access note

`list_org_skills` returns **HTTP 403 Forbidden**. Org-scoped endpoints
(`/org/*`) are unavailable on this account; the geometry engine and samples are fine.

---

## 4. Budget

Constraint was **1000 Zoo API tokens**. Actual usage was well inside it — roughly
**20 Zoo calls total**, of which ~8 were engine renders and the rest were free-ish
sample/doc lookups and mock executions. The dominant cost was **re-renders forced by
mock passing bad geometry** (§3.1), not modelling itself.

---

## 5. Open items

1. **Verify the thread spec.** 9/16-18 for AN-6 is my assumption. Needs a real AN standard.
2. **Thread clocking.** Male and female threads share pitch and radii but are not phase-aligned,
   so they interpenetrate slightly when assembled. Externally invisible; would matter for
   a true motion/mate simulation.
3. **Motion/mating.** Zoo's MCP surface exposes no constraint or mate solver that I could find —
   assembly here is positional, not constrained. Worth confirming whether Design Studio
   proper has mates that the MCP does not expose.
4. **AN-4 variant.** Same file parameterised; only `tubeOR`, thread and hex change.
5. **Report the union limits to Zoo.** The error text explicitly requests it.

---

## 6. ADDENDUM — AN-4 hose assembly

Built `kcl/an4-hose-assembly.kcl`: AN815-4 union + AN818-4 nut + crimped hex socket
+ **-4 flexible hose swept with a real bore**.

### Parameter delta, AN-6 → AN-4

| Parameter | AN-6 | AN-4 | Basis |
|---|---|---|---|
| Tube OD | 0.375" | **0.250"** | CONFIRMED (dash = sixteenths) |
| Thread | 9/16-18 | **7/16-20** | ASSUMPTION |
| Major radius | 0.28125 | **0.21875** | derived from assumption |
| Hex across flats | 11/16" | **9/16"** | ASSUMPTION |
| Torque, aluminium | 110–130 in-lb | **50–65 in-lb** | CONFIRMED |
| Torque, steel | 270–300 in-lb | **135–150 in-lb** | CONFIRMED |
| Min bend radius, alu | 15/16" | **9/16"** | CONFIRMED |

Only the tube OD and torques are citable. The thread and hex remain provisional in both sizes.

### Hose

Swept `hoseOuter` minus `hoseInner` gives genuine wall thickness — the bore is visible at
the cut end. Routed on a **0.85" radius**, comfortably above the confirmed 9/16" minimum
bend for aluminium, and drawn with slack rather than stretched taut, per the confirmed
**5–8% slack** rule.

### Finding 3.1 validated in practice

Acting on §3.1, I **skipped mock execution** and went straight to a render as the real test.
The render immediately caught a genuine G1 failure that mock would have passed. One
round trip instead of two. The finding holds and is now load-bearing advice.

### Finding 3.3 recurred — the arc-sign trap is systematic

Hit `"Trajectory curve must be G1 continuous"` again, same root cause, different plane.
The rule, stated generally:

> A `tangentialArc(angle = +90)` from a path heading along the sketch's **+vertical**
> axis exits along **−horizontal**. To exit along **+horizontal**, use **−90**.
> This holds on XY (heading +Y → exits −X) and on XZ (heading +Z → exits −X) alike.

Getting this backwards is not a warning — it is a hard engine rejection. Worth a helper
function if much sweeping is planned.

---

## 7. ADDENDUM — MS21919 cushioned (Adel) clamp on the hose

Built `kcl/an4-hose-with-adel-clamp.kcl`: the AN-4 assembly with a cushioned loop clamp —
cushion sleeve, metal band, mounting tab, and an AN3 bolt.

### The clamp placement is rule-driven, not arbitrary

This is the most useful thing in this build. A confirmed rule **dictated the geometry**:

> Hose must run **straight for at least two hose diameters** from the end of the metal
> fitting before any bend or support clamp.

-4 hose OD is 0.50", so the minimum is **1.00"** of straight hose. Path length from the
socket to the modelled clamp is 0.53 straight + 1.335 arc + 0.75 horizontal ≈ **2.6"**.
Compliant, and the clamp sits on the straight horizontal run rather than on the bend.

The tab also rises **above** the loop with the bolt head on top, satisfying the confirmed
rule that attachment hardware goes above the clamp so line weight cannot rotate it into
chafing. Two independent confirmed rules are now encoded as geometry.

### Additional confirmed clamp data

- Flexible hose supported **at least every 24"**, 18" preferred
- **Bonded cushioned** clamps mandatory on metal fluid lines; **unbonded clamps are for
  electrical wiring only**
- Cushioned clamps wherever vibration exists; plain clamps only where there is none
- **Teflon cushion** required in Skydrol/hydraulic/fuel zones — but is *less resilient*
  than rubber and damps vibration worse
- MS21919 mounting bolt angular offset **max 45°** from the loop axis
- **AN735** = bare metal *bonding* clamp, not for fluid lines, and **prohibited in
  lightning zones 1A / 1B / 2B**
- **AN742** = plain uncushioned loop clamp, non-vibration zones only
- Metallic fuel lines bonded at **every** clamp point, **≤1 ohm** to structure

### ⚠ Two source conflicts found — both worth knowing

**1. AN737 torque values are contradicted across notebooks.**
The Part 147 notebook supplied "radial clamp (28 TPI) ≈ 25 in-lb, worm screw (10 TPI)
≈ 15 in-lb" with citations. Two other notebooks stated flatly that **AN737 is entirely
absent** from their sources. One of those notebooks appears to have generated
*suggested insertion text* for a curriculum gap and presented it alongside citations.
**Do not treat those torque numbers as sourced.** Logged as CONFLICTED in the KCL header.

*Lesson:* a cross-notebook query can return an LLM's proposed remediation text in a
shape that looks like a citation. Read what the notebook says is *missing* as carefully
as what it says is present.

**2. Two different rigid-line support spacing tables exist.**
AC 43.13-1B Ch.9 gives spacing by OD band (1/4"–5/16" → 12"). The AMT General Handbook
gives it per-OD and per-material (1/4" alu → 13.5", steel → 16"). These disagree. The
Part 147 notebook flagged this as a known examiner trap and recommends teaching both.
Not a modelling issue, but it matters for any ToolCRIB spacing lookup.

### Zoo: clean first-render

Notable — this build rendered **correctly on the first attempt, no engine errors**.
Every pattern from §3 was applied pre-emptively: solids overlapped rather than coincident,
a separate cutter solid per subtract, no loft in any union, arcs at exactly ±90° with the
sign chosen for the exit tangent. The findings in this report are therefore not just
post-hoc description — applied forward, they eliminated the iteration entirely.

---

## 8. Files

```
cad-an-fittings/
├── kcl/
│   ├── an6-flare-joint.kcl      exploded 4-part joint
│   ├── an6-assembled.kcl        nut torqued onto union
│   ├── an4-hose-assembly.kcl    AN-4 union + nut + socket + flex hose
│   └── an4-hose-with-adel-clamp.kcl   above + MS21919 cushioned clamp + AN3 bolt
├── renders/
│   ├── an6-exploded.jpg
│   ├── an6-assembled.jpg
│   ├── an4-hose-assembly.jpg
│   └── an4-hose-adel-clamp.jpg
└── reports/
    └── 2026-07-30-an6-build-report.md
```

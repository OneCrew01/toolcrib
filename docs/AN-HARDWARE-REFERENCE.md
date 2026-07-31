# AN/MS Standard Aircraft Hardware — Reference

**Machine-readable source of truth:** [`data/an-hardware.json`](../data/an-hardware.json)
**Compiled:** 2026-07-30
**Sources:** FAA **AC 43.13-1B/CHG 1** Ch.7 & 9 · **FAA-H-8083-30A** (AMT General)

Every value in the dataset carries a provenance flag. Nothing here is asserted
without one.

| Flag | Meaning |
|---|---|
| `C` | **Confirmed** — stated in the cited FAA sources |
| `A` | **Assumption** — general knowledge, explicitly *not* found in those sources |
| `X` | **Conflicted** — sources disagree; do not rely on |

---

## ⚠ Read this first: the AN dash number means two different things

This is the single most dangerous ambiguity in AN hardware, and it is why this
dataset exists.

| | Dash number means | AN-4 is | Thread |
|---|---|---|---|
| **Bolts** | shank **diameter** in 1/16" | 1/4" diameter | **1/4-28** `C` |
| **Fluid fittings** | **tube OD** in 1/16" | 1/4" tube | **7/16-20** `A` |

An "AN-4 bolt" and an "AN-4 fitting" share a name, a numbering convention, and
nothing else. **Torque tables for one must never be applied to the other.**

A secondary trap: the FAA sources list 7/16-20 and 9/16-18 in generic thread
tables but **never map them to fitting sizes.** That gap is real and still true
of those documents — **but the mapping is now resolved** from industry sources
(2026-07-31) and carried in `fluidFittings.threadTable`:

| Dash | Tube OD | Male thread |
|---|---|---|
| -3 | 3/16" | 3/8-24 |
| **-4** | **1/4"** | **7/16-20** |
| -6 | 3/8" | 9/16-18 |
| -8 | 1/2" | 3/4-16 |
| -10 | 5/8" | 7/8-14 |
| -12 | 3/4" | 1-1/16-12 |
| -16 | 1" | 1-5/16-12 |

**Governing standards:** originally **MIL-F-5509**; now **SAE AS4841, AS4842,
AS4843 and AS4875**. The 37° flare form itself is **SAE J514**. Installation
practice is **SAE AS50881**.

**Residual gap:** the *size* is confirmed, the *series* is not. Neither source
states whether the military **UNJF** (controlled root radius) variant applies to
a given part number, so this dataset does not assert UNF vs UNJF.

---

## What's covered

### Bolts — AN3 to AN20
Diameter and length coding, `A`/`H` suffix meanings, the full head-marking
table (raised dash, asterisk, two dashes, triangle, SPEC, unmarked), and the
prohibitions — including that **unmarked heads are low-strength and banned from
structural use**, and that aluminium alloy bolts are **prohibited on seaplanes**.

**Grip rule worth memorising:** washers may shim grip to a standard size, but the
**total washer stack must not exceed 1/8"**.

### Nuts — AN310, AN315, AN365/MS20365, AN364
Load type, locking method, and restriction sets. Notably: self-locking nuts must
**never** be used where the nut or bolt rotates, and AN364 thin nuts are **shear
only**. Includes the minimum prevailing-torque table for reused self-locking nuts.

### Torque — AC 43.13-1B Table 7-1
Full fine and coarse thread series, tension (AN310/AN365) and shear (AN320/AN364)
columns, in in-lb, for dry oil-free cadmium-plated threads. AN designation is
cross-referenced onto each fine-thread row.

### Washers — AN960, AN970
Uses, the galvanic-corrosion rule (cad-plated steel under steel hardware on
aluminium or magnesium), the standard/light `L` thickness series, and NAS1149
cross-references.

### Cotter pins — AN380/MS24665, AN381
Materials and the three hard rules: never reuse, largest pin that fits, clevis
pins head up or forward.

### Fluid fittings — AN815 / AN818 / AN819 / AN832 / AN833
37° flare (45° automotive tools **prohibited**), the double-flare rule, material
codes and colours (blue = aluminium, black = steel), and **Table 9-2** in full:
tube OD, torque for aluminium and steel, and minimum bend radii, dash -2 to -12.

### Clamps — MS21919, AN735, AN742, AN737
Cushioned vs plain vs bonding, the lightning-zone prohibition on AN735, and the
45° bolt-offset limit. **AN737 is flagged `X`** — see below.

### Line support
Both conflicting spacing tables, flexible-hose rules (24" support, 5–8% slack,
**two hose diameters straight off a fitting before any clamp**), and the bonding
requirements including the 1-ohm limit and the 24-hour Alodine rule.

---

## Two conflicts recorded rather than resolved

**1. AN737 torque values are contradicted.** One notebook returned radial 28 TPI
≈ 25 in-lb and worm screw 10 TPI ≈ 15 in-lb, with citations. Two others state
AN737 is *entirely absent* from their sources. On close reading the first was
generating suggested curriculum text for a gap it had just identified, formatted
to look like a citation. Flagged `X`. **Do not use those numbers.**

**2. Two rigid-line support spacing tables disagree.** AC 43.13-1B bands by OD
(1/4"–5/16" → 12"); the AMT Handbook splits by material (1/4" alu → 13.5",
steel → 16"). Both are recorded under `lineSupport`. This is a known examiner
trap, not an error in the data.

---

## Documented gaps

The dataset's `knownGaps` array lists what these sources **do not** contain, so a
consumer can tell "absent" from "not looked up":

- Fastener **edge distance** rule (2D etc.)
- **Safety wire** twist rate, gauge, run length, direction of pull
- MS24665 cotter pin dash-to-dimension table
- AN960/AN970 physical dimensions
- AN fitting thread mapping
- AN737 dimensional specs
- Flare nut hex across-flats

---

## Relationship to `cad-an-fittings/`

The CAD benchmark in `cad-an-fittings/` consumes this data. Every `[C]` value in
those KCL parameter files traces here; every `[A]` value is one this dataset also
marks as unverified. The two-hose-diameter rule under `lineSupport.flexibleHose`
is what drives the clamp placement in that model.

---

## Provenance note

Retrieved via NotebookLM cross-notebook query against the *Aircraft Weight and
Balance Handbook*, *Part 147 Curriculum* and *Garmin G500/G600 TXi* notebooks,
all of which carry AC 43.13-1B and the AMT handbooks as sources. Queries
explicitly asked each notebook to state what was **not** present, which is where
`knownGaps` comes from.

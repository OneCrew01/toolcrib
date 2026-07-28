# Verification Log — Fastening Reference

Every rule the fastening reference encodes is listed here. **No encoded value is
trusted until someone with the printed source in front of them compares it against
that text** (AC 43.13-1B Chg 1 / FAA-H-8083-31A) and signs the row off. Until then the library
is fail-closed: lookups throw `UnverifiedRuleError`, and draft opt-ins carry the
watermark `DRAFT — NOT VERIFIED`.

## Sign-off procedure

1. Open the printed (or official PDF) source cited in the row.
2. Compare the encoded value **and** the cited chapter/section/paragraph against the
   printed text. A row whose paragraph reads `UNCONFIRMED` needs the paragraph found
   and recorded, not just the value checked.
3. Initial and date the row below (Verified-by / Date columns).
4. **In the same commit**, flip that rule's `verification` block in
   `server/reference/tables/hole-edge-distance.mjs` to
   `{ status: "VERIFIED", verifiedBy: "<initials>", date: "<ISO date>" }`.
5. `node --test server/reference/` must pass before the commit lands.
6. Any later edit to an encoded value or citation resets the row to PENDING here
   and in the table file, in the same commit as the edit.

## Rules — table `hole-edge-distance`

Formulas are dimension-preserving multiples: millimeter inputs give millimeter results.

| Rule ID | Parameter | Encoded value | Claimed source | Status | Verified by | Date |
|---|---|---|---|---|---|---|
| HED-001 | edge-distance-min (single row, any head) | 2 × fastener diameter | AC 43.13-1B (Chg 1), Ch. 4, Sec. 4, para 4-57c(1) | PENDING | | |
| HED-002 | edge-distance-min (flush/countersunk) | 2.5 × fastener diameter | FAA-H-8083-31A, Ch. 4, Rivet Layout — para UNCONFIRMED | PENDING | | |
| HED-003 | edge-distance-preferred (protruding) | 2.5 × fastener diameter | FAA-H-8083-31A, Ch. 4, Rivet Layout — para UNCONFIRMED | PENDING | | |
| HED-004 | edge-distance-preferred (flush) | 3 × fastener diameter | FAA-H-8083-31A, Ch. 4, Rivet Layout — para UNCONFIRMED | PENDING | | |
| HED-005 | pitch-min (single row) | 3 × fastener diameter | AC 43.13-1B (Chg 1), Ch. 4, Sec. 4, para 4-57c(1) | PENDING | | |
| HED-006 | pitch-typical-min | 4 × fastener diameter | FAA-H-8083-31A, Ch. 4, Rivet Layout — para UNCONFIRMED | PENDING | | |
| HED-007 | pitch-typical-max | 6 × fastener diameter | FAA-H-8083-31A, Ch. 4, Rivet Layout — para UNCONFIRMED | PENDING | | |
| HED-008 | pitch-transverse-min | 2.5 × fastener diameter | FAA-H-8083-31A, Ch. 4, Rivet Layout — para UNCONFIRMED | PENDING | | |
| HED-009 | pitch-transverse-typical | 0.75 × rivet pitch | FAA-H-8083-31A, Ch. 4, Rivet Layout — para UNCONFIRMED | PENDING | | |
| HED-010 | fastener-diameter-selection | 3 × thickness of thicker sheet | AC 43.13-1B (Chg 1), Ch. 4, Sec. 4, para 4-57g(3) | PENDING | | |

## Source-confirmation notes (2026-07-22, encoding session)

- The FAA's own PDF (`faa.gov/documentLibrary/media/Advisory_Circular/AC_43.13-1B_w-chg1.pdf`)
  returned **HTTP 403** to automated fetch. The Ch. 4 Sec. 4 text was instead obtained from a
  mirrored copy of the official section PDF and text-extracted; page headers read
  "9/8/98 AC 43.13-1B Par 4-57".
- **Read verbatim from that text** (paragraph numbers are therefore high-confidence, but the
  operator check against the printed AC still stands): para 4-57c(1) — single-row edge
  distance ≥ 2 × diameter, spacing ≥ 3 × diameter; paras 4-57c(2)/(3) — double and multi-row
  minimums per **Figure 4-5** ("Rivet hole spacing and edge distance for single-lap sheet
  splices"); para 4-57g(3) — rivet diameter ≈ 3 × thickness of the thicker sheet.
- **Figure 4-5 is a scanned image** in the PDF; its numeric minimums could not be extracted.
  Double/multi-row edge-distance and spacing rules are therefore **not encoded** — an operator
  with the printed figure should encode them as a follow-up.
- The flush/countersunk, preferred, typical-pitch, and transverse-pitch values do **not**
  appear in the fetched AC Ch. 4 Sec. 4 text. They are standard AMT-handbook practice and are
  cited to FAA-H-8083-31A with paragraph UNCONFIRMED rather than to an invented AC paragraph.

## Rules — table `flush-mount-fit`

These rows encode **bench practice, not FAA data** (table file:
`server/reference/tables/flush-mount-fit.mjs`). There is no printed source text to check
them against — sign-off is by printed fit coupon and calipers on the target machine, then
flipping the rule's `verification` block in the table file, same as steps 3–6 above.

**Bench sign-off procedure.** (1) On the target machine (calibrated, 0.4 mm nozzle),
print one coupon pair per clearance class from the generator's own output
(`samples/flush-mount/coupons/` — panel and insert in different filaments so the flush
fit reads). (2) Deburr nothing — test as-printed. (3) Measure opening and insert with
calipers (0.01 mm) on both axes at mid-depth; record actual clearance per side =
(opening − insert) / 2. (4) Seat the insert and grade against the class definition:
snug = firm thumb pressure, no rattle; sliding = drops in and out freely; loose =
visible clearance, still reads flush. (5) Chamfer check: the insert should self-center
when dropped at a slight angle. (6) A class passes only if seated behavior matches at
BOTH band edges (print min and max pairs if the nominal result is marginal). Initial
and date the row, flip the rule's `verification` block in the same commit, and note
machine, filament, and measured actual clearance. Any nozzle, filament, or machine
change resets the class rows to PENDING.
Clearances are **per side**; formulas are dimension-preserving (mm in, mm out).

| Rule ID | Parameter | Encoded value | Claimed source | Status | Verified by | Date |
|---|---|---|---|---|---|---|
| FMF-001 | clearance-per-side-min (snug/press) | 0.10 mm | Bench practice — FDM fit coupons (Bambu P1S, 0.4mm nozzle) — UNCONFIRMED | PENDING | | |
| FMF-002 | clearance-per-side-max (snug/press) | 0.15 mm | Bench practice — FDM fit coupons (Bambu P1S, 0.4mm nozzle) — UNCONFIRMED | PENDING | | |
| FMF-003 | clearance-per-side-min (smooth-sliding) | 0.20 mm | Bench practice — FDM fit coupons (Bambu P1S, 0.4mm nozzle) — UNCONFIRMED | PENDING | | |
| FMF-004 | clearance-per-side-max (smooth-sliding) | 0.25 mm | Bench practice — FDM fit coupons (Bambu P1S, 0.4mm nozzle) — UNCONFIRMED | PENDING | | |
| FMF-005 | clearance-per-side-min (loose/service) | 0.30 mm | Bench practice — FDM fit coupons (Bambu P1S, 0.4mm nozzle) — UNCONFIRMED | PENDING | | |
| FMF-006 | clearance-per-side-max (loose/service) | 0.35 mm | Bench practice — FDM fit coupons (Bambu P1S, 0.4mm nozzle) — UNCONFIRMED | PENDING | | |
| FMF-007 | chamfer-lead-in-angle | 45° | Bench practice — FDM fit coupons (Bambu P1S, 0.4mm nozzle) — UNCONFIRMED | PENDING | | |
| FMF-008 | chamfer-lead-in-depth-min | 2 × clearance per side, 0.6 mm floor | Bench practice — FDM fit coupons (Bambu P1S, 0.4mm nozzle) — UNCONFIRMED | PENDING | | |
| FMF-009 | insert-dimension | opening dimension − 2 × clearance per side | Bench practice — FDM fit coupons (Bambu P1S, 0.4mm nozzle) — UNCONFIRMED | PENDING | | |
| FMF-010 | inner-dimension-compensation | 0 mm (class absorbs undersize after coupon calibration) | Bench practice — FDM fit coupons (Bambu P1S, 0.4mm nozzle) — UNCONFIRMED | PENDING | | |

## Rules — table `burn-cert`

Design-for-flammability rows (table file: `server/reference/tables/burn-cert.mjs`,
BL-003). **Nothing in this table certifies a part** — real certification is a physical
specimen burn test per 14 CFR 25.853 / Appendix F; these rows only encode the published
findings the geometry and print recipe are designed toward. Sign-off follows steps 1–6
above, against the printed sources named per row.

**Source-confirmation notes (2026-07-23, encoding session).**
- **FAA TC TN23-65** ("An Evaluation of the Flammability of 3D Printed Parts") could
  **not** be fetched: `fire.tc.faa.gov/pdf/tctn23-65.pdf` answered **HTTP 503** and the
  ROSA-P mirror (`rosap.ntl.bts.gov/view/dot/72825/dot_72825_DS1.pdf`) answered
  **HTTP 403** to automated fetch. Search-index snippets of the PDF corroborate: the
  title; vertical-Bunsen-burner method per the FAA Aircraft Materials Fire Test
  Handbook / 14 CFR 25.853; "the three variables having the most significant effect
  being material type, sample thickness, and infill percentage"; and low infill (<20%)
  recording average burn lengths beyond 3 in under 60-second testing. Corroboration is
  not confirmation: **every TN23-65 number below is UNCONFIRMED** and carried from the
  operator-released backlog brief — the operator verifies value AND section against the
  printed technical note. The `>40 s → <5 s` flame-time pair and the `0.5–2.0 in`
  higher-infill burn-length band were **not** corroborated by any fetched text at all.
- **UL-94 thickness values** (general 1.5 mm practice floor; ULTEM 9085 V-0 at
  0.508 mm; PC-ABS-FR V-0 at 1.5 mm; ratings are thickness-specific — V-0 at 3 mm may
  be V-1 at 1 mm) **were confirmed verbatim from a fetched secondary source**
  (`forgelabs.com/blog/ul-94-fire-safety-standards-additive-manufacturing`,
  fetched 2026-07-23). The authoritative record is the **UL Yellow Card for the exact
  filament grade** — sign-off requires checking the Yellow Card, not the blog. (A
  *Yellow Card* is the datasheet UL publishes for one specific plastic from one
  specific maker: it lists the flammability rating that exact material earned at each
  thickness tested. It is per-grade, not per-plastic-family, which is why a rating
  read off a blog post about "PC-ABS" is not a rating for the spool you bought.)
- **14 CFR 25.853(a)** text was fetched and confirmed 2026-07-23 via the Cornell LII
  mirror (`law.cornell.edu/cfr/text/14/25.853`): "Materials … must meet the applicable
  test criteria prescribed in part I of appendix F of this part…". Context only —
  Appendix F test criteria themselves were not fetched.

| Rule ID | Parameter | Encoded value | Claimed source | Status | Verified by | Date |
|---|---|---|---|---|---|---|
| BC-001 | min-wall-general-fr | 1.5 mm | UL-94 practice — Forge Labs (fetched 2026-07-23); verify vs UL Yellow Card | PENDING | | |
| BC-002 | min-wall-material (ULTEM 9085) | 0.508 mm | UL-94 V-0 listing — Forge Labs (fetched 2026-07-23); verify vs UL Yellow Card | PENDING | | |
| BC-003 | min-wall-material (PC-ABS-FR) | 1.5 mm | UL-94 V-0 listing — Forge Labs (fetched 2026-07-23); verify vs UL Yellow Card | PENDING | | |
| BC-004 | wall-flame-time-datum | 6.35 mm (0.10→0.25 in: >40 s → <5 s) | FAA TC TN23-65 — UNCONFIRMED (unfetchable at encoding) | PENDING | | |
| BC-005 | min-infill-percent (package requirement) | 25% | FAA TC TN23-65 (<20% → >3 in burn length) — UNCONFIRMED (unfetchable at encoding) | PENDING | | |
| BC-006 | material-floor (note) | chemistry sets the floor; geometry cannot overcome it | UL-94 thickness-specificity — Forge Labs (fetched 2026-07-23) | PENDING | | |
| BC-007 | design-uniform-wall (note) | uniform walls at/above the floor | FAA TC TN23-65 dominant-variables finding — UNCONFIRMED | PENDING | | |
| BC-008 | design-no-thin-fins (note) | no fins/webs below the floor; ribs on full-thickness walls | FAA TC TN23-65 dominant-variables finding — UNCONFIRMED | PENDING | | |
| BC-009 | cert-context (note) | certification = physical specimen test per 25.853(a)/App F | 14 CFR 25.853(a) — fetched 2026-07-23 (Cornell LII mirror) | PENDING | | |

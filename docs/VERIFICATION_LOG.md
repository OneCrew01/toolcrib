# Verification Log — Fastening Reference

Every rule the fastening reference encodes is listed here. **No encoded value is
trusted until a certificated person compares it against the printed source text**
(AC 43.13-1B Chg 1 / FAA-H-8083-31A) and signs the row off. Until then the library
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

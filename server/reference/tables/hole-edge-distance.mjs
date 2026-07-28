// Rivet/bolt hole edge distance and spacing (pitch) for sheet-metal fastening.
//
// Citation provenance (2026-07-22): AC 43.13-1B Chg 1, Ch. 4, Sec. 4 text was
// fetched and read — paragraphs marked 4-57c(1) and 4-57g(3) are quoted from
// that text. Figure 4-5 (double/multi-row minimums) is a scanned image whose
// values could not be extracted; multi-row rules are NOT encoded. Rows citing
// FAA-H-8083-31A carry standard AMT-handbook practice the AC section does not
// state numerically; their paragraph is UNCONFIRMED until checked in print.
//
// Every row ships PENDING_OPERATOR. The lookup layer refuses to serve any of
// them without an explicit draft opt-in until someone with the printed source in
// front of them signs the row off in docs/VERIFICATION_LOG.md and flips the
// status here.

import { makeTable, PENDING_OPERATOR } from "../schema.mjs";

const TOPIC = "sheet-metal-fastening";

const AC = {
  document: "AC 43.13-1B (Chg 1)",
  chapter: "4",
  section: "4 (Metal Repair Procedures)",
};

const HANDBOOK = {
  document: "FAA-H-8083-31A (AMT Handbook — Airframe, Vol. 1)",
  chapter: "4 (Aircraft Metal Structural Repair)",
  section: "Rivet Layout",
  paragraph: "UNCONFIRMED — verify against printed AC",
};

const PENDING = (notes) => ({ status: PENDING_OPERATOR, verifiedBy: null, date: null, notes });

const timesDia = (k) => ({
  fn: ({ fastenerDiaMm }) => k * fastenerDiaMm,
  text: `${k} × fastener diameter`,
  inputs: ["fastenerDiaMm"],
});

export const holeEdgeDistance = makeTable("hole-edge-distance", [
  {
    id: "HED-001",
    topic: TOPIC,
    parameter: "edge-distance-min",
    appliesTo: { joint: "riveted sheet-metal", headStyle: "any", rows: "single" },
    formula: timesDia(2),
    units: "mm",
    basis: "For a single row of rivets, the distance from hole center to the nearest sheet edge must be at least twice the rivet diameter.",
    source: { ...AC, paragraph: "4-57c(1)" },
    verification: PENDING("Paragraph read verbatim from fetched AC text; AC states the single-row minimum without distinguishing head style — flush case carries a larger handbook minimum (HED-002)."),
  },
  {
    id: "HED-002",
    topic: TOPIC,
    parameter: "edge-distance-min",
    appliesTo: { joint: "riveted sheet-metal", headStyle: "flush", rows: "single" },
    formula: timesDia(2.5),
    units: "mm",
    basis: "Countersunk (flush) fasteners need at least 2.5 diameters of edge distance because the countersink removes bearing material near the edge.",
    source: { ...HANDBOOK },
    verification: PENDING("Value not stated in fetched AC Ch. 4 Sec. 4 text; standard AMT-handbook practice, unverified."),
  },
  {
    id: "HED-003",
    topic: TOPIC,
    parameter: "edge-distance-preferred",
    appliesTo: { joint: "riveted sheet-metal", headStyle: "protruding", rows: "single" },
    formula: timesDia(2.5),
    units: "mm",
    basis: "Laying out protruding-head rivets at 2.5 diameters from the edge leaves margin over the 2-diameter minimum for drilling error.",
    source: { ...HANDBOOK },
    verification: PENDING("Preferred (not minimum) practice; not in fetched AC text, unverified."),
  },
  {
    id: "HED-004",
    topic: TOPIC,
    parameter: "edge-distance-preferred",
    appliesTo: { joint: "riveted sheet-metal", headStyle: "flush", rows: "single" },
    formula: timesDia(3),
    units: "mm",
    basis: "Preferred layout for flush fasteners is 3 diameters from the edge, margin over the 2.5-diameter minimum.",
    source: { ...HANDBOOK },
    verification: PENDING("Preferred (not minimum) practice; not in fetched AC text, unverified."),
  },
  {
    id: "HED-005",
    topic: TOPIC,
    parameter: "pitch-min",
    appliesTo: { joint: "riveted sheet-metal", headStyle: "any", rows: "single" },
    formula: timesDia(3),
    units: "mm",
    basis: "For a single row of rivets, center-to-center spacing must be at least three times the rivet diameter.",
    source: { ...AC, paragraph: "4-57c(1)" },
    verification: PENDING("Paragraph read verbatim from fetched AC text."),
  },
  {
    id: "HED-006",
    topic: TOPIC,
    parameter: "pitch-typical-min",
    appliesTo: { joint: "riveted sheet-metal", headStyle: "any", rows: "any" },
    formula: timesDia(4),
    units: "mm",
    basis: "Typical rivet pitch in sheet-metal work runs 4 to 6 diameters; below 4 gains little strength and crowds the bucking bar.",
    source: { ...HANDBOOK },
    verification: PENDING("Typical (not minimum) practice; not in fetched AC text, unverified."),
  },
  {
    id: "HED-007",
    topic: TOPIC,
    parameter: "pitch-typical-max",
    appliesTo: { joint: "riveted sheet-metal", headStyle: "any", rows: "any" },
    formula: timesDia(6),
    units: "mm",
    basis: "Typical rivet pitch in sheet-metal work runs 4 to 6 diameters; wider spacing risks skin gapping between fasteners.",
    source: { ...HANDBOOK },
    verification: PENDING("Typical (not maximum-allowed) practice; not in fetched AC text, unverified."),
  },
  {
    id: "HED-008",
    topic: TOPIC,
    parameter: "pitch-transverse-min",
    appliesTo: { joint: "riveted sheet-metal", headStyle: "any", rows: "multiple" },
    formula: timesDia(2.5),
    units: "mm",
    basis: "Row-to-row (transverse) spacing should never be less than 2.5 rivet diameters.",
    source: { ...HANDBOOK },
    verification: PENDING("Not in fetched AC text; AC Figure 4-5 governs multi-row minimums but is a scanned image and was not encoded. Unverified."),
  },
  {
    id: "HED-009",
    topic: TOPIC,
    parameter: "pitch-transverse-typical",
    appliesTo: { joint: "riveted sheet-metal", headStyle: "any", rows: "multiple" },
    formula: {
      fn: ({ pitchMm }) => 0.75 * pitchMm,
      text: "0.75 × rivet pitch",
      inputs: ["pitchMm"],
    },
    units: "mm",
    basis: "Row-to-row (transverse) spacing is normally 75 percent of the rivet pitch in the row.",
    source: { ...HANDBOOK },
    verification: PENDING("Not in fetched AC text; standard AMT-handbook practice, unverified."),
  },
  {
    id: "HED-010",
    topic: TOPIC,
    parameter: "fastener-diameter-selection",
    appliesTo: { joint: "riveted sheet-metal", headStyle: "any", rows: "any" },
    formula: {
      fn: ({ sheetThicknessMm }) => 3 * sheetThicknessMm,
      text: "3 × thickness of the thicker sheet",
      inputs: ["sheetThicknessMm"],
    },
    units: "mm",
    basis: "General rule for joining aluminum sheets: rivet diameter approximately three times the thickness of the thicker sheet.",
    source: { ...AC, paragraph: "4-57g(3)" },
    verification: PENDING("Paragraph read verbatim from fetched AC text (stated in the context of paragraphs 4-58g through 4-58n repairs)."),
  },
]);

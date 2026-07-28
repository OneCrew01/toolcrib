// Reference consult: before generating, ask the fastening reference what the
// request's features are supposed to look like, and record every rule touched
// — id, citation, verification status, watermark — so the package's warnings
// section can show its work. Draft rules are allowed through here on purpose
// ({allowDraft: true}): the consult is advisory tonight, but it is never
// silent about being unverified.

import { edgeDistance, pitch, DRAFT_WATERMARK } from "../reference/lookup.mjs";
import { VERIFIED } from "../reference/schema.mjs";

// The caveat, inside the sentence that carries the number.
//
// These findings become package warnings and are printed in PDF section 9 as
// bare bullets. The "DRAFT — NOT VERIFIED" watermark rides on a separate line
// further down the page, so a reader skimming bullets met the comparison and
// never met the doubt. Now every finding names the rules it stands on and says
// in the same breath whether anyone has signed them.
//
// "VIOLATES" is gone with it. A comparison against an unsigned row is a
// comparison; pronouncing a violation is a judgement this has no standing to
// make — and the loudest word in the sentence was the one least entitled to be
// there, since the "preferred" figure comes from HED-003, which is not in
// AC 43.13-1B at all but handbook practice with an UNCONFIRMED paragraph.
// Comparators that survive the boundary.
//
// The branch that fired on `statedEdge >= minMm` printed "is above the {min}mm
// minimum", which is false the moment the two are equal — and the demo request
// lands EXACTLY there: a 5mm fastener with its hole center 10mm from the edge,
// against an HED-001 minimum of 2 x dia = 10mm. A hole sitting on the minimum
// has no margin at all, and the one page in this repo built to be printed and
// signed is the last place to tell somebody it has some. Every comparison a
// finding makes now goes through here, so the word matches the arithmetic in
// all three cases and not just the two anyone thought to read.
function relation(value, threshold) {
  if (value > threshold) return "above";
  if (value < threshold) return "below";
  return "exactly on";
}

function basisNote(res, ids) {
  const rows = res.verification?.rules ?? [];
  const unsigned = ids.filter((id) => (rows.find((r) => r.id === id)?.status ?? null) !== VERIFIED);
  if (unsigned.length === 0)
    return `${ids.join(", ")} signed off against the printed source (docs/VERIFICATION_LOG.md)`;
  const plural = unsigned.length > 1;
  return (
    `${unsigned.join(", ")} ${plural ? "are" : "is"} unsigned: nobody has checked ` +
    `${plural ? "those rows" : "that row"} against the printed source (docs/VERIFICATION_LOG.md), ` +
    `so read this as a comparison, not a verdict`
  );
}

/**
 * Consult the reference for a validated generation request.
 * @returns {{lookups: Array, findings: string[], notes: string[], watermark?: string, reason?: string}}
 */
export function consultReference(request) {
  const notes = [];
  const prompt = request?.prompt;
  if (!prompt) return skip("request carries structuredIntent, not a prose prompt — no hole features to sniff");
  if (request.units !== "mm") return skip(`feature sniffing is wired for mm prompts only; request units = ${request.units}`);

  const dia = matchMm(prompt, /([\d.]+)\s*mm\s+(?:diameter\s+)?(?:dia\.?\s+)?holes?/i);
  if (dia === null) return skip("no fastener-hole features detected in the prompt");

  // Head style is not stated by plain-plate prompts; consult assumes the
  // conservative protruding-head rows and says so.
  notes.push("headStyle not stated in prompt — consulted protruding-head rows (conservative)");

  const lookups = [];
  const record = (parameter, inputs, res) => {
    const { verification, watermark, citation, ...values } = res;
    lookups.push({ parameter, inputs, result: { values, citation, verification, ...(watermark ? { watermark } : {}) } });
    return res;
  };

  const ed = record("edge-distance", { fastenerDiaMm: dia, headStyle: "protruding" },
    edgeDistance({ fastenerDiaMm: dia, headStyle: "protruding", allowDraft: true }));
  const pt = record("pitch", { fastenerDiaMm: dia },
    pitch({ fastenerDiaMm: dia, allowDraft: true }));

  const findings = [];
  const statedEdge = matchMm(prompt, /hole\s+center\s+([\d.]+)\s*mm\s+from/i);
  if (statedEdge !== null) {
    const vsMin = `${relation(statedEdge, ed.minMm)} the ${ed.minMm}mm minimum (HED-001)`;
    findings.push(
      // Under the minimum, the preferred figure is not worth naming: the reader
      // has one thing to fix and HED-003 is not it.
      statedEdge < ed.minMm
        ? `stated edge distance ${statedEdge}mm is ${vsMin} — ${basisNote(ed, ["HED-001"])}`
        : `stated edge distance ${statedEdge}mm is ${vsMin} and ` +
          `${relation(statedEdge, ed.preferredMm)} the ${ed.preferredMm}mm preferred figure (HED-003) — ` +
          `${basisNote(ed, ["HED-001", "HED-003"])}`,
    );
  }
  findings.push(
    `rivet pitch for a ${dia}mm fastener: min ${pt.minMm}mm (HED-005), typical ` +
      `${pt.typicalMinMm}-${pt.typicalMaxMm}mm (HED-006, HED-007) — ` +
      `${basisNote(pt, ["HED-005", "HED-006", "HED-007"])}`,
  );

  const draft = lookups.some((l) => l.result.watermark);
  return {
    consultedAt: new Date().toISOString(),
    fastenerDiaMm: dia,
    lookups,
    findings,
    notes,
    ...(draft ? { watermark: DRAFT_WATERMARK } : {}),
  };
}

function skip(reason) {
  return { lookups: [], findings: [], notes: [], reason };
}

function matchMm(text, re) {
  const m = text.match(re);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Reference consult: before generating, ask the fastening reference what the
// request's features are supposed to look like, and record every rule touched
// — id, citation, verification status, watermark — so the package's warnings
// section can show its work. Draft rules are allowed through here on purpose
// ({allowDraft: true}): the consult is advisory tonight, but it is never
// silent about being unverified.

import { edgeDistance, pitch, DRAFT_WATERMARK } from "../reference/lookup.mjs";

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
    findings.push(
      statedEdge >= ed.preferredMm
        ? `stated edge distance ${statedEdge}mm meets preferred ${ed.preferredMm}mm (min ${ed.minMm}mm)`
        : statedEdge >= ed.minMm
          ? `stated edge distance ${statedEdge}mm is above minimum ${ed.minMm}mm but below preferred ${ed.preferredMm}mm`
          : `stated edge distance ${statedEdge}mm VIOLATES minimum ${ed.minMm}mm`,
    );
  }
  findings.push(`rivet pitch for a ${dia}mm fastener: min ${pt.minMm}mm, typical ${pt.typicalMinMm}-${pt.typicalMaxMm}mm`);

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

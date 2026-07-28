// Definition-of-Done package assembler. Takes a job that survived the state
// machine plus the artifacts its run produced, and writes the complete bundle
// a human reviewer signs at the gate: request, intent, CAD, exports, reports,
// manufacturing PDF, API log, pending approval record, sealed manifest.
//
// Everything in the bundle is derived from real inputs — no placeholders. A
// skipped optional file is recorded twice on purpose: as a manifest entry
// with status "skipped" AND as a warning, so it cannot hide in either view.
//
// Reproducible by design: all in-file timestamps come from the job (or
// opts.now), so assembling the same inputs twice yields byte-identical files
// and the same packageHash.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { analyzeStl } from "./stl-analyze.mjs";
import { createPdf } from "./pdf.mjs";

export class ExportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ExportError";
    this.code = code; // MISSING_STL | MISSING_KCL
  }
}

export class PdfError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "PdfError";
    this.cause = cause;
  }
}

// The 13 sections every manufacturingPackage.pdf must carry, in order.
export const PDF_SECTIONS = Object.freeze([
  "Title Block",
  "Design Intent",
  "Input Measurements",
  "CAD Preview",
  "Key Dimensions",
  "Material & Machine",
  "Export List",
  "Validation Results",
  "Warnings & Assumptions",
  "Setup Checklist",
  "Inspection Checklist",
  "Approval Record",
  "Revision History",
]);

const GATE_RESULTS = new Set(["PASS", "FAIL", "SKIPPED"]);

// The two sentences the printed package carries about itself.
//
// This bundle is the one artifact in the repo designed to be printed, carried to
// a machine, and signed by a named person — and it was the only output that
// disclaimed nothing. Every other surface here says what it is not: burn-cert
// lookups, W&B reports, the amendment proposal, every draft reference lookup.
// A stranger who prints this one and signs the line at the bottom is holding a
// piece of paper shaped exactly like a conformity record. These two sentences
// say, on the page, that it is not one.
//
// PDF_ADVISORY sits directly under the title so it is read before any number.
// It went through two false versions before this one, and both failed the same
// way: they described HOW the numbers got here, and then the page printed a
// number the description did not cover.
//
//   v1 "Every number in this document was computed by software" — section 3
//      prints "Stated in the request" and "Material density (input)", typed by
//      a person and only copied by software.
//   v2 "...either typed into the request or computed by software" — section 6
//      prints "Build volume 256 x 256 x 256 mm" and section 10 "Confirm nozzle
//      0.4 mm installed", hand-authored constants in the machine profile that
//      are in neither category, and section 9's edge-distance figures come from
//      multipliers transcribed out of a handbook.
//
// The enumeration was never the load-bearing part; "checked by nobody" was. An
// exhaustive list is a claim, it has to be defended against every number on the
// page, and a reader who disproves the first sentence discounts the ones after
// it. This version makes no claim about provenance at all, so there is nothing
// left to disprove by scrolling.
//
// SIGNATURE_MEANING sits directly above the signature line, is written into
// approvals/approvalRecord.json, and is rendered beside the Approve button in
// the review console (app/src/views/JobDetail.tsx) — the three places a person
// can put their name on this job. "The same sentence" was a comment's claim
// and nothing enforced it: the console copy was a hand-typed reword, so the
// two guarded surfaces could be sharpened while the one a reviewer actually
// reads kept the old words. package.test.mjs now asserts this string on the
// rendered page, in the JSON, AND in the console source, so the three cannot
// drift apart silently. Hence the wording works over a paper line and beside
// a button both.
//
// It also has to say the same TRUE thing on both, which ruled out the first
// version. "records that one named person accepted this package and passed it
// to the next step" is a claim about effect, and on paper there is no effect:
// the state machine never learns the signature exists, and two lines below the
// signature rule the page says exactly that. A signer read that signing records
// an acceptance, then that it records nothing anywhere, and was left with no
// answer to "what did my signature just do?". So this sentence says what a name
// MEANS — the same on a printed line and beside a button — and each surface
// states its own effect separately: the page says the pen cannot reach the
// ledger, and a button does not need telling that clicking it works.
export const PDF_ADVISORY =
  "Nothing in this document has been checked by anybody. Nothing here has been tested, approved, or " +
  "signed off for any use. Check anything that matters against your own source before you cut, print, " +
  "or fit a part.";

//
// No em dash in this one, deliberately: pdf.mjs's WinAnsi escaper maps "—" to
// "-" (FALLBACK, pdf.mjs:19), so an em dash here renders as a hyphen and the
// test that asserts this exact sentence on the RENDERED page can never match.
// Found by that test going red, which is the test doing its job.
export const SIGNATURE_MEANING =
  "Your name on this job means one person read this package and passed it on. It is not approval of " +
  "the part. Nothing here has been tested or signed off by anybody.";

// A number in minutesUsed is a billing claim, and this bundle's whole value is
// that every number in it was measured. There are THREE states here and they
// are never collapsed into each other:
//
//   number — the caller measured minutes and says so; ships bare.
//   0      — this run issued ZERO API requests, so it burned zero billable
//            minutes. That is entailed by a counted fact, not read off a
//            billing surface, and the basis note says exactly that.
//   null   — requests were issued (or nobody counted them) and no surface we
//            exercise reports their cost. Unmeasured, and it says so.
//
// totalCalls is the discriminator, which is why it must be a COUNT and not a
// borrowed array length. Both halves of that were wrong before FN-031: the
// count was fabricated, and then a blanket "not because this run consumed
// zero" was stamped on runs that provably consumed zero — a sealed manifest
// contradicting its own "zero network" warning three fields away.
const MINUTES_UNMEASURED_NOTE =
  "minutesUsed is null because per-run minutes were NOT MEASURED. This run's API requests have a cost " +
  "that no Zoo surface this pipeline exercises reports: the only spend signal found is the account-level " +
  "balance, and a balance delta is campaign-level, not per-run. Read this as unknown, not as free " +
  "(docs/API_FIELD_NOTES.md FN-031).";

const MINUTES_ZERO_NO_CALLS_NOTE =
  "minutesUsed is 0 because this run issued ZERO requests to the Zoo API (totalCalls: 0) — no request, " +
  "no billable minute. This is entailed by the counted request total, NOT read off a billing surface; " +
  "per-run minutes remain unreadable on every surface we exercise (docs/API_FIELD_NOTES.md FN-031). " +
  "Any artifact replayed from a fixture was generated by an earlier run whose cost is not attributed here.";

const CALLS_UNCOUNTED_NOTE =
  "totalCalls is null because this run did not count the requests it issued — NOT a claim that it issued " +
  "none. A run that counted its requests reports a number here, zero included " +
  "(docs/API_FIELD_NOTES.md FN-031).";

const NO_API_RECORD_NOTE = "no API activity recorded for this assembly (offline/fixture run)";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * packageHash recipe — a judge recomputes it in three lines:
 *   hashes = manifest.files.filter(f => f.status === "present").map(f => f.sha256)
 *   hashes.sort()                              // plain lexicographic sort
 *   packageHash === sha256(hashes.join("\n"))  // utf8, no trailing newline
 * manifest.json itself is never hashed — it is the container that carries
 * the result and could not contain its own digest.
 */
export function packageHashOf(fileHashes) {
  return sha256(fileHashes.slice().sort().join("\n"));
}

const toBuf = (v) =>
  v == null ? null : Buffer.isBuffer(v) ? v : Buffer.from(String(v), "utf8");

const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "part";

const round = (n, p = 2) => Number(n.toFixed(p));

// Pull "50 mm"-style stated measurements out of a free-text prompt so the
// PDF's Input Measurements section quotes the requester's own numbers.
function statedMeasurements(prompt) {
  const seen = new Set();
  const out = [];
  for (const m of String(prompt ?? "").matchAll(/(\d+(?:\.\d+)?)\s*(mm|cm|in|ft|yd|m)\b/g)) {
    const label = `${m[1]} ${m[2]}`;
    if (!seen.has(label)) { seen.add(label); out.push(label); }
  }
  return out;
}

/**
 * Assemble the DoD bundle for one job.
 *
 * @param {object} job        LocalStore job: {jobId, rev, state, request, createdAt, updatedAt}
 * @param {object} artifacts  what the run produced:
 *   {kcl (REQUIRED string|Buffer), stl?, step?, png? (Buffers),
 *    partName?, machine?, reference?: [{parameter?, citation?, verification?, watermark?}],
 *    apiRun?: {calls?: [], totalCalls?, minutesUsed?, generations?: [], replayedRecords?: []},
 *    ledger?: LedgerRow[], warnings?: string[]}
 *   apiRun.totalCalls is the COUNTED number of HTTP requests this run issued to
 *   the Zoo API. Supply it whenever you counted — 0 included, since 0 is the
 *   only thing that licenses a 0 in minutesUsed. Omit it when you did not
 *   count: it seals as `null` plus a note, and it is never inferred from the
 *   length of any array, because an array of records is not a request tally.
 *   apiRun.minutesUsed is OPTIONAL and must only be supplied when it was
 *   actually measured; otherwise the assembler derives 0-or-null from
 *   totalCalls and attaches the basis. `calls` is per-request records only —
 *   generation records go in `generations`, replayed fixtures in
 *   `replayedRecords`, so no array is filed under a name it does not fit.
 * @param {Array}  gates      [{gate, result: PASS|FAIL|SKIPPED, threshold?, measured?, notes?}]
 * @param {object} opts       {outRoot (REQUIRED), expectMesh = true, projectId?, workflowId?, now?}
 * @returns {{bundleDir: string, manifest: object, analysis: object|null}}
 */
export function assemblePackage(job, artifacts = {}, gates = [], opts = {}) {
  if (!job || typeof job.jobId !== "string" || !/^[A-Za-z0-9_-]+$/.test(job.jobId))
    throw new RangeError(`assemblePackage: job.jobId must be filename-safe, got ${JSON.stringify(job?.jobId)}`);
  if (!job.request || typeof job.request !== "object")
    throw new RangeError("assemblePackage: job.request missing — validate before packaging");
  if (!opts.outRoot) throw new RangeError("assemblePackage: opts.outRoot is required — no hidden default output dir");

  const req = job.request;
  const expectMesh = opts.expectMesh ?? true;
  const stamp = opts.now ?? job.updatedAt ?? new Date().toISOString();
  const projectId = opts.projectId ?? "toolcrib";
  const workflowId = opts.workflowId ?? "generate-validate-package-v1";
  const part = slug(artifacts.partName ?? req.title ?? "part");

  const kcl = toBuf(artifacts.kcl);
  if (!kcl || kcl.length === 0)
    throw new ExportError("MISSING_KCL", `job ${job.jobId}: cad/${part}.kcl is required and no KCL was provided — ` +
      "the user text-to-cad record always carries KCL even when outputs are unreachable (FN-011)");

  const stl = toBuf(artifacts.stl);
  if ((!stl || stl.length === 0) && expectMesh)
    throw new ExportError("MISSING_STL", `job ${job.jobId}: exports/${part}.stl is REQUIRED and the backend was ` +
      "expected to produce a mesh (opts.expectMesh) — got none. Known cause: dedupe-hit jobs complete with " +
      "permanently unreachable outputs (FN-011). Re-dispatch or pass expectMesh:false to park a mesh-less bundle.");

  const validation = gates.map((g) => {
    const result = String(g.result ?? "").toUpperCase();
    if (!GATE_RESULTS.has(result))
      throw new RangeError(`gate ${JSON.stringify(g.gate)}: result must be PASS|FAIL|SKIPPED, got ${JSON.stringify(g.result)}`);
    const row = { gate: String(g.gate), result };
    if (g.threshold != null) row.threshold = String(g.threshold);
    if (g.measured != null) row.measured = String(g.measured);
    if (g.notes != null) row.notes = String(g.notes);
    return row;
  });

  const analysis = stl && stl.length > 0 ? (artifacts.stlAnalysis ?? analyzeStl(stl)) : null;
  const reference = Array.isArray(artifacts.reference) ? artifacts.reference : [];

  const warnings = [...(artifacts.warnings ?? [])];
  for (const r of reference)
    if (r.watermark)
      warnings.push(`${r.watermark}: ${r.parameter ?? "reference lookup"} used before operator sign-off (docs/VERIFICATION_LOG.md)`);
  for (const v of validation)
    if (v.result === "FAIL")
      warnings.push(`gate ${v.gate} FAILED — measured ${v.measured ?? "n/a"} against threshold ${v.threshold ?? "n/a"}`);

  // ---- write the bundle -------------------------------------------------
  const bundleDir = join(opts.outRoot, job.jobId);
  const files = [];
  const emit = (rel, buf, format) => {
    const abs = join(bundleDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, buf);
    files.push({
      path: rel, format, revision: job.rev, createdAt: stamp,
      status: "present", bytes: buf.length, sha256: sha256(buf),
    });
  };
  const skip = (rel, format, note) => {
    files.push({
      path: rel, format, revision: job.rev, createdAt: stamp,
      status: "skipped", bytes: 0, sha256: null, note,
    });
    warnings.push(`${rel} SKIPPED — ${note}`);
  };

  emit("generationRequest.json", Buffer.from(JSON.stringify(req, null, 2) + "\n"), "json");
  emit("designIntent.md", Buffer.from(designIntentMd(job, req, reference, artifacts.machine)), "md");
  emit(`cad/${part}.kcl`, kcl, "kcl");

  if (stl && stl.length > 0) emit(`exports/${part}.stl`, stl, "stl");
  else skip(`exports/${part}.stl`, "stl",
    "REQUIRED mesh absent and opts.expectMesh was false — bundle parked incomplete; dodCheck will flag it");

  const step = toBuf(artifacts.step);
  if (step && step.length > 0) emit(`exports/${part}.step`, step, "step");
  else skip(`exports/${part}.step`, "step", "no STEP bytes provided by this run — optional export");

  const png = toBuf(artifacts.png);
  if (png && png.length > 0) emit(`previews/${part}.png`, png, "png");
  else skip(`previews/${part}.png`, "png",
    "no render route exists on the measured API surface — text-to-cad outputs carry geometry only, never an image (docs/API_FIELD_NOTES.md)");

  emit("reports/validationReport.md", Buffer.from(validationReportMd(job, validation, analysis, req)), "md");

  // ---- API accounting ---------------------------------------------------
  // Computed HERE, above the PDF build, on purpose. `warnings` is handed to
  // buildManufacturingPdf by reference and rendered during that call, so a
  // push after it lands in manifest.warnings and never in the document a
  // human signs — the manifest and the signed PDF would then disagree about
  // what this bundle warns. Anything that needs to reach section 9 has to be
  // known before this line.
  //
  // A count, or nothing. Never `?? 0` (fabricates a measurement) and never
  // `?? calls.length` (an array of records is not a tally of requests, and
  // there is no guarantee it is exhaustive).
  const totalCalls = Number.isInteger(artifacts.apiRun?.totalCalls) ? artifacts.apiRun.totalCalls : null;
  const measuredMinutes = Number.isFinite(artifacts.apiRun?.minutesUsed) ? artifacts.apiRun.minutesUsed : null;
  const minutesUsed = measuredMinutes ?? (totalCalls === 0 ? 0 : null);
  const minutesUsedNote = measuredMinutes != null
    ? null
    : totalCalls === 0 ? MINUTES_ZERO_NO_CALLS_NOTE : MINUTES_UNMEASURED_NOTE;
  // The PDF is what the reviewer actually signs, so an unknown cost is stated
  // there too — but only when it IS unknown. A zero-request run has nothing to
  // disclose and gets no warning noise.
  if (minutesUsed == null)
    warnings.push(
      `API minutes consumed by this run are NOT MEASURED — ${totalCalls == null
        ? "the request count was not recorded either"
        : `${totalCalls} Zoo API request(s) issued`}; no surface this client exercises reports per-run ` +
      "minutes or cost (docs/API_FIELD_NOTES.md FN-031). Unknown, not zero.",
    );

  let pdfBytes;
  try {
    pdfBytes = buildManufacturingPdf({ job, req, part, files, validation, warnings, analysis, reference, artifacts, stamp });
  } catch (e) {
    throw new PdfError(`job ${job.jobId}: manufacturingPackage.pdf failed to build: ${e.message}`, e);
  }
  if (!pdfBytes || pdfBytes.length === 0 || pdfBytes.subarray(0, 5).toString() !== "%PDF-")
    throw new PdfError(`job ${job.jobId}: PDF writer returned invalid bytes`);
  emit("reports/manufacturingPackage.pdf", pdfBytes, "pdf");

  const apiRun = {
    jobId: job.jobId,
    totalCalls,
    ...(totalCalls == null ? { totalCallsNote: CALLS_UNCOUNTED_NOTE } : {}),
    minutesUsed,
    ...(minutesUsedNote ? { minutesUsedNote } : {}),
    calls: artifacts.apiRun?.calls ?? [],
    // Records that are not per-request calls keep their own names rather than
    // riding in `calls` and inflating what a reader counts there.
    ...(artifacts.apiRun?.generations?.length ? { generations: artifacts.apiRun.generations } : {}),
    ...(artifacts.apiRun?.replayedRecords?.length ? { replayedRecords: artifacts.apiRun.replayedRecords } : {}),
    ...(artifacts.apiRun ? {} : { note: NO_API_RECORD_NOTE }),
  };
  emit("logs/apiRun.json", Buffer.from(JSON.stringify(apiRun, null, 2) + "\n"), "json");

  emit("approvals/approvalRecord.json", Buffer.from(JSON.stringify({
    state: "pending",
    jobId: job.jobId,
    revision: job.rev,
    createdAt: stamp,
    approver: null,
    decidedAt: null,
    decision: null,
    // This note used to say the approval step rewrites this file. It does not.
    // Nothing does — server/api/server.mjs decide() records the decision as
    // ledger transitions and never touches the bundle, so the fields above stay
    // pending forever. A reviewer who approves in the console, opens this file
    // looking for their own name, and finds "pending" beside a note claiming the
    // file was rewritten has been told the wrong thing twice. Say where the
    // record actually is instead.
    // The pointer at Revision History used to be written as an invariant — "the
    // ledger as it stood at assembly IS printed there" — which the assembler
    // does not maintain: it prints the last 20 rows, and prints a job-summary
    // table instead when no ledger reaches it. Fixing a false claim about where
    // the record lives with a second claim the code does not guarantee is the
    // same mistake one rung quieter. So the section now states its own extent on
    // the page, and this note promises only that.
    note: "Approval is a HUMAN-gated state transition (WAITING_FOR_HUMAN_REVIEW -> APPROVED). " +
      "This file is written once, when the package is assembled, and nothing ever rewrites it: " +
      "the fields above are how the job stood at that moment and stay that way. Who decided what, " +
      "and when, is recorded in the job's ledger (<jobId>.ledger.jsonl). The Revision History " +
      "section of reports/manufacturingPackage.pdf prints what that ledger held at assembly, and " +
      "says on the page how much of it is shown.",
    whatSigningMeans: SIGNATURE_MEANING,
  }, null, 2) + "\n"), "json");

  const manifest = {
    jobId: job.jobId,
    projectId,
    revision: job.rev,
    workflowId,
    packageStatus: files.some((f) => f.status === "skipped") ? "complete-with-notes" : "complete",
    completedAt: stamp,
    packageHash: packageHashOf(files.filter((f) => f.status === "present").map((f) => f.sha256)),
    files,
    validation,
    // Mirrors logs/apiRun.json field for field, notes included. The manifest is
    // the summary a reviewer reaches for first; when the two sealed surfaces
    // carry different subsets of the same account, the bundle tells two stories.
    apiRuns: {
      totalCalls,
      ...(totalCalls == null ? { totalCallsNote: CALLS_UNCOUNTED_NOTE } : {}),
      minutesUsed,
      ...(minutesUsedNote ? { minutesUsedNote } : {}),
      ...(apiRun.note ? { note: apiRun.note } : {}),
    },
    warnings,
  };
  writeFileSync(join(bundleDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  return { bundleDir, manifest, analysis };
}

// ---- markdown reports ----------------------------------------------------

function referenceLine(r) {
  const cite = typeof r.citation === "object" && r.citation !== null
    ? Object.entries(r.citation).map(([k, v]) => `${k}: ${v}`).join("; ")
    : String(r.citation ?? "citation not supplied");
  return `${r.parameter ?? "rule"} — ${cite}${r.watermark ? ` [${r.watermark}]` : ""}`;
}

function designIntentMd(job, req, reference, machine) {
  const lines = [
    `# Design Intent — ${req.title ?? job.jobId}`,
    "",
    `- Job: \`${job.jobId}\` (rev ${job.rev})`,
    `- Requester: ${req.requester ?? "unknown"}`,
    `- Created: ${job.createdAt ?? "n/a"}`,
    "",
    "## Intent",
    "",
    ...(req.prompt
      ? [`> ${req.prompt}`]
      : ["```json", JSON.stringify(req.structuredIntent ?? {}, null, 2), "```"]),
    "",
    "## Material",
    "",
    `${req.material?.name ?? "unspecified"} — density ${req.material?.densityKgM3 ?? "?"} kg/m3`,
    "",
    `Units: ${req.units ?? "unspecified"}`,
  ];
  if (machine) {
    lines.push("", "## Target machine", "",
      `${machine.make ?? ""} ${machine.model ?? ""} (\`${machine.id ?? "?"}\`) — ${machine.process ?? "?"}`.trim());
  }
  if (reference.length > 0) {
    lines.push("", "## Reference basis", "");
    for (const r of reference) lines.push(`- ${referenceLine(r)}`);
  }
  return lines.join("\n") + "\n";
}

function validationReportMd(job, validation, analysis, req) {
  const lines = [
    `# Validation Report — job \`${job.jobId}\` rev ${job.rev}`,
    "",
    "Every gate below also appears in `manifest.json` `validation[]`; both are",
    "written from the same array in the same pass.",
    "",
    "| gate | result | threshold | measured |",
    "|---|---|---|---|",
    ...validation.map((v) =>
      `| ${v.gate} | ${v.result} | ${v.threshold ?? "—"} | ${v.measured ?? "—"} |`),
  ];
  if (analysis) {
    const d = req.material?.densityKgM3;
    lines.push("", "## Local mesh analysis (stl-analyze)", "",
      `- Bounding box: ${round(analysis.bboxMm.x)} x ${round(analysis.bboxMm.y)} x ${round(analysis.bboxMm.z)} mm`,
      `- Watertight: ${analysis.watertight}`,
      `- Volume: ${round(analysis.volumeMm3, 3)} mm3 (${analysis.triangles} triangles)`,
      ...(d ? [`- Derived mass at ${d} kg/m3: ${round(analysis.volumeMm3 * d * 1e-6, 4)} g`] : []));
  }
  return lines.join("\n") + "\n";
}

// ---- the 13-section manufacturing PDF -------------------------------------

function buildManufacturingPdf({ job, req, part, files, validation, warnings, analysis, reference, artifacts, stamp }) {
  const doc = createPdf();
  const machine = artifacts.machine;
  const density = req.material?.densityKgM3;
  let n = 0;
  const sec = (title) => {
    n += 1;
    doc.space(6).subheading(`${n}. ${title}`).rule();
  };

  doc.heading("Manufacturing Package");
  doc.text(PDF_ADVISORY, { size: 9, bold: true });

  sec(PDF_SECTIONS[0]); // Title Block
  doc.kv("Job ID", job.jobId)
    .kv("Title", req.title ?? "untitled")
    .kv("Revision", String(job.rev))
    .kv("Requester", req.requester ?? "unknown")
    .kv("Packaged", stamp)
    .kv("State", job.state ?? "unknown");

  sec(PDF_SECTIONS[1]); // Design Intent
  doc.text(req.prompt ?? JSON.stringify(req.structuredIntent ?? {}, null, 1));

  sec(PDF_SECTIONS[2]); // Input Measurements
  const stated = statedMeasurements(req.prompt);
  if (stated.length > 0)
    doc.text(`Stated in the request (units ${req.units ?? "?"}): ${stated.join(", ")}`);
  else doc.text(`Request supplied structured intent; units ${req.units ?? "?"}.`);
  if (density != null) doc.text(`Material density (input): ${density} kg/m3`);

  sec(PDF_SECTIONS[3]); // CAD Preview
  const pngEntry = files.find((f) => f.path.startsWith("previews/"));
  if (pngEntry && pngEntry.status === "present")
    doc.text(`Preview image: ${pngEntry.path} (${pngEntry.bytes} bytes)`);
  else doc.text(`Preview SKIPPED: ${pngEntry?.note ?? "not produced"}. CAD source of record: cad/${part}.kcl.`);

  sec(PDF_SECTIONS[4]); // Key Dimensions
  if (analysis) {
    doc.kv("Bounding box", `${round(analysis.bboxMm.x)} x ${round(analysis.bboxMm.y)} x ${round(analysis.bboxMm.z)} mm`)
      .kv("Volume", `${round(analysis.volumeMm3, 3)} mm3`)
      .kv("Watertight", String(analysis.watertight))
      .kv("Triangles", String(analysis.triangles));
    if (density != null)
      doc.kv("Derived mass", `${round(analysis.volumeMm3 * density * 1e-6, 4)} g at ${density} kg/m3`);
  } else {
    doc.text("No mesh in this bundle — dimensions unverified (see Warnings & Assumptions).");
  }

  sec(PDF_SECTIONS[5]); // Material & Machine
  doc.kv("Material", `${req.material?.name ?? "unspecified"} (${density ?? "?"} kg/m3)`);
  if (machine) {
    doc.kv("Machine", `${machine.make ?? ""} ${machine.model ?? ""} (${machine.id ?? "?"})`.trim())
      .kv("Process", machine.process ?? "?")
      .kv("Build volume", machine.buildVolumeMm
        ? `${machine.buildVolumeMm.x} x ${machine.buildVolumeMm.y} x ${machine.buildVolumeMm.z} mm`
        : "unspecified");
    if (machine.notes) doc.text(machine.notes, { size: 8.5 });
  } else {
    doc.text("No machine profile attached to this run.");
  }

  sec(PDF_SECTIONS[6]); // Export List
  doc.table(
    [["path", "status", "bytes", "sha256 (first 16)"],
    ...files.map((f) => [f.path, f.status, f.status === "present" ? String(f.bytes) : "—",
      f.sha256 ? f.sha256.slice(0, 16) : "—"])],
    [0.42, 0.13, 0.12, 0.33],
  );
  doc.text("Full digests and the packageHash recipe live in manifest.json.", { size: 8.5 });

  sec(PDF_SECTIONS[7]); // Validation Results
  if (validation.length > 0)
    doc.table(
      [["gate", "result", "threshold", "measured"],
      ...validation.map((v) => [v.gate, v.result, v.threshold ?? "—", v.measured ?? "—"])],
      [0.3, 0.14, 0.28, 0.28],
    );
  else doc.text("No gates were run against this job — treat as unvalidated.");

  sec(PDF_SECTIONS[8]); // Warnings & Assumptions
  if (warnings.length > 0) for (const w of warnings) doc.text(`- ${w}`, { size: 9 });
  else doc.text("No warnings raised during assembly.", { size: 9 });
  if (reference.length > 0) {
    doc.space(4).text("Reference basis:", { bold: true, size: 9 });
    for (const r of reference) doc.text(`- ${referenceLine(r)}`, { size: 9 });
  }
  doc.space(4).text("Assumption: STL coordinates are millimeters (the pipeline requests and exports mm).", { size: 9 });

  sec(PDF_SECTIONS[9]); // Setup Checklist
  doc.check(`Confirm material stock/filament matches request: ${req.material?.name ?? "unspecified"}.`);
  if (machine && analysis && machine.buildVolumeMm) {
    const bv = machine.buildVolumeMm;
    const fits = analysis.bboxMm.x <= bv.x && analysis.bboxMm.y <= bv.y && analysis.bboxMm.z <= bv.z;
    doc.check(`Verify part envelope ${round(analysis.bboxMm.x)} x ${round(analysis.bboxMm.y)} x ` +
      `${round(analysis.bboxMm.z)} mm fits build volume ${bv.x} x ${bv.y} x ${bv.z} mm ` +
      `(computed: ${fits ? "FITS" : "DOES NOT FIT"}).`);
  }
  if (machine?.nozzleDiameterMm) doc.check(`Confirm nozzle ${machine.nozzleDiameterMm} mm installed.`);
  doc.check(`Load geometry from exports/ — verify file hash against manifest before slicing/setup.`);

  sec(PDF_SECTIONS[10]); // Inspection Checklist
  if (analysis) {
    doc.check(`Measure overall X: expect ${round(analysis.bboxMm.x)} mm.`);
    doc.check(`Measure overall Y: expect ${round(analysis.bboxMm.y)} mm.`);
    doc.check(`Measure overall Z: expect ${round(analysis.bboxMm.z)} mm.`);
    if (density != null)
      doc.check(`Weigh part: expect ~${round(analysis.volumeMm3 * density * 1e-6, 2)} g ` +
        `(volume ${round(analysis.volumeMm3, 1)} mm3 x ${density} kg/m3) if produced in the requested material.`);
  } else {
    doc.check("No mesh shipped — dimensional inspection targets must come from the CAD source.");
  }
  doc.check("Compare features against the design intent statement (section 2).");

  sec(PDF_SECTIONS[11]); // Approval Record
  // "Record" pointed a signer at a file that stays pending forever, because
  // nothing rewrites the bundle after a decision. Point at what actually keeps
  // the record instead of at a snapshot that cannot change.
  doc.kv("State", "pending as of the moment this package was assembled")
    .kv("As issued", "approvals/approvalRecord.json — written once, never updated")
    .kv("Decision record", "the job's ledger — Revision History below prints what it held here")
    .kv("Gate", "WAITING_FOR_HUMAN_REVIEW -> APPROVED requires a HUMAN actor");
  doc.space(6).text(SIGNATURE_MEANING, { size: 9, bold: true });
  // "Approved by" over a line a person signs asserts exactly what the sentence
  // above it denies, and on paper the label is the louder of the two.
  doc.space(10).text("Signed by: ____________________________    Date: ______________", { size: 10 });
  // The section directly above points a signer at the ledger. Nothing told them
  // that the pen in their hand cannot reach it: a name written here is ink on
  // paper and the ledger will never know, which is a surprise worth spending
  // one line to prevent. This is where "what did my signature just do?" gets
  // answered, so the sentence above it does not have to guess.
  //
  // "Only a decision made in the review console" named a UI as the sole route
  // to the ledger, and the code is narrower than that: the row is written by
  // POST /api/jobs/:id/decision (server/api/server.mjs), and the console is one
  // client of that endpoint, not a gate in front of it. A reader told the
  // console is the only way reads a row that arrived over the API as tampering.
  doc.space(4).text(
    "Signing this page does not move the job. A name written here stays on this page and never reaches " +
    "the job's ledger. The job moves only when someone records a decision against it in the software — " +
    "the Approve button in the review console is the usual way to do that, and not the only one.",
    { size: 8 },
  );

  sec(PDF_SECTIONS[12]); // Revision History
  const ledger = Array.isArray(artifacts.ledger) ? artifacts.ledger : [];
  const LEDGER_ROWS_PRINTED = 20;
  if (ledger.length > 0) {
    // Say which rows these are. slice(-20) silently drops the earliest
    // transitions on a long or resumed job, and a reader sent here for "the
    // decision record" would have no way to know a row was missing.
    doc.text(
      ledger.length > LEDGER_ROWS_PRINTED
        ? `The job's ledger held ${ledger.length} rows when this package was assembled; the most ` +
          `recent ${LEDGER_ROWS_PRINTED} are printed below. Nothing decided after assembly is here.`
        : `All ${ledger.length} ledger row${ledger.length === 1 ? "" : "s"} the job held when this ` +
          `package was assembled. Nothing decided after assembly is here.`,
      { size: 8 },
    ).space(4);
    doc.table(
      [["ts", "rev", "transition", "actor", "reason"],
      ...ledger.slice(-LEDGER_ROWS_PRINTED).map((r) => [r.ts, String(r.rev), `${r.from ?? "-"} -> ${r.to}`,
        `${r.actor?.kind ?? "?"}:${r.actor?.id ?? "?"}`, r.reason ?? ""])],
      [0.22, 0.06, 0.3, 0.2, 0.22],
    );
  } else {
    doc.text(
      "No ledger reached this assembly, so there are no transitions to print. The job summary below " +
      "is not the decision record — the job's ledger is.",
      { size: 8 },
    ).space(4);
    doc.table(
      [["rev", "created", "updated", "state"],
      [String(job.rev), job.createdAt ?? "n/a", job.updatedAt ?? "n/a", job.state ?? "n/a"]],
      [0.1, 0.32, 0.32, 0.26],
    );
  }

  return doc.render();
}

// ---- DoD master checklist --------------------------------------------------

// Files the DoD demands with status "present"; step/png may be skipped-with-note.
const DOD_REQUIRED = [
  ["generationRequest.json", (p) => p === "generationRequest.json"],
  ["designIntent.md", (p) => p === "designIntent.md"],
  ["cad/<part>.kcl", (p) => /^cad\/.+\.kcl$/.test(p)],
  ["exports/<part>.stl", (p) => /^exports\/.+\.stl$/.test(p)],
  ["reports/validationReport.md", (p) => p === "reports/validationReport.md"],
  ["reports/manufacturingPackage.pdf", (p) => p === "reports/manufacturingPackage.pdf"],
  ["logs/apiRun.json", (p) => p === "logs/apiRun.json"],
  ["approvals/approvalRecord.json", (p) => p === "approvals/approvalRecord.json"],
];
const DOD_OPTIONAL = [/^exports\/.+\.step$/, /^previews\/.+\.png$/];

/**
 * Re-audit a bundle on disk against the Definition of Done. Trusts nothing:
 * re-reads every file, re-hashes, recomputes packageHash, and cross-checks
 * the validation report against the manifest.
 * @returns {{complete: boolean, misses: string[]}}
 */
export function dodCheck(bundleDir) {
  const misses = [];
  const manifestPath = join(bundleDir, "manifest.json");
  if (!existsSync(manifestPath))
    return { complete: false, misses: ["manifest.json missing — bundle is unsealed"] };
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    return { complete: false, misses: [`manifest.json unparseable: ${e.message}`] };
  }

  for (const k of ["jobId", "revision", "packageStatus", "completedAt", "packageHash"])
    if (manifest[k] == null) misses.push(`manifest.${k} missing`);
  const files = Array.isArray(manifest.files) ? manifest.files : (misses.push("manifest.files missing"), []);

  for (const [label, match] of DOD_REQUIRED) {
    const entry = files.find((f) => match(f.path));
    if (!entry) misses.push(`${label}: no manifest entry`);
    else if (entry.status !== "present") misses.push(`${label}: REQUIRED but status is "${entry.status}"`);
  }

  for (const f of files) {
    if (f.status === "skipped") {
      if (!f.note) misses.push(`${f.path}: skipped without a note`);
      if (!DOD_OPTIONAL.some((re) => re.test(f.path)) && !/^exports\/.+\.stl$/.test(f.path))
        misses.push(`${f.path}: skipped but not an optional file`);
      if (!(manifest.warnings ?? []).some((w) => w.includes(f.path)))
        misses.push(`${f.path}: skip not mirrored into manifest.warnings`);
      continue;
    }
    const abs = join(bundleDir, f.path);
    if (!existsSync(abs)) { misses.push(`${f.path}: listed present but missing on disk`); continue; }
    const bytes = readFileSync(abs);
    if (bytes.length !== f.bytes) misses.push(`${f.path}: size mismatch (disk ${bytes.length}, manifest ${f.bytes})`);
    if (sha256(bytes) !== f.sha256) misses.push(`${f.path}: sha256 mismatch — content altered after sealing`);
  }

  const recomputed = packageHashOf(files.filter((f) => f.status === "present").map((f) => f.sha256));
  if (recomputed !== manifest.packageHash)
    misses.push(`packageHash mismatch: manifest ${manifest.packageHash}, recomputed ${recomputed}`);

  const pdfEntry = files.find((f) => f.path === "reports/manufacturingPackage.pdf" && f.status === "present");
  if (pdfEntry && existsSync(join(bundleDir, pdfEntry.path))) {
    const head = readFileSync(join(bundleDir, pdfEntry.path)).subarray(0, 5).toString();
    if (head !== "%PDF-") misses.push("manufacturingPackage.pdf: does not start with %PDF-");
  }

  const reportPath = join(bundleDir, "reports/validationReport.md");
  if (existsSync(reportPath)) {
    const report = readFileSync(reportPath, "utf8");
    for (const v of manifest.validation ?? [])
      if (!report.includes(v.gate) || !report.includes(v.result))
        misses.push(`validationReport.md: gate ${v.gate} (${v.result}) not reflected in the report`);
  }

  return { complete: misses.length === 0, misses };
}

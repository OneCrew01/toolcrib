#!/usr/bin/env node
// Recover a campaign run whose ledger contains dispatch/poll casualties.
// Generations keep running server-side even when the client loses track of them
// (FN-011: /async/operations/{id} is eventually consistent — an early 404 does not
// mean the job doesn't exist). This re-polls every non-valid ledger entry by id,
// re-runs the mass gate, and writes ledger-recovered.jsonl + summary-recovered.md.
//
//   node server/harness/recover-run.mjs <campaign-name> <stamp>
//   e.g. node server/harness/recover-run.mjs c001-fastening-reliability 2026-07-22-09-50

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { zooClient } from "../lib/zoo.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const [name, stamp] = process.argv.slice(2);
if (!name || !stamp) {
  console.error("usage: node server/harness/recover-run.mjs <campaign-name> <stamp>");
  process.exit(1);
}

const campaign = (await import(pathToFileURL(join(HERE, "campaigns", `${name}.mjs`)))).default;
const dir = join(HERE, "results", name, stamp);
const entries = readFileSync(join(dir, "ledger.jsonl"), "utf8")
  .trim().split("\n").map((l) => JSON.parse(l));

const zoo = zooClient();

// The original runner had a bug: on poll-throw the ledger entry lost its job id.
// The id survives inside the error string — parse it back out.
const idOf = (e) => e.t2cId ?? e.error?.match(/async\/operations\/([0-9a-f-]{36})/)?.[1] ?? null;

const recovered = [];
for (const e of entries) {
  const id = idOf(e);
  if (e.verdict === "completed_valid" || !id) { recovered.push(e); continue; }
  e.t2cId = id;
  process.stdout.write(`recovering ${e.caseId} r${e.runIdx} (${e.t2cId}) … `);
  try {
    // status + code from the user surface (reliable); outputs from async ops (may be gone — FN-011)
    const r = await zoo.getTextToCad(e.t2cId);
    const upd = { ...e, recoveredAt: new Date().toISOString(), kclChars: r.code?.length ?? 0 };
    if (r.code) writeFileSync(join(dir, "kcl", `${e.caseId}-r${e.runIdx}.kcl`), r.code);
    if (r.status === "failed") { recovered.push({ ...upd, verdict: "generation_failed", error: r.error ?? null }); console.log("generation_failed"); continue; }
    if (r.status !== "completed") { recovered.push({ ...upd, verdict: `still_${r.status}` }); console.log(`still ${r.status}`); continue; }
    const outputs = await zoo.fetchOutputs(e.t2cId, { tries: 2, delayS: 3 });
    if (!outputs) { recovered.push({ ...upd, verdict: "completed_outputs_unreachable", error: null }); console.log("completed, outputs unreachable (KCL saved)"); continue; }
    const b64 = outputs["source.step"];
    if (!b64) { recovered.push({ ...upd, verdict: "completed_no_outputs" }); console.log("no outputs"); continue; }
    const massG = await zoo.massG(zoo.decodeOutput(b64));
    const ok = massG >= e.expectedMinG && massG <= e.expectedMaxG;
    recovered.push({ ...upd, massG: Math.round(massG * 10000) / 10000, verdict: ok ? "completed_valid" : "completed_invalid", error: null });
    console.log(`${ok ? "VALID" : "INVALID"} mass=${massG.toFixed(4)}g`);
  } catch (err) {
    recovered.push({ ...e, verdict: "unrecoverable", error: String(err.message ?? err).slice(0, 200) });
    console.log("unrecoverable");
  }
}

writeFileSync(join(dir, "ledger-recovered.jsonl"), recovered.map((r) => JSON.stringify(r)).join("\n") + "\n");

// summary
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "—");
let md = `# ${name} — run ${stamp} (RECOVERED)\n\nOriginal run lost ${entries.filter((e) => e.verdict !== "completed_valid").length} entries to early-404 polling (FN-011); re-polled by id.\n\n`;
md += `| case | runs | valid | invalid | gen-failed | outputs-lost | other | pass rate | mass values (g) | kcl chars | note |\n|---|---|---|---|---|---|---|---|---|---|---|\n`;
for (const c of campaign.cases) {
  const rs = recovered.filter((r) => r.caseId === c.id);
  const n = (v) => rs.filter((r) => r.verdict === v).length;
  const named = n("completed_valid") + n("completed_invalid") + n("generation_failed") + n("completed_outputs_unreachable");
  const masses = [...new Set(rs.filter((r) => r.massG != null).map((r) => r.massG.toFixed(4)))].join(", ");
  const kcls = [...new Set(rs.filter((r) => r.kclChars).map((r) => r.kclChars))].join(", ");
  md += `| ${c.id} | ${rs.length} | ${n("completed_valid")} | ${n("completed_invalid")} | ${n("generation_failed")} | ${n("completed_outputs_unreachable")} | ${rs.length - named} | ${pct(n("completed_valid"), rs.length)} | ${masses} | ${kcls} | ${c.expected.note ?? ""} |\n`;
}
md += `\n\`invalid\` = completed status, geometry outside the analytic mass bounds — the category the status field cannot see.\n`;
writeFileSync(join(dir, "summary-recovered.md"), md);
console.log(`\n${md}`);

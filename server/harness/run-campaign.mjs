#!/usr/bin/env node
// Campaign runner — the "night team". Executes a campaign module: a designed grid of
// prompts, N runs each, every completed output pushed through the validation gate.
//
//   npm run campaign -- c001-fastening-reliability            run it
//   npm run campaign -- c001-fastening-reliability --dry      show the plan, no API calls
//   flags: --runs=N (override per-case runs) --concurrency=N --cap-usd=N
//
// Add an experiment: copy campaigns/_template.mjs, edit, drop it in campaigns/.
// Results land in results/<campaign>/<stamp>/: ledger.jsonl (one line per run),
// summary.md (per-case stats + cost), kcl/ (returned code per run — the diff evidence).
//
// Verdicts:
//   completed_valid      geometry passed the mass gate
//   completed_invalid    generation "succeeded" but mass is outside expected bounds ← the money category
//   completed_no_outputs completed but no exported files on the async surface
//   generation_failed    Zoo returned status=failed
//   timeout_client       no terminal status within timeoutMin
//   validation_error     mass check itself errored

import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { zooClient } from "../lib/zoo.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------- args ----------
const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--"));
if (!name) {
  console.error("usage: npm run campaign -- <campaign-name> [--dry] [--runs=N] [--concurrency=N] [--cap-usd=N]");
  process.exit(1);
}
const flag = (k) => {
  const hit = args.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split("=")[1] : undefined;
};
const DRY = args.includes("--dry");

// ---------- load campaign ----------
const file = name.endsWith(".mjs") ? name : `${name}.mjs`;
const campaign = (await import(pathToFileURL(join(HERE, "campaigns", file)))).default;
const settings = {
  concurrency: Number(flag("concurrency") ?? campaign.settings?.concurrency ?? 2),
  timeoutMin: Number(campaign.settings?.timeoutMin ?? 20),
  capUsd: Number(flag("cap-usd") ?? campaign.settings?.capUsd ?? 20),
};
const runsOverride = flag("runs") ? Number(flag("runs")) : null;

const queue = campaign.cases.flatMap((c) =>
  Array.from({ length: runsOverride ?? c.runs }, (_, i) => ({ c, runIdx: i + 1 })),
);

console.log(`campaign: ${campaign.name} — ${campaign.description}`);
console.log(`plan: ${campaign.cases.length} cases, ${queue.length} runs, concurrency ${settings.concurrency}, cap $${settings.capUsd}, timeout ${settings.timeoutMin}m/run`);
for (const c of campaign.cases)
  console.log(`  ${c.id} ×${runsOverride ?? c.runs} [${c.expected.minG}g..${c.expected.maxG}g${c.strict ? "" : " loose"}] ${c.prompt.slice(0, 80)}…`);
if (DRY) process.exit(0);

// ---------- setup ----------
const zoo = zooClient();
const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
const outDir = join(HERE, "results", campaign.name, stamp);
mkdirSync(join(outDir, "kcl"), { recursive: true });
const ledgerPath = join(outDir, "ledger.jsonl");
const log = (obj) => appendFileSync(ledgerPath, JSON.stringify(obj) + "\n");

const balanceStart = await zoo.balanceUsd();
console.log(`balance at start: $${balanceStart.toFixed(2)}`);
let stop = false;
const results = [];

// ---------- one run ----------
async function runOne({ c, runIdx }) {
  const label = `${c.id} r${runIdx}`;
  const base = {
    ts: new Date().toISOString(),
    campaign: campaign.name,
    caseId: c.id,
    runIdx,
    expectedMinG: c.expected.minG,
    expectedMaxG: c.expected.maxG,
    strict: c.strict !== false,
  };
  let jobId = null;
  try {
    const job = await zoo.startTextToCad(c.prompt, c.format ?? "step");
    jobId = job.id;
    const { status, record, latencyS } = await zoo.waitTextToCad(job.id, { timeoutMin: settings.timeoutMin });
    const entry = { ...base, t2cId: job.id, latencyS: Math.round(latencyS * 10) / 10, kclChars: record?.code?.length ?? 0 };

    if (record?.code) writeFileSync(join(outDir, "kcl", `${c.id}-r${runIdx}.kcl`), record.code);

    if (status === "failed") return { ...entry, verdict: "generation_failed", error: record?.error ?? null };
    if (status === "timeout") return { ...entry, verdict: "timeout_client" };

    const outputs = await zoo.fetchOutputs(job.id);
    if (!outputs) return { ...entry, verdict: "completed_outputs_unreachable" }; // FN-011
    const stepB64 = outputs["source.step"];
    if (!stepB64) return { ...entry, verdict: "completed_no_outputs" };

    try {
      const massG = await zoo.massG(zoo.decodeOutput(stepB64), {
        densityKgM3: c.expected.densityKgM3 ?? 2700,
      });
      const ok = massG >= c.expected.minG && massG <= c.expected.maxG;
      return { ...entry, massG: Math.round(massG * 10000) / 10000, verdict: ok ? "completed_valid" : "completed_invalid" };
    } catch (e) {
      return { ...entry, verdict: "validation_error", error: String(e.message ?? e) };
    }
  } catch (e) {
    return { ...base, t2cId: jobId, verdict: jobId ? "poll_error" : "dispatch_error", error: String(e.message ?? e) };
  } finally {
    console.log(`done: ${label}`);
  }
}

// ---------- worker pool with budget guard ----------
let cursor = 0;
async function worker(wid) {
  while (!stop && cursor < queue.length) {
    const item = queue[cursor++];
    const r = await runOne(item);
    results.push(r);
    log(r);
    try {
      const bal = await zoo.balanceUsd();
      if (balanceStart - bal > settings.capUsd) {
        stop = true;
        console.log(`budget cap hit ($${(balanceStart - bal).toFixed(2)} > $${settings.capUsd}) — stopping gracefully`);
      }
    } catch { /* balance check is best-effort */ }
  }
}
await Promise.all(Array.from({ length: settings.concurrency }, (_, i) => worker(i)));

// ---------- summary ----------
const balanceEnd = await zoo.balanceUsd();
const spent = balanceStart - balanceEnd;
const byCase = new Map(campaign.cases.map((c) => [c.id, results.filter((r) => r.caseId === c.id)]));
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "—");
const stats = (xs) => {
  if (!xs.length) return { min: "—", med: "—", max: "—" };
  const s = [...xs].sort((a, b) => a - b);
  return { min: s[0], med: s[Math.floor(s.length / 2)], max: s[s.length - 1] };
};

let md = `# ${campaign.name} — run ${stamp}\n\n${campaign.description}\n\n`;
md += `Runs: ${results.length}/${queue.length}${stop ? " (stopped at budget cap)" : ""} · concurrency ${settings.concurrency} · spend **$${spent.toFixed(2)}** (avg $${(spent / Math.max(1, results.length)).toFixed(3)}/run) · balance $${balanceEnd.toFixed(2)}\n\n`;
md += `| case | runs | valid | invalid | gen-failed | timeout | other | pass rate | latency s (min/med/max) | note |\n|---|---|---|---|---|---|---|---|---|---|\n`;
for (const [id, rs] of byCase) {
  const c = campaign.cases.find((x) => x.id === id);
  const n = (v) => rs.filter((r) => r.verdict === v).length;
  const lat = stats(rs.filter((r) => r.latencyS).map((r) => r.latencyS));
  const other = rs.length - n("completed_valid") - n("completed_invalid") - n("generation_failed") - n("timeout_client");
  md += `| ${id} | ${rs.length} | ${n("completed_valid")} | ${n("completed_invalid")} | ${n("generation_failed")} | ${n("timeout_client")} | ${other} | ${pct(n("completed_valid"), rs.length)} | ${lat.min}/${lat.med}/${lat.max} | ${c.expected.note ?? ""} |\n`;
}
md += `\n**Reading it:** \`invalid\` = Zoo said completed, the mass gate said the geometry is wrong — the category the status field cannot see.\n`;
md += `\nLedger: \`ledger.jsonl\` · KCL per run: \`kcl/\` · Candidate field-note material: any case with invalid>0 or mixed pass/fail.\n`;
writeFileSync(join(outDir, "summary.md"), md);
console.log(`\n${md}`);
console.log(`results: ${outDir}`);

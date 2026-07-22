#!/usr/bin/env node
// Independent verification of FN-006: does the countersink fastening prompt fail,
// and does the error leak internal cluster DNS? Heartbeats + a VERDICT line. Untracked probe.
import { readFileSync, existsSync } from "node:fs";
const BASE = "https://api.zoo.dev";
function loadToken() {
  if (process.env.ZOO_API_TOKEN) return process.env.ZOO_API_TOKEN;
  if (existsSync(".env")) { const m = readFileSync(".env", "utf8").match(/^ZOO_API_TOKEN=(.+)$/m); if (m) return m[1].trim(); }
  console.error("no ZOO_API_TOKEN"); process.exit(1);
}
const TOKEN = loadToken();
const HDRS = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prompt = "A 50mm x 50mm x 2mm aluminum plate with four 5mm diameter holes, one near each corner, each hole center 10mm from both adjacent edges, each hole countersunk at 100 degrees to sit a flush flat-head screw";
const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1);
const job = await (await fetch(`${BASE}/ai/text-to-cad/step?kcl=true`, { method: "POST", headers: HDRS, body: JSON.stringify({ prompt }) })).json();
console.log(`POSTed countersink prompt -> id ${job.id} (${el()}s)`);
for (;;) {
  const r = await (await fetch(`${BASE}/async/operations/${job.id}`, { headers: HDRS })).json();
  console.log(`[${el()}s] status=${r.status}`);
  if (r.status === "completed") { console.log(`VERDICT id=${job.id} elapsed=${el()}s status=COMPLETED reproducedFailure=NO hasOutputs=${!!r.outputs}`); break; }
  if (r.status === "failed") { const err = String(r.error ?? JSON.stringify(r)); const leak = /svc\.cluster\.local/.test(err); console.log(`ERRTEXT: ${err}`); console.log(`VERDICT id=${job.id} elapsed=${el()}s status=FAILED clusterDNSLeak=${leak}`); break; }
  await sleep(10000);
  if (Date.now() - t0 > 15 * 60 * 1000) { console.log(`VERDICT elapsed=${el()}s status=TIMEOUT_GIVEUP`); break; }
}

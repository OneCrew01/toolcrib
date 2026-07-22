#!/usr/bin/env node
// Day-1 thin thread: intent → Zoo text-to-CAD (KCL + export) → mass validation.
// Zero dependencies; Node 18+. Token comes from ZOO_API_TOKEN or a local .env file.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const BASE = "https://api.zoo.dev";

function loadToken() {
  if (process.env.ZOO_API_TOKEN) return process.env.ZOO_API_TOKEN;
  if (existsSync(".env")) {
    const m = readFileSync(".env", "utf8").match(/^ZOO_API_TOKEN=(.+)$/m);
    if (m) return m[1].trim();
  }
  console.error("No ZOO_API_TOKEN in env or .env — see .env.example");
  process.exit(1);
}

const TOKEN = loadToken();
const HDRS = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, { headers: HDRS, ...opts });
  if (!res.ok) throw new Error(`${opts.method ?? "GET"} ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function textToCad(prompt, format = "step") {
  const t0 = Date.now();
  const job = await api(`/ai/text-to-cad/${format}?kcl=true`, {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });
  console.log(`queued ${job.id}`);
  for (;;) {
    // NB: poll /async/operations, NOT /user/text-to-cad — only the former
    // includes the `outputs` files on completion (see FN-007).
    const r = await api(`/async/operations/${job.id}`);
    if (r.status === "completed") {
      console.log(`completed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return r;
    }
    if (r.status === "failed") throw new Error(`generation failed: ${r.error}`);
    await sleep(3000);
  }
}

async function massOf(filename, b64, materialDensity = 2700) {
  // density in kg/m^3 (2700 ≈ aluminum); src format inferred from extension
  const src = filename.endsWith(".step") ? "step" : "stl";
  const res = await fetch(
    `${BASE}/file/mass?material_density=${materialDensity}&material_density_unit=kg:m3&src_format=${src}&output_unit=g`,
    { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: Buffer.from(b64, "base64") },
  );
  if (!res.ok) throw new Error(`/file/mass → ${res.status}: ${await res.text()}`);
  return res.json();
}

const prompt =
  process.argv.slice(2).join(" ") ||
  "A 50mm x 50mm x 2mm aluminum plate with four 5mm diameter holes, one near each corner, each hole center 10mm from both adjacent edges, each hole countersunk at 100 degrees to sit a flush flat-head screw";

const slug = process.env.TOOLCRIB_SLUG || "flush-plate";
const outDir = join("samples", slug);
mkdirSync(outDir, { recursive: true });

const result = await textToCad(prompt, process.env.TOOLCRIB_FORMAT || "step");
writeFileSync(join(outDir, "part.kcl"), result.code ?? "");
console.log(`KCL: ${(result.code ?? "").length} chars → ${join(outDir, "part.kcl")}`);

let stepB64 = null;
for (const [name, b64] of Object.entries(result.outputs ?? {})) {
  const clean = name.replace(/[^\w.-]/g, "_");
  writeFileSync(join(outDir, clean), Buffer.from(b64, "base64"));
  console.log(`output: ${clean}`);
  if (clean.endsWith(".step")) stepB64 = b64;
}

if (stepB64) {
  const mass = await massOf("part.step", stepB64);
  writeFileSync(join(outDir, "validation.json"), JSON.stringify(mass, null, 2));
  console.log(`validation (mass, aluminum): ${JSON.stringify(mass)}`);
}

writeFileSync(
  join(outDir, "intent.json"),
  JSON.stringify({ prompt, generated: new Date().toISOString(), textToCadId: result.id }, null, 2),
);
console.log("thin thread complete.");

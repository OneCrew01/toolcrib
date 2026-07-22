import { readFileSync } from "node:fs";
const BASE = "https://api.zoo.dev";
const TOKEN = process.env.ZOO_API_TOKEN || readFileSync(".env", "utf8").match(/^ZOO_API_TOKEN=(.+)$/m)[1].trim();
const H = { Authorization: `Bearer ${TOKEN}` };
const id = process.argv[2] || "289cec14-f654-4afe-92dc-734c63e52896";
const op = await (await fetch(`${BASE}/async/operations/${id}`, { headers: H })).json();
const outs = op.outputs || {};
const kcl = op.code || op.kcl || "";
console.log("status:", op.status, "| outputs:", Object.keys(outs).join(", "));
console.log("KCL chars:", kcl.length);
console.log("KCL feature words:", (kcl.match(/countersink|counterbore|chamfer|cone|revolve|loft|angle|taper/gi) || []).join(",") || "(none found)");
const stepName = Object.keys(outs).find((n) => n.endsWith(".step"));
if (stepName) {
  const res = await fetch(`${BASE}/file/mass?material_density=2700&material_density_unit=kg:m3&src_format=step&output_unit=g`, { method: "POST", headers: H, body: Buffer.from(outs[stepName], "base64") });
  console.log("MASS g:", await res.text());
  console.log("BASELINE plain-holes plate (FN-008): 13.0786 g  |  countersunk should be LIGHTER");
}

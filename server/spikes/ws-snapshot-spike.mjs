// PNG preview over the modeling websocket — FN-021 candidate.
//
// Rung 1: build the proven 10mm demo cube, zoom_to_fit, take_snapshot {png};
//         decode base64 and verify the \x89PNG magic (proof saved to --out).
// Rung 2: import_files with the real plain-plate fixture, zoom_to_fit,
//         take_snapshot; save samples/plain-plate/preview.png (offline demo
//         fixture for the DoD preview slot).
//
// Spec truths (zoo OpenAPI, components.schemas):
//   take_snapshot  req {type, format: "png"|"jpeg"}  -> resp data {contents: base64}
//   zoom_to_fit    req {type, object_ids: [], padding, animated} -> CameraSettings
//   import_files   req {type, files: [{path, data: uint8[]}], format: InputFormat3d}
//                  -> resp data {object_id}
//
// Measured 2026-07-23 (all imports as plain JSON text frames, data: uint8[]):
//   --fmt step          engine-exported AP242 STEP -> internal_engine "import failed"
//                       (sometimes no reply at all: 15s timeout)
//   --fmt gltf / glb    Zoo's own glTF export -> internal_engine "import failed"
//   --rung probe        minimal inline OBJ cube -> imports fine (transport is not the problem)
//   --rung probe-gltf   minimal hand-built glTF -> imports fine (gltf importer is not the problem)
//   --fmt gltf-stripped fixture glTF with the KITTYCAD_boundary_representation
//                       extension removed -> imports fine. Root cause: the engine
//                       rejects its own BREP extension on re-import.
//   --fmt obj           REST /file/conversion/step/obj, then ws import (units m) -> works
//
// Default route is gltf-stripped: lossless (mesh untouched), ws-only, no REST hop.
//
// Run: node server/spikes/ws-snapshot-spike.mjs [--rung probe|probe-gltf|1|2|all]
//        [--fmt step|gltf|glb|gltf-stripped|obj] [--out cube-proof.png]

import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withModelingSession } from "../generators/ws-helpers.mjs";
import { loadToken } from "../lib/zoo.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURES = {
  step: { file: join(ROOT, "samples", "plain-plate", "source.step"), format: { type: "step" } },
  gltf: { file: join(ROOT, "samples", "plain-plate", "source.gltf"), format: { type: "gltf" } },
  glb: { file: join(ROOT, "samples", "plain-plate", "source.gltf"), format: { type: "gltf" } },
  "gltf-stripped": { file: join(ROOT, "samples", "plain-plate", "source.gltf"), format: { type: "gltf" } },
  obj: {
    file: join(ROOT, "samples", "plain-plate", "source.step"),
    format: { type: "obj", coords: { forward: { axis: "y", direction: "negative" }, up: { axis: "z", direction: "positive" } }, units: "m" },
  },
};
const PREVIEW_OUT = join(ROOT, "samples", "plain-plate", "preview.png");
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

// Lossless repack: .gltf (JSON, data-URI buffer) -> .glb container.
// Same fixture geometry, binary framing — tests the "Binary glTF" reading
// of the spec's gltf import variant.
function gltfToGlb(gltfJsonBytes) {
  const doc = JSON.parse(gltfJsonBytes.toString("utf8"));
  const uri = doc.buffers?.[0]?.uri ?? "";
  const b64 = uri.split("base64,")[1];
  if (!b64) throw new Error("gltf buffer is not an embedded data URI");
  const bin = Buffer.from(b64, "base64");
  delete doc.buffers[0].uri;
  doc.buffers[0].byteLength = bin.length;
  const pad4 = (buf, fill) => {
    const rem = buf.length % 4;
    return rem ? Buffer.concat([buf, Buffer.alloc(4 - rem, fill)]) : buf;
  };
  const json = pad4(Buffer.from(JSON.stringify(doc), "utf8"), 0x20);
  const binPadded = pad4(bin, 0x00);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + binPadded.length, 8);
  const chunk = (type, data) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, data]);
  };
  return Buffer.concat([header, chunk(0x4e4f534a, json), chunk(0x004e4942, binPadded)]);
}

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const rung = flag("rung", "all");
const cubeOut = flag("out", join(tmpdir(), "toolcrib-cube-snapshot.png"));
const fmt = flag("fmt", "gltf-stripped"); // step | gltf | glb | gltf-stripped | obj

// Response envelope (FN-013..016): {success, request_id, resp:{type:"modeling",
// data:{modeling_response:{type, data}}}}. Simple acks omit modeling_response.
const inner = (msg) => msg.resp?.data?.modeling_response ?? msg.resp;

// Shape of a response with big strings elided — the transcript is the deliverable.
function shape(node, depth = 0) {
  if (typeof node === "string") return node.length > 48 ? `<string:${node.length}b>` : JSON.stringify(node);
  if (node === null || typeof node !== "object") return JSON.stringify(node);
  if (Array.isArray(node)) return `[${node.length} items]`;
  if (depth >= 3) return "{...}";
  const parts = Object.entries(node).map(([k, v]) => `${k}: ${shape(v, depth + 1)}`);
  return `{${parts.join(", ")}}`;
}

async function timed(label, promise) {
  const t0 = Date.now();
  const r = await promise;
  console.log(`  ${label} -> ${Date.now() - t0}ms  ${shape(inner(r))}`);
  return r;
}

async function snapshotPng(s) {
  const snap = await timed("take_snapshot {format:png}", s.cmd({ type: "take_snapshot", format: "png" }));
  const b64 = inner(snap)?.data?.contents;
  if (typeof b64 !== "string") throw new Error(`no contents in take_snapshot resp: ${shape(snap.resp)}`);
  const png = Buffer.from(b64, "base64");
  if (!png.subarray(0, 4).equals(PNG_MAGIC)) {
    throw new Error(`decoded bytes are not PNG (first 4: ${png.subarray(0, 4).toString("hex")})`);
  }
  return png;
}

// The proven 7-command cube (same sequence boxBoundingBox uses).
async function buildCube(s, mm = 10) {
  const path = await timed("start_path", s.cmd({ type: "start_path" }));
  const P = path.cmd_id;
  await timed("move_path_pen", s.cmd({ type: "move_path_pen", path: P, to: { x: -mm / 2, y: -mm / 2, z: 0 } }));
  for (const [x, y] of [[mm / 2, -mm / 2], [mm / 2, mm / 2], [-mm / 2, mm / 2]]) {
    await timed("extend_path", s.cmd({ type: "extend_path", path: P, segment: { type: "line", end: { x, y, z: 0 }, relative: false } }));
  }
  await timed("close_path", s.cmd({ type: "close_path", path_id: P }));
  await timed("extrude", s.cmd({ type: "extrude", target: P, distance: mm }));
}

async function rung1() {
  console.log("RUNG 1: demo cube -> zoom_to_fit -> take_snapshot");
  const t0 = Date.now();
  const png = await withModelingSession(async (s) => {
    await buildCube(s);
    await timed("zoom_to_fit", s.cmd({ type: "zoom_to_fit", object_ids: [], padding: 0.2, animated: false }));
    return snapshotPng(s);
  });
  await writeFile(cubeOut, png);
  console.log(`  PNG verified (\\x89PNG), ${png.length} bytes -> ${cubeOut}`);
  console.log(`  session total ${Date.now() - t0}ms`);
}

async function rung2() {
  const fixture = FIXTURES[fmt];
  console.log(`RUNG 2: import_files(source.${fmt}) -> zoom_to_fit -> take_snapshot`);
  let bytes = await readFile(fixture.file);
  if (fmt === "glb") bytes = gltfToGlb(bytes);
  if (fmt === "obj") bytes = await convertStep(bytes, "obj"); // engine-native meters
  if (fmt === "gltf-stripped") {
    // Remove the KITTYCAD_boundary_representation extension, keep the mesh.
    const doc = JSON.parse(bytes.toString("utf8"));
    delete doc.extensionsUsed;
    for (const n of doc.nodes ?? []) delete n.extensions;
    delete doc.extensions;
    bytes = Buffer.from(JSON.stringify(doc), "utf8");
  }
  console.log(`  import payload ${bytes.length} bytes (from ${fixture.file})`);
  const importPath = fmt === "gltf-stripped" ? "source.gltf" : `source.${fmt}`;
  const t0 = Date.now();
  const png = await withModelingSession(async (s) => {
    const imp = await timed(
      "import_files",
      s.cmd({
        type: "import_files",
        files: [{ path: importPath, data: Array.from(bytes) }],
        format: fixture.format,
      }),
    );
    const objectId = inner(imp)?.data?.object_id;
    if (!objectId) throw new Error(`no object_id in import_files resp: ${shape(imp.resp)}`);
    const bb = await timed("bounding_box", s.cmd({ type: "bounding_box", entity_ids: [], output_unit: "mm" }));
    console.log(`  scale check (expect ~50x50x2mm plate): ${JSON.stringify(inner(bb)?.data ?? bb.resp).slice(0, 200)}`);
    await timed("zoom_to_fit", s.cmd({ type: "zoom_to_fit", object_ids: [], padding: 0.2, animated: false }));
    return snapshotPng(s);
  });
  await writeFile(PREVIEW_OUT, png);
  console.log(`  PNG verified (\\x89PNG), ${png.length} bytes -> ${PREVIEW_OUT}`);
  console.log(`  session total ${Date.now() - t0}ms (ws only; REST convert excluded)`);
}

// REST fallback leg: convert the STEP fixture to OBJ server-side, then
// ws-import the OBJ (the one format the ws importer accepts, per probes).
async function convertStep(bytes, outFmt) {
  const t0 = Date.now();
  const res = await fetch(`https://api.zoo.dev/file/conversion/step/${outFmt}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${loadToken()}` },
    body: bytes,
  });
  if (!res.ok) throw new Error(`/file/conversion/step/${outFmt} -> ${res.status}: ${await res.text()}`);
  const r = await res.json();
  if (r.status !== "completed" || !r.outputs) {
    throw new Error(`conversion not synchronous: status=${r.status} outputs=${r.outputs ? Object.keys(r.outputs) : null}`);
  }
  const name = Object.keys(r.outputs)[0];
  const out = Buffer.from(r.outputs[name], "base64");
  console.log(`  REST convert step->${outFmt} -> ${Date.now() - t0}ms  {status: "${r.status}", outputs: {${name}: <${out.length}b>}}`);
  return out;
}

// Probe: minimal inline OBJ cube over the same JSON text-frame path.
// Isolates transport (JSON uint8[] data) from format-specific import bugs.
const OBJ_CUBE = [
  "v 0 0 0", "v 10 0 0", "v 10 10 0", "v 0 10 0",
  "v 0 0 10", "v 10 0 10", "v 10 10 10", "v 0 10 10",
  "f 1 2 3 4", "f 5 8 7 6", "f 1 5 6 2", "f 2 6 7 3", "f 3 7 8 4", "f 4 8 5 1", "",
].join("\n");

async function probe() {
  console.log("PROBE: import_files(inline cube.obj, JSON text frame)");
  const bytes = Buffer.from(OBJ_CUBE, "utf8");
  await withModelingSession(async (s) => {
    const imp = await timed(
      "import_files",
      s.cmd({
        type: "import_files",
        files: [{ path: "cube.obj", data: Array.from(bytes) }],
        format: {
          type: "obj",
          coords: { forward: { axis: "y", direction: "negative" }, up: { axis: "z", direction: "positive" } },
          units: "mm",
        },
      }),
    );
    console.log(`  object_id: ${inner(imp)?.data?.object_id}`);
  });
}

// Probe: minimal hand-built glTF cube (indexed, embedded buffer, no
// extensions). Distinguishes "ws gltf import is broken" from "the
// KITTYCAD_boundary_representation fixture trips it".
async function probeGltf() {
  console.log("PROBE-GLTF: import_files(minimal cube.gltf, JSON text frame)");
  const pos = new Float32Array([0,0,0, 10,0,0, 10,10,0, 0,10,0, 0,0,10, 10,0,10, 10,10,10, 0,10,10]);
  const idx = new Uint16Array([0,1,2, 0,2,3, 4,6,5, 4,7,6, 0,4,5, 0,5,1, 1,5,6, 1,6,2, 2,6,7, 2,7,3, 3,7,4, 3,4,0]);
  const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(idx.buffer)]);
  const doc = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: "VEC3", min: [0, 0, 0], max: [10, 10, 10] },
      { bufferView: 1, componentType: 5123, count: 36, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.byteLength },
      { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength },
    ],
    buffers: [{ byteLength: bin.length, uri: `data:application/octet-stream;base64,${bin.toString("base64")}` }],
  };
  const bytes = Buffer.from(JSON.stringify(doc), "utf8");
  await withModelingSession(async (s) => {
    const imp = await timed(
      "import_files",
      s.cmd({ type: "import_files", files: [{ path: "cube.gltf", data: Array.from(bytes) }], format: { type: "gltf" } }),
    );
    console.log(`  object_id: ${inner(imp)?.data?.object_id}`);
  });
}

try {
  if (rung === "probe") await probe();
  if (rung === "probe-gltf") await probeGltf();
  if (rung === "1" || rung === "all") await rung1();
  if (rung === "2" || rung === "all") await rung2();
  console.log("DONE");
} catch (err) {
  console.error(`FAIL: ${err.message}`);
  if (err.msg?.errors) console.error(`  server errors: ${JSON.stringify(err.msg.errors)}`);
  else if (err.msg) console.error(`  server said: ${shape(err.msg)}`);
  process.exit(1);
}

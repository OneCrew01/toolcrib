// One-shot cross-check: local signed-tetrahedra centroid vs Zoo's
// POST /file/center-of-mass on the same STL bytes — the FN-021 pattern
// (independent math auditing the API) extended from mass to the CG.
//
//   node server/wb/zoo-com-crosscheck.mjs [path/to/part.stl]
//
// Cheap REST call; requires ZOO_API_TOKEN (env or .env at repo root).
//
// Frame finding (2026-07-23, asymmetric-box probe): for STL input Zoo
// answers in a Y-up frame — (x, y, z)_zoo = (x, z, −y)_mesh. Deltas below
// are computed AFTER mapping Zoo's answer back into the mesh's own frame;
// the raw Zoo vector is reported unmodified alongside.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadToken } from "../lib/zoo.mjs";
import { meshProperties } from "./mesh-props.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const stlPath = process.argv[2] ?? join(ROOT, "samples/plain-plate-stl/source.stl");
const bytes = readFileSync(stlPath);

const local = meshProperties(bytes);

const res = await fetch(
  "https://api.zoo.dev/file/center-of-mass?output_unit=mm&src_format=stl",
  { method: "POST", headers: { Authorization: `Bearer ${loadToken()}` }, body: bytes },
);
if (!res.ok) throw new Error(`/file/center-of-mass → ${res.status}: ${await res.text()}`);
const remote = await res.json();
const zoo = [remote.center_of_mass.x, remote.center_of_mass.y, remote.center_of_mass.z];
// Y-up → mesh frame: (x, y, z)_mesh = (x_zoo, −z_zoo, y_zoo)
const zooInMeshFrame = [zoo[0], -zoo[2], zoo[1]];

const deltaMm = [0, 1, 2].map((i) => Math.abs(local.centroidMm[i] - zooInMeshFrame[i]));
console.log(JSON.stringify({
  stl: stlPath,
  localCentroidMm: local.centroidMm,
  zooCenterOfMassRawMm: zoo,
  zooMappedToMeshFrameMm: zooInMeshFrame,
  frameNote: "Zoo answers STL COM in a Y-up frame: (x,y,z)_zoo = (x, z, -y)_mesh; deltas are after mapping back",
  absDeltaMm: deltaMm,
  maxAbsDeltaMm: Math.max(...deltaMm),
  zooRaw: remote,
}, null, 2));

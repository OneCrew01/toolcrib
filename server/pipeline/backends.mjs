// Three ways to turn a validated request into artifacts, one interface:
//   makeBackend(name, opts) -> { name, generate(job) -> artifacts }
//   artifacts = { kcl, files: {stl?, step?, gltf?, png?}, apiRuns: [], notes: [] }
//
//   replay     — samples/plain-plate-stl fixtures, zero network. Judge/demo path.
//   flushmount — deterministic KCL pair from generateFlushMountPair; no mesh,
//                because nothing server-side can execute KCL today (FN-019).
//   live       — text-to-cad through zoo.mjs; the measured failure modes
//                (dedupe hits, unreachable outputs — FN-011) map to states.
//
// Failures throw GenerationError carrying the target state; the orchestrator
// owns the transition.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { STATE } from "../state/states.mjs";
import { generateFlushMountPair } from "../generators/flushmount.mjs";

const REPO = fileURLToPath(new URL("../..", import.meta.url));

export class GenerationError extends Error {
  constructor(state, message) {
    super(message);
    this.name = "GenerationError";
    this.state = state; // GENERATION_FAILED | OUTPUTS_UNREACHABLE
  }
}

export function makeBackend(name, opts = {}) {
  const b = { replay: replayBackend, flushmount: flushmountBackend, live: liveBackend }[name];
  if (!b) throw new RangeError(`unknown backend ${JSON.stringify(name)}; expected replay|flushmount|live`);
  return b(opts);
}

// ------------------------------------------------------------------- replay

function replayBackend({ fixturesDir = join(REPO, "samples", "plain-plate-stl") } = {}) {
  return {
    name: "replay",
    async generate() {
      const read = (f) => readFileSync(join(fixturesDir, f));
      const kclPath = join(fixturesDir, "part.kcl");
      if (!existsSync(kclPath))
        throw new GenerationError(STATE.GENERATION_FAILED, `replay fixtures incomplete: no part.kcl in ${fixturesDir}`);

      const files = {};
      for (const fmt of ["stl", "step", "gltf"]) {
        const p = join(fixturesDir, `source.${fmt}`);
        if (existsSync(p)) files[fmt] = readFileSync(p);
      }
      // engine-rendered preview (ws take_snapshot route, FN-022) if the fixture exists
      const previewPath = join(fixturesDir, "preview.png");
      if (existsSync(previewPath)) files.png = readFileSync(previewPath);
      const apiRuns = [];
      for (const f of ["intent.json", "validation.json"])
        if (existsSync(join(fixturesDir, f)))
          apiRuns.push({ replayedFrom: f, record: JSON.parse(read(f).toString("utf8")) });

      return {
        kcl: read("part.kcl").toString("utf8"),
        files,
        apiRuns,
        notes: [`replay backend: artifacts read from ${fixturesDir} — zero network, real prior Zoo outputs`],
      };
    },
  };
}

// --------------------------------------------------------------- flushmount

function flushmountBackend() {
  return {
    name: "flushmount",
    async generate(job) {
      const intent = job.request?.structuredIntent;
      const spec = intent?.flushMount ?? (intent?.panel && intent?.opening ? intent : null);
      if (!spec)
        throw new GenerationError(
          STATE.GENERATION_FAILED,
          "flushmount backend needs structuredIntent with a flush-mount spec (panel, opening, clearancePerSideMm, chamfer, colors)",
        );

      let pair;
      try {
        pair = generateFlushMountPair(spec);
      } catch (e) {
        throw new GenerationError(STATE.GENERATION_FAILED, e.message);
      }

      const kcl = [
        "// ============ PART 1 of 2: PANEL ============",
        pair.panelKcl,
        "// ============ PART 2 of 2: INSERT ============",
        pair.insertKcl,
      ].join("\n");

      return {
        kcl,
        files: {}, // no mesh: nothing server-side executes KCL today
        meshExpected: false, // packager parks a mesh-less bundle, loudly incomplete
        apiRuns: [],
        params: pair.params,
        notes: [
          "flushmount backend: KCL pair generated deterministically, zero network",
          "no exported mesh — /file/execute cannot run KCL and is currently down entirely (FN-019); geometry gates will be skipped:no-mesh",
        ],
      };
    },
  };
}

// --------------------------------------------------------------------- live

function liveBackend({ format = "stl", timeoutMin = 20, client } = {}) {
  return {
    name: "live",
    async generate(job) {
      const prompt = job.request?.prompt;
      if (!prompt)
        throw new GenerationError(STATE.GENERATION_FAILED, "live backend requires a prose prompt (structuredIntent requests need the flushmount backend)");

      const { zooClient } = await import("../lib/zoo.mjs");
      const zoo = client ?? zooClient();
      const notes = [];
      const started = await zoo.startTextToCad(prompt, format);
      const wait = await zoo.waitTextToCad(started.id, { timeoutMin });
      const run = { id: started.id, format, status: wait.status, latencyS: Math.round(wait.latencyS * 10) / 10 };

      if (wait.status === "failed")
        throw new GenerationError(STATE.GENERATION_FAILED, `text-to-cad ${started.id} failed after ${run.latencyS}s: ${wait.record?.error ?? "no error text"}`);
      if (wait.status === "timeout")
        throw new GenerationError(STATE.GENERATION_FAILED, `text-to-cad ${started.id} still running after ${timeoutMin} min — abandoned`);

      // Outputs live ONLY on /async/operations (FN-007) and burst/dedupe jobs
      // can complete with outputs permanently missing there (FN-011).
      const outputs = await zoo.fetchOutputs(started.id);
      if (!outputs) {
        const instant = wait.latencyS < 20;
        throw new GenerationError(
          STATE.OUTPUTS_UNREACHABLE,
          `text-to-cad ${started.id} completed in ${run.latencyS}s but its outputs never appeared on /async/operations` +
            (instant ? " — instant completion is the dedupe-hit signature (FN-011)" : "") +
            "; KCL source remains recoverable from the user surface",
        );
      }

      const files = {};
      for (const [name, b64] of Object.entries(outputs)) {
        const ext = name.split(".").pop();
        files[ext] = zoo.decodeOutput(b64);
      }
      notes.push(`live backend: text-to-cad ${started.id} completed in ${run.latencyS}s, ${Object.keys(files).length} output file(s)`);

      return { kcl: wait.record?.code ?? "", files, apiRuns: [run], notes };
    },
  };
}

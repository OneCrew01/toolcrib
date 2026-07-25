// ToolCRIB HTTP API — the localhost door to the same flat-file job store the
// CLI pipeline writes. One shared dataDir means `npm run demo` jobs and API
// jobs appear in the same list; runJob() still owns every pipeline
// transition, and the state machine's HUMAN gate is the only path to
// approve/deliver — the API just carries the named human's decision to it.
//
// Zero dependencies: node:http. One structured JSON log line per request.

import { createServer } from "node:http";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { ACTOR, STATE } from "../state/states.mjs";
import { displayPath } from "../lib/repo-path.mjs";
import { LocalStore, TransitionError } from "../state/store.mjs";
import { runJob } from "../pipeline/run-job.mjs";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const ALLOWED_ORIGIN = "http://localhost:5173"; // vite dev app
const BACKENDS = new Set(["replay", "flushmount", "live"]);
const ID_RE = /^[A-Za-z0-9_-]+$/; // mirrors the store's filename-safe job ids
const CONTENT_TYPES = {
  pdf: "application/pdf",
  png: "image/png",
  stl: "model/stl",
  step: "application/octet-stream",
  json: "application/json",
  jsonl: "application/x-ndjson",
  md: "text/markdown; charset=utf-8",
  kcl: "text/plain; charset=utf-8",
  log: "text/plain; charset=utf-8",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

// Store errors -> HTTP. Decisions map every TransitionError to 400 (the
// machine's message is the user's error); reads map unknown jobs to 404.
function asHttp(e, unknownJobStatus = 404) {
  if (e instanceof HttpError) return e;
  if (e instanceof TransitionError)
    return new HttpError(
      e.code === "UNKNOWN_JOB" || e.code === "BAD_JOB_ID" ? unknownJobStatus : 400,
      e.message,
    );
  return e;
}

function readBody(req, limit = 1 << 20) {
  return new Promise((done, fail) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        fail(new HttpError(413, "request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (chunks.length === 0) return done(null);
      try {
        done(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        fail(new HttpError(400, "request body must be valid JSON"));
      }
    });
    req.on("error", fail);
  });
}

// ---- job shapes ------------------------------------------------------------

function readMeta(jobsDir, jobId) {
  // API-side sidecar (<jobId>.meta.json): which backend a POST asked for.
  // CLI-created jobs have none; their backend surfaces from artifacts instead.
  try {
    return JSON.parse(readFileSync(join(jobsDir, `${jobId}.meta.json`), "utf8"));
  } catch {
    return null;
  }
}

function jobSummary(job, meta) {
  return {
    jobId: job.jobId,
    title: job.request?.title ?? null,
    state: job.state,
    rev: job.rev,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    backend: meta?.backend ?? job.artifacts?.generation?.backend ?? null,
  };
}

function readManifest(ctx, jobId) {
  const p = join(ctx.outRoot, jobId, "manifest.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

// Gate rows in the packager's PASS|FAIL|SKIPPED vocabulary. The sealed
// manifest is the source of record once it exists; before packaging the same
// shape is derived from the pipeline's in-flight gate results.
function gatesOf(job, manifest) {
  if (Array.isArray(manifest?.validation)) return manifest.validation;
  const g = job.artifacts?.gates;
  if (!g?.results) return null;
  const measured = (gate) => {
    const m = g.measured ?? {};
    if (gate === "envelope" && m.bboxMm) return `${m.bboxMm.x}x${m.bboxMm.y}x${m.bboxMm.z}mm`;
    if (gate === "watertight" && m.watertight != null) return String(m.watertight);
    if (gate === "mass" && m.massG != null) return `${m.massG}g`;
    return undefined;
  };
  return g.results.map((r) => ({
    gate: r.gate,
    result: r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : "SKIPPED",
    ...(measured(r.gate) !== undefined ? { measured: measured(r.gate) } : {}),
    ...(r.detail ? { notes: r.detail } : {}),
  }));
}

// ---- routes ----------------------------------------------------------------

function listJobs(ctx) {
  const jobs = [];
  for (const f of readdirSync(ctx.jobsDir)) {
    if (!/^[A-Za-z0-9_-]+\.json$/.test(f)) continue; // skips .ledger.jsonl and .meta.json
    try {
      const job = JSON.parse(readFileSync(join(ctx.jobsDir, f), "utf8"));
      jobs.push(jobSummary(job, readMeta(ctx.jobsDir, job.jobId)));
    } catch {
      // half-written snapshot mid-transition: it will list on the next call
    }
  }
  jobs.sort(
    (a, b) =>
      String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")) ||
      String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")),
  );
  return { jobs };
}

// runJob() mints its own jobId, so the create route recovers it from the one
// breadcrumb the pipeline drops immediately: the VALIDATING ledger row whose
// reason names the request file — unique per POST by construction.
async function watchForJobId(ctx, before, needle, runPromise, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let crashed = null;
  runPromise.catch((e) => (crashed = e));
  for (;;) {
    for (const f of readdirSync(ctx.jobsDir)) {
      if (!f.endsWith(".ledger.jsonl") || before.has(f)) continue;
      try {
        const rows = readFileSync(join(ctx.jobsDir, f), "utf8")
          .split("\n")
          .filter((l) => l.length > 0)
          .map((l) => JSON.parse(l));
        if (rows.some((r) => r.reason === needle)) return rows[0].jobId;
      } catch {
        // row mid-append: retry on the next tick
      }
    }
    if (crashed) throw new HttpError(500, `pipeline failed to start: ${crashed.message}`);
    if (Date.now() >= deadline)
      throw new HttpError(500, "timed out waiting for the pipeline to register the job");
    await new Promise((r) => setTimeout(r, 15));
  }
}

async function createJob(ctx, body) {
  const { request, backend = "replay" } = body ?? {};
  if (!request || typeof request !== "object" || Array.isArray(request))
    throw new HttpError(400, "body.request must be a generationRequest object");
  if (!BACKENDS.has(backend))
    throw new HttpError(400, `backend must be replay|flushmount|live, got ${JSON.stringify(backend)}`);
  if (backend === "live" && !process.env.TOOLCRIB_ALLOW_LIVE)
    throw new HttpError(403, "live backend spends real API minutes — set TOOLCRIB_ALLOW_LIVE=1 to enable it");

  mkdirSync(ctx.requestsDir, { recursive: true });
  const reqPath = resolve(join(ctx.requestsDir, `${randomUUID()}.json`));
  writeFileSync(reqPath, JSON.stringify(request, null, 2) + "\n");

  const before = new Set(readdirSync(ctx.jobsDir));
  // No await: 202 now. The state machine owns every outcome from here —
  // failures land in their named states and read back through GET /api/jobs.
  const run = runJob(reqPath, {
    backend,
    dataDir: ctx.dataDir,
    outRoot: ctx.outRoot,
    log: ctx.log,
  });
  run
    .catch((e) => ctx.log(JSON.stringify({ ts: new Date().toISOString(), evt: "pipeline-crash", err: e.message })))
    .finally(() => rmSync(reqPath, { force: true }));

  // Same renderer the pipeline uses for that reason — the needle only matches
  // if both sides agree, and neither may print the operator's filesystem.
  const jobId = await watchForJobId(ctx, before, `request file: ${displayPath(reqPath)}`, run);
  writeFileSync(
    join(ctx.jobsDir, `${jobId}.meta.json`),
    JSON.stringify({ jobId, backend, submittedVia: "api", ts: new Date().toISOString() }) + "\n",
  );
  return { status: 202, body: { jobId } };
}

async function jobDetail(ctx, jobId) {
  let job;
  try {
    job = await ctx.store.getJob(jobId);
  } catch (e) {
    throw asHttp(e, 404);
  }
  const ledger = await ctx.store.readLedger(jobId);
  let ledgerVerified = false;
  try {
    ledgerVerified = (await ctx.store.verifyLedger(jobId)).ok;
  } catch {
    ledgerVerified = false;
  }
  const manifest = readManifest(ctx, jobId);
  const meta = readMeta(ctx.jobsDir, jobId);
  return {
    status: 200,
    body: {
      job: { ...jobSummary(job, meta), request: job.request },
      ledger,
      ledgerVerified,
      gates: gatesOf(job, manifest),
      manifest,
      warnings: manifest?.warnings ?? null,
    },
  };
}

async function decide(ctx, jobId, body) {
  const { action, actorName, reason } = body ?? {};
  if (typeof actorName !== "string" || actorName.trim().length === 0)
    throw new HttpError(400, "actorName is required — decisions are made by named humans, no defaults");
  const actor = { kind: ACTOR.HUMAN, id: actorName.trim() };
  try {
    if (action === "approve") {
      // Two explicit HUMAN transitions: sign the approval, then release it.
      await ctx.store.transition(jobId, STATE.APPROVED, {
        actor,
        reason: typeof reason === "string" && reason.trim() ? reason.trim() : "approved at the review gate",
      });
      const job = await ctx.store.transition(jobId, STATE.DELIVERED, {
        actor,
        reason: "package released to requester",
      });
      return { status: 200, body: { job: jobSummary(job, readMeta(ctx.jobsDir, jobId)) } };
    }
    if (action === "revise") {
      if (typeof reason !== "string" || reason.trim().length === 0)
        throw new HttpError(400, "revise requires a reason — the requester needs to know what to change");
      const job = await ctx.store.transition(jobId, STATE.REVISION_REQUESTED, { actor, reason: reason.trim() });
      return { status: 200, body: { job: jobSummary(job, readMeta(ctx.jobsDir, jobId)) } };
    }
    throw new HttpError(400, `action must be "approve" or "revise", got ${JSON.stringify(action)}`);
  } catch (e) {
    throw asHttp(e, 400); // decisions: every store refusal is a 400 with the machine's words
  }
}

function serveFile(ctx, jobId, relParts, res) {
  if (!ID_RE.test(jobId)) throw new HttpError(404, `no such job: ${jobId}`);
  const bundleDir = resolve(join(ctx.outRoot, jobId));
  let rel;
  try {
    rel = relParts.map(decodeURIComponent).join("/");
  } catch {
    throw new HttpError(400, "bad path encoding");
  }
  if (rel.includes("\0")) throw new HttpError(400, "bad path");
  const abs = resolve(bundleDir, rel);
  if (abs !== bundleDir && !abs.startsWith(bundleDir + sep))
    throw new HttpError(400, "path escapes the job's bundle directory");
  if (!existsSync(bundleDir))
    throw new HttpError(404, "no package bundle for this job yet — files appear after PACKAGING");
  if (!existsSync(abs) || !statSync(abs).isFile())
    throw new HttpError(404, `no such file in bundle: ${rel}`);
  const ext = abs.split(".").pop().toLowerCase();
  res.writeHead(200, {
    "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
    "content-length": statSync(abs).size,
  });
  createReadStream(abs).pipe(res);
}

// ---- server ----------------------------------------------------------------

export function createApiServer({
  dataDir = join(REPO, "server", "pipeline", "data"),
  outRoot,
  log = (line) => console.log(line),
} = {}) {
  const ctx = {
    dataDir,
    outRoot: outRoot ?? join(dataDir, "packages"),
    jobsDir: join(dataDir, "jobs"),
    requestsDir: join(dataDir, "api-requests"),
    store: new LocalStore({ dataDir }), // constructor creates jobsDir
    log,
  };

  return createServer(async (req, res) => {
    const t0 = Date.now();
    const url = new URL(req.url, "http://localhost");
    res.on("finish", () =>
      ctx.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          method: req.method,
          path: url.pathname,
          status: res.statusCode,
          ms: Date.now() - t0,
        }),
      ),
    );
    res.setHeader("access-control-allow-origin", ALLOWED_ORIGIN);
    res.setHeader("vary", "origin");

    const sendJson = (status, obj) => {
      const body = JSON.stringify(obj);
      res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body),
      });
      res.end(body);
    };

    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type",
          "access-control-max-age": "600",
        });
        return res.end();
      }

      if (req.method === "GET" && url.pathname === "/health")
        return sendJson(200, { ok: true, service: "toolcrib", ts: new Date().toISOString() });

      const parts = url.pathname.split("/").filter((p) => p.length > 0);
      if (parts[0] === "api" && parts[1] === "jobs") {
        if (parts.length === 2 && req.method === "GET") return sendJson(200, listJobs(ctx));
        if (parts.length === 2 && req.method === "POST") {
          const r = await createJob(ctx, await readBody(req));
          return sendJson(r.status, r.body);
        }
        const jobId = decodeURIComponent(parts[2]);
        if (parts.length === 3 && req.method === "GET") {
          const r = await jobDetail(ctx, jobId);
          return sendJson(r.status, r.body);
        }
        if (parts.length === 4 && parts[3] === "decision" && req.method === "POST") {
          const r = await decide(ctx, jobId, await readBody(req));
          return sendJson(r.status, r.body);
        }
        if (parts.length >= 5 && parts[3] === "files" && req.method === "GET")
          return serveFile(ctx, jobId, parts.slice(4), res);
      }

      return sendJson(404, { error: `no route: ${req.method} ${url.pathname}` });
    } catch (e) {
      const err = e instanceof URIError ? new HttpError(400, "bad path encoding") : asHttp(e);
      if (err instanceof HttpError) return sendJson(err.status, { error: err.message });
      ctx.log(JSON.stringify({ ts: new Date().toISOString(), evt: "unhandled", err: String(err?.stack ?? err) }));
      return sendJson(500, { error: String(err?.message ?? err) });
    }
  });
}

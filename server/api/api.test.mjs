// API surface tests: a real server on an ephemeral port driving the real
// replay pipeline against a temp dataDir — nothing here touches
// server/pipeline/data/ or the network. Tests run in file order; the happy
// walk creates the job the later guard tests lean on.

import { test, after } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { STATE, TERMINAL } from "../state/states.mjs";
import { createApiServer } from "./server.mjs";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const PLAIN_PLATE = JSON.parse(
  readFileSync(join(REPO, "samples", "requests", "plain-plate.json"), "utf8"),
);

const dataDir = join(mkdtempSync(join(tmpdir(), "toolcrib-api-")), "data");
const server = createApiServer({ dataDir, log: () => {} });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
after(() => {
  server.closeAllConnections?.();
  server.close();
});

async function api(path, init) {
  const res = await fetch(BASE + path, init);
  const type = res.headers.get("content-type") ?? "";
  const body = type.includes("application/json") ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, body, headers: res.headers };
}
const post = (path, body) =>
  api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function waitForState(jobId, want, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { status, body } = await api(`/api/jobs/${jobId}`);
    if (status === 200) {
      if (body.job.state === want) return body;
      if (TERMINAL.includes(body.job.state))
        throw new Error(`job ${jobId} landed in ${body.job.state}: ${body.ledger.at(-1)?.reason}`);
    }
    if (Date.now() >= deadline) throw new Error(`job ${jobId} never reached ${want}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

let deliveredJobId; // set by the happy walk, reused by the guard tests

test("health answers with the service signature", async () => {
  const { status, body } = await api("/health");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.service, "toolcrib");
  assert.ok(body.ts);
});

test("create (replay) -> gate -> approve -> DELIVERED, ledger verified throughout", async () => {
  const created = await post("/api/jobs", { request: PLAIN_PLATE, backend: "replay" });
  assert.equal(created.status, 202);
  const { jobId } = created.body;
  assert.match(jobId, /^[A-Za-z0-9_-]+$/);

  // the pipeline parks the job at the human gate on its own
  const parked = await waitForState(jobId, STATE.WAITING_FOR_HUMAN_REVIEW);
  assert.equal(parked.ledgerVerified, true);
  assert.equal(parked.job.title, PLAIN_PLATE.title);
  assert.equal(parked.job.backend, "replay");

  // gates present, in the packager vocabulary
  assert.ok(Array.isArray(parked.gates) && parked.gates.length > 0, "gates missing at the gate");
  const byGate = Object.fromEntries(parked.gates.map((g) => [g.gate, g.result]));
  assert.equal(byGate.envelope, "PASS");
  assert.equal(byGate.watertight, "PASS");

  // sealed manifest rides the detail response
  assert.ok(parked.manifest, "manifest missing after packaging");
  assert.match(parked.manifest.packageHash, /^[0-9a-f]{64}$/);
  assert.ok(Array.isArray(parked.warnings));

  // approve: two HUMAN transitions signed with the reviewer's name
  const dec = await post(`/api/jobs/${jobId}/decision`, {
    action: "approve",
    actorName: "Casey Reviewer",
  });
  assert.equal(dec.status, 200);
  assert.equal(dec.body.job.state, STATE.DELIVERED);

  const detail = await api(`/api/jobs/${jobId}`);
  assert.equal(detail.body.job.state, STATE.DELIVERED);
  assert.equal(detail.body.ledgerVerified, true);
  const humanRows = detail.body.ledger.filter((r) => r.actor.kind === "HUMAN");
  assert.deepEqual(humanRows.map((r) => r.to), [STATE.APPROVED, STATE.DELIVERED]);
  for (const r of humanRows) assert.deepEqual(r.actor, { kind: "HUMAN", id: "Casey Reviewer" });

  deliveredJobId = jobId;
});

test("files route serves bundle files with correct content-types", async () => {
  const manifest = await api(`/api/jobs/${deliveredJobId}/files/manifest.json`);
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers.get("content-type"), /application\/json/);
  assert.equal(manifest.body.jobId, deliveredJobId);

  const pdf = await api(`/api/jobs/${deliveredJobId}/files/reports/manufacturingPackage.pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.equal(pdf.body.subarray(0, 5).toString(), "%PDF-");

  const missing = await api(`/api/jobs/${deliveredJobId}/files/no-such-file.md`);
  assert.equal(missing.status, 404);
});

test("files route rejects traversal out of the bundle dir", async () => {
  // %2F keeps the dots in one path segment so the server, not the URL
  // parser, has to make the call
  const escape = await api(
    `/api/jobs/${deliveredJobId}/files/..%2F..%2Fjobs%2F${deliveredJobId}.json`,
  );
  assert.equal(escape.status, 400);
  assert.match(escape.body.error, /escapes/);

  const winEscape = await api(`/api/jobs/${deliveredJobId}/files/..%5C..%5Csecrets.txt`);
  assert.equal(winEscape.status, 400);
});

test("decision guards: wrong state, missing actorName, bad action, unknown job", async () => {
  // DELIVERED is terminal — not at the gate
  const wrongState = await post(`/api/jobs/${deliveredJobId}/decision`, {
    action: "approve",
    actorName: "Casey Reviewer",
  });
  assert.equal(wrongState.status, 400);
  assert.match(wrongState.body.error, /not a legal move/);

  const noActor = await post(`/api/jobs/${deliveredJobId}/decision`, { action: "approve" });
  assert.equal(noActor.status, 400);
  assert.match(noActor.body.error, /actorName/);

  const badAction = await post(`/api/jobs/${deliveredJobId}/decision`, {
    action: "ship-it",
    actorName: "Casey Reviewer",
  });
  assert.equal(badAction.status, 400);

  const unknown = await post(`/api/jobs/does-not-exist/decision`, {
    action: "approve",
    actorName: "Casey Reviewer",
  });
  assert.equal(unknown.status, 400);
});

test("second job: list is newest first; revise requires and records a reason", async () => {
  const created = await post("/api/jobs", { request: PLAIN_PLATE, backend: "replay" });
  assert.equal(created.status, 202);
  const jobB = created.body.jobId;
  await waitForState(jobB, STATE.WAITING_FOR_HUMAN_REVIEW);

  const list = await api("/api/jobs");
  assert.equal(list.status, 200);
  assert.equal(list.body.jobs[0].jobId, jobB, "newest job should list first");
  assert.ok(list.body.jobs.some((j) => j.jobId === deliveredJobId));
  for (const j of list.body.jobs) {
    assert.equal(j.title, PLAIN_PLATE.title);
    assert.equal(j.backend, "replay");
  }

  const noReason = await post(`/api/jobs/${jobB}/decision`, {
    action: "revise",
    actorName: "Casey Reviewer",
  });
  assert.equal(noReason.status, 400);
  assert.match(noReason.body.error, /reason/);

  const revised = await post(`/api/jobs/${jobB}/decision`, {
    action: "revise",
    actorName: "Casey Reviewer",
    reason: "corner holes need 12mm edge distance",
  });
  assert.equal(revised.status, 200);
  assert.equal(revised.body.job.state, STATE.REVISION_REQUESTED);

  const detail = await api(`/api/jobs/${jobB}`);
  assert.equal(detail.body.ledger.at(-1).reason, "corner holes need 12mm edge distance");
  assert.deepEqual(detail.body.ledger.at(-1).actor, { kind: "HUMAN", id: "Casey Reviewer" });
});

test("live backend is refused with 403 unless TOOLCRIB_ALLOW_LIVE=1", async () => {
  delete process.env.TOOLCRIB_ALLOW_LIVE;
  const refused = await post("/api/jobs", { request: PLAIN_PLATE, backend: "live" });
  assert.equal(refused.status, 403);
  assert.match(refused.body.error, /TOOLCRIB_ALLOW_LIVE/);
});

test("create validation: missing request and unknown backend are 400s", async () => {
  const noRequest = await post("/api/jobs", { backend: "replay" });
  assert.equal(noRequest.status, 400);

  const badBackend = await post("/api/jobs", { request: PLAIN_PLATE, backend: "warp-drive" });
  assert.equal(badBackend.status, 400);
});

test("unknown job detail is a 404", async () => {
  const { status } = await api("/api/jobs/no-such-job");
  assert.equal(status, 404);
});

test("CORS: vite dev origin allowed on /api routes, preflight answered", async () => {
  const preflight = await fetch(BASE + "/api/jobs", {
    method: "OPTIONS",
    headers: {
      origin: "http://localhost:5173",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.match(preflight.headers.get("access-control-allow-methods"), /POST/);

  const list = await api("/api/jobs");
  assert.equal(list.headers.get("access-control-allow-origin"), "http://localhost:5173");
});

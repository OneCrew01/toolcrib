// State machine + LocalStore tests. Every store gets a fresh temp dir —
// nothing here touches server/state/data/.

import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACTOR, STATE, MACHINE, TERMINAL, isLegal, actorOf } from "./states.mjs";
import { LocalStore, TransitionError, canonicalJson, hashRow } from "./store.mjs";
import { validateGenerationRequest } from "./request.mjs";

const SYS = { kind: ACTOR.SYS, id: "pipeline" };
const HUMAN = { kind: ACTOR.HUMAN, id: "reviewer@example.com" };

const validSample = JSON.parse(
  readFileSync(new URL("../../samples/requests/plain-plate.json", import.meta.url), "utf8"),
);
const invalidSample = JSON.parse(
  readFileSync(new URL("../../samples/requests/invalid-missing-material.json", import.meta.url), "utf8"),
);

const newStore = () =>
  new LocalStore({ dataDir: mkdtempSync(join(tmpdir(), "toolcrib-state-")) });

// Walk a fresh job to the human gate: SYS advances everything up to and
// including parking at WAITING_FOR_HUMAN_REVIEW; nothing further.
async function walkToGate(store) {
  const { jobId } = await store.createJob(validSample, { actor: SYS });
  await store.transition(jobId, STATE.VALIDATING, { actor: SYS });
  await store.runValidation(jobId); // -> GENERATING
  for (const to of [STATE.GEOMETRY_CHECK, STATE.PACKAGING, STATE.PDF_GENERATION, STATE.WAITING_FOR_HUMAN_REVIEW])
    await store.transition(jobId, to, { actor: SYS });
  return jobId;
}

test("map invariant: every human decision is only reachable from a HUMAN state", () => {
  const decisions = [STATE.APPROVED, STATE.REVISION_REQUESTED, STATE.DELIVERED];
  for (const [from, meta] of Object.entries(MACHINE))
    for (const to of meta.next) {
      assert.ok(to in MACHINE, `${from} -> ${to}: unknown target`);
      if (decisions.includes(to))
        assert.equal(meta.actor, ACTOR.HUMAN, `${from} -> ${to} must depart a HUMAN state`);
    }
  for (const t of TERMINAL) assert.equal(MACHINE[t].next.length, 0);
  assert.equal(isLegal("NOT_A_STATE", STATE.DRAFT), false);
  assert.throws(() => actorOf("NOT_A_STATE"));
});

test("happy path: SYS to the gate, human through it, ledger verifies", async () => {
  const store = newStore();
  const jobId = await walkToGate(store);
  assert.equal((await store.getJob(jobId)).state, STATE.WAITING_FOR_HUMAN_REVIEW);

  await store.transition(jobId, STATE.APPROVED, { actor: HUMAN, reason: "geometry and PDF reviewed" });
  const done = await store.transition(jobId, STATE.DELIVERED, { actor: HUMAN, reason: "released" });
  assert.equal(done.state, STATE.DELIVERED);
  assert.equal(done.rev, 1);

  const rows = await store.readLedger(jobId);
  assert.equal(rows.length, 9); // genesis + 8 transitions
  assert.equal(rows[0].from, null);
  assert.deepEqual(await store.verifyLedger(jobId), { ok: true, rows: 9 });
});

test("revision loop: REVISION_REQUESTED -> DRAFT opens rev 2", async () => {
  const store = newStore();
  const jobId = await walkToGate(store);
  await store.transition(jobId, STATE.REVISION_REQUESTED, { actor: HUMAN, reason: "holes off-center" });
  const job = await store.transition(jobId, STATE.DRAFT, { actor: HUMAN, reason: "rework" });
  assert.equal(job.state, STATE.DRAFT);
  assert.equal(job.rev, 2);
});

test("illegal transition is rejected", async () => {
  const store = newStore();
  const { jobId } = await store.createJob(validSample, { actor: SYS });
  await assert.rejects(
    store.transition(jobId, STATE.PACKAGING, { actor: SYS }),
    (e) => e instanceof TransitionError && e.code === "ILLEGAL_TRANSITION",
  );
  assert.equal((await store.getJob(jobId)).state, STATE.DRAFT); // nothing moved
});

test("HUMAN gate: SYS actor cannot advance past it", async () => {
  const store = newStore();
  const jobId = await walkToGate(store);

  await assert.rejects(
    store.transition(jobId, STATE.APPROVED, { actor: SYS }),
    (e) => e.code === "HUMAN_GATE",
  );
  assert.equal((await store.getJob(jobId)).state, STATE.WAITING_FOR_HUMAN_REVIEW);

  // APPROVED is human-gated too: delivery is a human release, not an auto-step.
  await store.transition(jobId, STATE.APPROVED, { actor: HUMAN });
  await assert.rejects(
    store.transition(jobId, STATE.DELIVERED, { actor: SYS }),
    (e) => e.code === "HUMAN_GATE",
  );
});

test("hash chain: verifies clean, detects a tampered middle row", async () => {
  const store = newStore();
  const jobId = await walkToGate(store);
  assert.equal((await store.verifyLedger(jobId)).ok, true);

  const path = join(store.jobsDir, `${jobId}.ledger.jsonl`);
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.length > 0);
  const mid = 3;

  // Naive tamper: edit a row, keep its stored hash.
  const tampered = JSON.parse(lines[mid]);
  tampered.reason = "looks fine, ship it";
  writeFileSync(path, [...lines.slice(0, mid), JSON.stringify(tampered), ...lines.slice(mid + 1)].join("\n") + "\n");
  let v = await store.verifyLedger(jobId);
  assert.deepEqual({ ok: v.ok, row: v.row }, { ok: false, row: mid });

  // Smarter tamper: recompute the edited row's hash. The chain still breaks —
  // at the NEXT row, whose hash committed to the original.
  const prev = JSON.parse(lines[mid - 1]).rowHash;
  const { rowHash, ...rest } = tampered;
  tampered.rowHash = hashRow(prev, rest);
  writeFileSync(path, [...lines.slice(0, mid), JSON.stringify(tampered), ...lines.slice(mid + 1)].join("\n") + "\n");
  v = await store.verifyLedger(jobId);
  assert.deepEqual({ ok: v.ok, row: v.row }, { ok: false, row: mid + 1 });
});

test("invalid request lands in INPUT_ERROR with reasons, no crash", async () => {
  const store = newStore();
  const { jobId } = await store.createJob(invalidSample, { actor: SYS });
  await store.transition(jobId, STATE.VALIDATING, { actor: SYS });
  const result = await store.runValidation(jobId);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.startsWith("material")));
  assert.equal(result.job.state, STATE.INPUT_ERROR);

  const rows = await store.readLedger(jobId);
  const last = rows[rows.length - 1];
  assert.equal(last.to, STATE.INPUT_ERROR);
  assert.match(last.reason, /material/);
  assert.equal((await store.verifyLedger(jobId)).ok, true);
});

test("validateGenerationRequest: throw-free on junk, strict on shape", () => {
  for (const junk of [null, undefined, 42, "plate", [], {}])
    assert.equal(validateGenerationRequest(junk).ok, false);

  const both = { ...validSample, structuredIntent: { kind: "plate" } };
  const r = validateGenerationRequest(both);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("exactly one")));

  const good = validateGenerationRequest({ ...validSample, extraKey: "dropped" });
  assert.equal(good.ok, true);
  assert.ok(!("extraKey" in good.request));

  // canonical form is key-order independent — the hash input is stable
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), canonicalJson({ a: [2, { c: 4, d: 3 }], b: 1 }));
});

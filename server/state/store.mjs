// LocalStore — flat-file StateStore. One JSON snapshot plus one APPEND-ONLY
// JSONL ledger per job under <dataDir>/jobs/.
//
// Ledger rows form a hash chain: rowHash = sha256(prevRowHash + canonical
// JSON of the row minus rowHash). Editing or dropping any historical row
// breaks every hash after it, so verifyLedger() can prove the recorded
// history is the history that happened — no trust in the file required.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { ACTOR, STATE, isLegal, actorOf } from "./states.mjs";
import { validateGenerationRequest } from "./request.mjs";

/**
 * @typedef {{kind: "SYS"|"HUMAN", id: string}} Actor
 *
 * @typedef {Object} Job
 * @property {string} jobId
 * @property {number} rev        revision counter; REVISION_REQUESTED → DRAFT bumps it
 * @property {string} state      one of STATE
 * @property {object} request    the intent envelope (raw until validated, then normalized)
 * @property {string} createdAt
 * @property {string} updatedAt
 *
 * @typedef {Object} LedgerRow
 * @property {string} ts
 * @property {string} jobId
 * @property {number} rev
 * @property {string|null} from  null on the genesis row
 * @property {string} to
 * @property {Actor} actor
 * @property {string} reason
 * @property {string} rowHash    sha256(prevRowHash + canonicalJson(row minus rowHash))
 *
 * StateStore interface — LocalStore is the flat-file implementation; a hosted
 * backend implements the same five methods.
 * @typedef {Object} StateStore
 * @property {(rawRequest: object, opts: {actor: Actor, jobId?: string}) => Promise<Job>} createJob
 * @property {(jobId: string) => Promise<Job>} getJob
 * @property {(jobId: string, to: string, opts: {actor: Actor, reason?: string}) => Promise<Job>} transition
 * @property {(jobId: string) => Promise<LedgerRow[]>} readLedger
 * @property {(jobId: string) => Promise<{ok: boolean, rows?: number, row?: number, reason?: string}>} verifyLedger
 */

export class TransitionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TransitionError";
    this.code = code; // ILLEGAL_TRANSITION | HUMAN_GATE | UNKNOWN_JOB | JOB_EXISTS | BAD_ACTOR | BAD_JOB_ID
  }
}

/** Deterministic JSON: object keys sorted recursively. Hash input format. */
export function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v !== null && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

export function hashRow(prevRowHash, rowMinusHash) {
  return createHash("sha256")
    .update(prevRowHash + canonicalJson(rowMinusHash))
    .digest("hex");
}

const ID_RE = /^[A-Za-z0-9_-]+$/; // job ids become filenames — nothing else gets in

function checkActor(actor) {
  if (
    !actor ||
    (actor.kind !== ACTOR.SYS && actor.kind !== ACTOR.HUMAN) ||
    typeof actor.id !== "string" ||
    actor.id.length === 0
  )
    throw new TransitionError("BAD_ACTOR", `actor must be {kind: SYS|HUMAN, id}: ${JSON.stringify(actor)}`);
}

/** @implements {StateStore} */
export class LocalStore {
  constructor({ dataDir } = {}) {
    const root = dataDir ?? fileURLToPath(new URL("./data", import.meta.url));
    this.jobsDir = join(root, "jobs");
    mkdirSync(this.jobsDir, { recursive: true });
  }

  #jobPath(jobId) {
    return join(this.jobsDir, `${jobId}.json`);
  }
  #ledgerPath(jobId) {
    return join(this.jobsDir, `${jobId}.ledger.jsonl`);
  }

  #readRows(jobId) {
    const p = this.#ledgerPath(jobId);
    if (!existsSync(p)) return [];
    return readFileSync(p, "utf8")
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l));
  }

  // Ledger first, snapshot second: on a crash between the two, the ledger —
  // the source of truth — already holds the transition.
  #append(jobId, { rev, from, to, actor, reason }) {
    const rows = this.#readRows(jobId);
    const prev = rows.length > 0 ? rows[rows.length - 1].rowHash : "";
    const row = { ts: new Date().toISOString(), jobId, rev, from, to, actor, reason };
    row.rowHash = hashRow(prev, row);
    appendFileSync(this.#ledgerPath(jobId), JSON.stringify(row) + "\n");
  }

  #writeJob(job) {
    writeFileSync(this.#jobPath(job.jobId), JSON.stringify(job, null, 2) + "\n");
  }

  async createJob(rawRequest, { actor, jobId = randomUUID() } = {}) {
    checkActor(actor);
    if (!ID_RE.test(jobId)) throw new TransitionError("BAD_JOB_ID", `invalid jobId: ${jobId}`);
    if (existsSync(this.#jobPath(jobId)))
      throw new TransitionError("JOB_EXISTS", `job already exists: ${jobId}`);
    const now = new Date().toISOString();
    const job = {
      jobId,
      rev: 1,
      state: STATE.DRAFT,
      request: rawRequest,
      createdAt: now,
      updatedAt: now,
    };
    this.#append(jobId, { rev: 1, from: null, to: STATE.DRAFT, actor, reason: "created" });
    this.#writeJob(job);
    return job;
  }

  async getJob(jobId) {
    if (!ID_RE.test(jobId)) throw new TransitionError("BAD_JOB_ID", `invalid jobId: ${jobId}`);
    if (!existsSync(this.#jobPath(jobId)))
      throw new TransitionError("UNKNOWN_JOB", `no such job: ${jobId}`);
    return JSON.parse(readFileSync(this.#jobPath(jobId), "utf8"));
  }

  /**
   * The only mutator. Rejects illegal moves, and rejects any non-human actor
   * leaving a HUMAN state. Every entry into APPROVED / REVISION_REQUESTED /
   * DELIVERED starts in a HUMAN state (invariant tested against MACHINE), so
   * this one gate keeps SYS out of every human decision.
   */
  async transition(jobId, to, { actor, reason = "" } = {}) {
    checkActor(actor);
    const job = await this.getJob(jobId);
    const from = job.state;
    if (!isLegal(from, to))
      throw new TransitionError("ILLEGAL_TRANSITION", `${from} -> ${to} is not a legal move`);
    if (actorOf(from) === ACTOR.HUMAN && actor.kind !== ACTOR.HUMAN)
      throw new TransitionError(
        "HUMAN_GATE",
        `${from} -> ${to} requires an explicit human action; got ${actor.kind}:${actor.id}`,
      );
    if (from === STATE.REVISION_REQUESTED && to === STATE.DRAFT) job.rev += 1;
    job.state = to;
    job.updatedAt = new Date().toISOString();
    this.#append(jobId, { rev: job.rev, from, to, actor, reason });
    this.#writeJob(job);
    return job;
  }

  /**
   * Run intent-envelope validation on a job sitting in VALIDATING.
   * Valid → GENERATING (normalized request stored). Invalid → INPUT_ERROR
   * with the reasons in the ledger. Never throws on bad request content.
   */
  async runValidation(jobId, { actor = { kind: ACTOR.SYS, id: "request-validator" } } = {}) {
    const job = await this.getJob(jobId);
    if (job.state !== STATE.VALIDATING)
      throw new TransitionError("ILLEGAL_TRANSITION", `runValidation requires VALIDATING, job is ${job.state}`);
    const result = validateGenerationRequest(job.request);
    if (!result.ok) {
      const after = await this.transition(jobId, STATE.INPUT_ERROR, {
        actor,
        reason: `invalid request: ${result.errors.join("; ")}`,
      });
      return { ok: false, errors: result.errors, job: after };
    }
    job.request = result.request;
    this.#writeJob(job);
    const after = await this.transition(jobId, STATE.GENERATING, { actor, reason: "request valid" });
    return { ok: true, job: after };
  }

  async readLedger(jobId) {
    await this.getJob(jobId); // existence check
    return this.#readRows(jobId);
  }

  /**
   * Recompute the hash chain and the from/to continuity of a job's ledger.
   * @returns {{ok: true, rows: number} | {ok: false, row: number, reason: string}}
   */
  async verifyLedger(jobId) {
    if (!existsSync(this.#ledgerPath(jobId)))
      throw new TransitionError("UNKNOWN_JOB", `no ledger for job: ${jobId}`);
    const lines = readFileSync(this.#ledgerPath(jobId), "utf8")
      .split("\n")
      .filter((l) => l.length > 0);
    let prevHash = "";
    let prevTo = null;
    for (let i = 0; i < lines.length; i++) {
      let row;
      try {
        row = JSON.parse(lines[i]);
      } catch {
        return { ok: false, row: i, reason: "unparseable row" };
      }
      const { rowHash, ...rest } = row;
      if (hashRow(prevHash, rest) !== rowHash)
        return { ok: false, row: i, reason: "hash mismatch — row or chain altered" };
      if (row.from !== prevTo)
        return { ok: false, row: i, reason: `continuity break: from=${row.from}, expected ${prevTo}` };
      prevHash = rowHash;
      prevTo = row.to;
    }
    return { ok: true, rows: lines.length };
  }
}

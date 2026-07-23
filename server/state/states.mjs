// Job lifecycle for one generation request. Single source of truth for which
// moves are legal and who is allowed to make them.
//
// Actor classes — the tag answers one question: who may move a job OUT of
// this state?
//   SYS   — the machine advances on its own.
//   HUMAN — only an explicit human action advances. Never auto-advanced.
// The machine may park a job IN a HUMAN state (PDF_GENERATION →
// WAITING_FOR_HUMAN_REVIEW) but can never move one past it. Every path into a
// decision state (APPROVED, REVISION_REQUESTED, DELIVERED) starts in a HUMAN
// state, so gating departures is enough to keep SYS out of all of them —
// state.test.mjs asserts that invariant against this map.
//
// Terminal states have no outgoing edges. They still carry the HUMAN tag so
// that if an edge is ever added (retry, waiver), the gate fails closed.

export const ACTOR = Object.freeze({ SYS: "SYS", HUMAN: "HUMAN" });

export const STATE = Object.freeze({
  // pipeline
  DRAFT: "DRAFT",
  VALIDATING: "VALIDATING",
  GENERATING: "GENERATING",
  GEOMETRY_CHECK: "GEOMETRY_CHECK",
  PACKAGING: "PACKAGING",
  PDF_GENERATION: "PDF_GENERATION",
  // human decisions
  WAITING_FOR_HUMAN_REVIEW: "WAITING_FOR_HUMAN_REVIEW",
  APPROVED: "APPROVED",
  REVISION_REQUESTED: "REVISION_REQUESTED",
  DELIVERED: "DELIVERED",
  // failures
  INPUT_ERROR: "INPUT_ERROR",
  CAPABILITY_MISSING: "CAPABILITY_MISSING",
  GENERATION_FAILED: "GENERATION_FAILED",
  OUTPUTS_UNREACHABLE: "OUTPUTS_UNREACHABLE",
  GEOMETRY_INVALID: "GEOMETRY_INVALID",
  EXPORT_FAILED: "EXPORT_FAILED",
  PDF_FAILED: "PDF_FAILED",
});

const S = STATE;

// state -> { actor, next[] }. Any move not listed in next is illegal.
export const MACHINE = Object.freeze({
  [S.DRAFT]: { actor: ACTOR.SYS, next: [S.VALIDATING] },

  // CAPABILITY_MISSING: the request names a feature class generation cannot
  // yet be trusted to produce — hook for a measured capability ledger.
  [S.VALIDATING]: {
    actor: ACTOR.SYS,
    next: [S.GENERATING, S.INPUT_ERROR, S.CAPABILITY_MISSING],
  },

  // OUTPUTS_UNREACHABLE mirrors a measured Zoo failure mode: the job reports
  // completed but its outputs never appear on the async-operations surface —
  // the only surface that carries them (FN-011).
  [S.GENERATING]: {
    actor: ACTOR.SYS,
    next: [S.GEOMETRY_CHECK, S.GENERATION_FAILED, S.OUTPUTS_UNREACHABLE],
  },

  // "completed" is not "correct" (FN-010) — geometry must prove itself here.
  [S.GEOMETRY_CHECK]: { actor: ACTOR.SYS, next: [S.PACKAGING, S.GEOMETRY_INVALID] },

  // Packaging and PDF are deliverables, not formalities: a package that cannot
  // seal its exports or render its review sheet is a failed job, not a shrug.
  [S.PACKAGING]: { actor: ACTOR.SYS, next: [S.PDF_GENERATION, S.EXPORT_FAILED] },
  [S.PDF_GENERATION]: { actor: ACTOR.SYS, next: [S.WAITING_FOR_HUMAN_REVIEW, S.PDF_FAILED] },

  // The gate. The machine parks a job here; only a human moves it past.
  [S.WAITING_FOR_HUMAN_REVIEW]: {
    actor: ACTOR.HUMAN,
    next: [S.APPROVED, S.REVISION_REQUESTED],
  },
  [S.APPROVED]: { actor: ACTOR.HUMAN, next: [S.DELIVERED] },
  [S.REVISION_REQUESTED]: { actor: ACTOR.HUMAN, next: [S.DRAFT] }, // re-entry opens a new revision

  // terminal
  [S.DELIVERED]: { actor: ACTOR.HUMAN, next: [] },
  [S.INPUT_ERROR]: { actor: ACTOR.HUMAN, next: [] },
  [S.CAPABILITY_MISSING]: { actor: ACTOR.HUMAN, next: [] },
  [S.GENERATION_FAILED]: { actor: ACTOR.HUMAN, next: [] },
  [S.OUTPUTS_UNREACHABLE]: { actor: ACTOR.HUMAN, next: [] },
  [S.GEOMETRY_INVALID]: { actor: ACTOR.HUMAN, next: [] },
  [S.EXPORT_FAILED]: { actor: ACTOR.HUMAN, next: [] },
  [S.PDF_FAILED]: { actor: ACTOR.HUMAN, next: [] },
});

export const TERMINAL = Object.freeze(
  Object.keys(MACHINE).filter((s) => MACHINE[s].next.length === 0),
);

/** Unknown states are illegal by default — deny, never guess. */
export function isLegal(from, to) {
  return MACHINE[from]?.next.includes(to) ?? false;
}

/** Actor class required to advance OUT of a state. Throws on unknown state. */
export function actorOf(state) {
  const m = MACHINE[state];
  if (!m) throw new Error(`unknown state: ${state}`);
  return m.actor;
}

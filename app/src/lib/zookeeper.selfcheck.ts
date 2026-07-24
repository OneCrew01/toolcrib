// Offline self-checks for the pure Zookeeper frame classifier / aggregator.
//
// vitest is not set up in app/, so this module IS the test provision: recorded
// frame fixtures with the exact single-top-level-key shapes measured live in
// server/spikes/ws-copilot-spike.mjs (FN-025..FN-028), run through the pure
// functions with plain assertions. runSelfChecks() returns failure strings —
// empty array = pass. main.tsx calls it in dev mode only and console.warns
// any failures. Because this module and zookeeper.ts are erasable-syntax-only
// with no DOM use at import time, plain `node` (>=22.6 type stripping) can
// also execute it directly for an offline gate.
//
// No sockets, no DOM, no token anywhere in this file.

import {
  activeTurn,
  applyFrame,
  beginTurn,
  classifyFrame,
  createAggregate,
  extractKcl,
  type ApplyEffect,
  type ServerFrame,
  type SessionAggregate,
} from "./zookeeper.ts";

// ---------------------------------------------------------------------------
// Fixtures — exact frame key shapes from the spike transcript
// ---------------------------------------------------------------------------

// FN-026: the false-positive auth error text, byte-for-byte (hard-coded here
// on purpose — if the constant in zookeeper.ts ever drifts, checks fail).
const SPURIOUS_DETAIL =
  'Please send `{ headers: { Authorization: "Bearer <token>" } }` over this websocket.';

const FX = {
  pong: '{"pong":{}}',
  sessionData:
    '{"session_data":{"api_call_id":"3b1f0a52-9c1e-4f7a-8d2b-5e6c7a8b9c0d"}}',
  conversationId:
    '{"conversation_id":{"conversation_id":"9d8c7b6a-5f4e-4d3c-b2a1-0f9e8d7c6b5a"}}',
  // FN-028: auto default; fast/thoughtful disabled on this plan.
  modesResponse:
    '{"modes_response":{"default_mode":"auto","modes":[' +
    '{"id":"auto","label":"Auto","description":"Let Zookeeper choose.","disabled":false},' +
    '{"id":"fast","label":"Fast","description":"Quick responses.","disabled":true},' +
    '{"id":"thoughtful","label":"Thoughtful","description":"Deeper reasoning.","disabled":true}]}}',
  spuriousAuthError: JSON.stringify({ error: { detail: SPURIOUS_DETAIL } }),
  realError:
    '{"error":{"detail":"The model failed to produce a response for this prompt."}}',
  delta1: '{"delta":{"delta":"I\'ll create "}}',
  delta2: '{"delta":{"delta":"a 20mm cube "}}',
  delta3: '{"delta":{"delta":"in KCL."}}',
  reasoning:
    '{"reasoning":{"type":"text","content":"The user wants a simple cube; extrude a 20mm square profile."}}',
  info: '{"info":{"text":"Activating KCL skill."}}',
  // KCL rides tool_output.result.outputs as filename → source (FN-028).
  toolOutputKcl:
    '{"tool_output":{"result":{"outputs":{"main.kcl":"// 20mm cube\\ncube = startSketchOn(XY)\\n  |> polygon(...)\\n  |> extrude(length = 20)"}}}}',
  toolOutputOther: '{"tool_output":{"result":{"status":"lint clean"}}}',
  endOfStream:
    '{"end_of_stream":{"id":"3b1f0a52-9c1e-4f7a-8d2b-5e6c7a8b9c0d",' +
    '"whole_response":"Here is a 20mm cube in KCL.",' +
    '"started_at":"2026-07-23T21:04:10.100Z","completed_at":"2026-07-23T21:04:55.600Z"}}',
  backendShutdown: '{"backend_shutdown":{"reason":"idle timeout"}}',
  metricsFamily: '{"zookeeper_auto_router_metadata":{"route":"auto"}}',
  notJson: "this is not a frame",
} as const;

// ---------------------------------------------------------------------------
// Tiny harness
// ---------------------------------------------------------------------------

type Failures = string[];

function check(failures: Failures, name: string, cond: boolean, detail?: string): void {
  if (!cond) failures.push(detail ? `${name} — ${detail}` : name);
}

function feed(
  agg: SessionAggregate,
  raw: string,
): { next: SessionAggregate; effect: ApplyEffect; frame: ServerFrame } {
  const frame = classifyFrame(raw);
  const { next, effect } = applyFrame(agg, frame);
  return { next, effect, frame };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

export function runSelfChecks(): string[] {
  const failures: Failures = [];

  // --- classification: every fixture lands on the right kind with the right
  //     payload fields extracted --------------------------------------------
  {
    const f = classifyFrame(FX.pong);
    check(failures, "classify pong", f.kind === "pong");
  }
  {
    const f = classifyFrame(FX.sessionData);
    check(
      failures,
      "classify session_data extracts api_call_id",
      f.kind === "session_data" &&
        f.apiCallId === "3b1f0a52-9c1e-4f7a-8d2b-5e6c7a8b9c0d",
    );
  }
  {
    const f = classifyFrame(FX.conversationId);
    check(
      failures,
      "classify conversation_id extracts nested id",
      f.kind === "conversation_id" &&
        f.conversationId === "9d8c7b6a-5f4e-4d3c-b2a1-0f9e8d7c6b5a",
    );
  }
  {
    const f = classifyFrame(FX.modesResponse);
    check(
      failures,
      "classify modes_response: default + 3 modes + disabled flags",
      f.kind === "modes_response" &&
        f.defaultMode === "auto" &&
        f.modes.length === 3 &&
        f.modes[0].id === "auto" &&
        f.modes[0].disabled === false &&
        f.modes[1].disabled === true &&
        f.modes[2].id === "thoughtful",
    );
  }
  {
    const f = classifyFrame(FX.delta1);
    check(failures, "classify delta text", f.kind === "delta" && f.text === "I'll create ");
  }
  {
    const f = classifyFrame(FX.reasoning);
    check(
      failures,
      "classify reasoning type+content",
      f.kind === "reasoning" &&
        f.reasoningType === "text" &&
        f.content.startsWith("The user wants"),
    );
  }
  {
    const f = classifyFrame(FX.endOfStream);
    check(
      failures,
      "classify end_of_stream fields",
      f.kind === "end_of_stream" &&
        f.promptId === "3b1f0a52-9c1e-4f7a-8d2b-5e6c7a8b9c0d" &&
        f.wholeResponse === "Here is a 20mm cube in KCL." &&
        f.startedAt === "2026-07-23T21:04:10.100Z" &&
        f.completedAt === "2026-07-23T21:04:55.600Z",
    );
  }
  {
    const f = classifyFrame(FX.backendShutdown);
    check(
      failures,
      "classify backend_shutdown reason",
      f.kind === "backend_shutdown" && f.reason === "idle timeout",
    );
  }
  {
    const f = classifyFrame(FX.metricsFamily);
    check(
      failures,
      "metrics-family frame is ignored, not an error",
      f.kind === "ignored" && f.key === "zookeeper_auto_router_metadata",
    );
  }
  {
    const f = classifyFrame(FX.notJson);
    check(failures, "non-JSON input never throws", f.kind === "unparseable");
  }

  // --- FN-026: spurious auth error swallowed exactly once -------------------
  {
    let agg = createAggregate();
    const first = feed(agg, FX.spuriousAuthError);
    check(
      failures,
      "first spurious auth error is swallowed",
      first.effect === "spurious-auth-swallowed" &&
        first.next.spuriousAuthSwallowed === true &&
        first.next.lastError === null,
    );
    agg = first.next;
    const second = feed(agg, FX.spuriousAuthError);
    check(
      failures,
      "second identical auth error is REAL",
      second.effect === "error" && second.next.lastError === SPURIOUS_DETAIL,
    );
  }

  // --- FN-027: conversation_id duplicate dedupe -----------------------------
  {
    let agg = createAggregate();
    const first = feed(agg, FX.conversationId);
    agg = first.next;
    const second = feed(agg, FX.conversationId);
    check(
      failures,
      "duplicate conversation_id dropped by content",
      first.effect === "updated" &&
        second.effect === "duplicate" &&
        second.next.conversationId === "9d8c7b6a-5f4e-4d3c-b2a1-0f9e8d7c6b5a",
    );
  }

  // --- delta aggregation -----------------------------------------------------
  {
    let agg = beginTurn(createAggregate(), "a 20mm cube");
    for (const raw of [FX.delta1, FX.delta2, FX.delta3]) agg = feed(agg, raw).next;
    const turn = activeTurn(agg);
    check(
      failures,
      "deltas aggregate in order",
      turn !== null && turn.reply === "I'll create a 20mm cube in KCL.",
    );
  }

  // --- FN-027: consecutive tool_output dedupe (content-keyed) ---------------
  {
    let agg = beginTurn(createAggregate(), "a 20mm cube");
    const a1 = feed(agg, FX.toolOutputKcl);
    agg = a1.next;
    const a2 = feed(agg, FX.toolOutputKcl); // identical consecutive → dropped
    agg = a2.next;
    const b = feed(agg, FX.toolOutputOther); // different → kept
    agg = b.next;
    const a3 = feed(agg, FX.toolOutputKcl); // identical but NOT consecutive → kept
    agg = a3.next;
    const turn = agg.turns[agg.turns.length - 1];
    check(
      failures,
      "identical consecutive tool_output dropped, non-consecutive kept",
      a1.effect === "updated" &&
        a2.effect === "duplicate" &&
        b.effect === "updated" &&
        a3.effect === "updated" &&
        turn.toolOutputCount === 3,
    );
    check(
      failures,
      "KCL extracted from tool_output outputs",
      turn.kcl !== null && turn.kcl.startsWith("// 20mm cube"),
    );
  }

  // --- dedupe window resets per turn ----------------------------------------
  {
    let agg = beginTurn(createAggregate(), "turn one");
    agg = feed(agg, FX.toolOutputKcl).next;
    agg = feed(agg, FX.endOfStream).next;
    agg = beginTurn(agg, "turn two");
    const replayedInNewTurn = feed(agg, FX.toolOutputKcl);
    check(
      failures,
      "tool_output dedupe window resets at beginTurn",
      replayedInNewTurn.effect === "updated",
    );
  }

  // --- error terminates the turn (no end_of_stream follows) -----------------
  {
    let agg = beginTurn(createAggregate(), "a 20mm cube");
    agg = feed(agg, FX.delta1).next;
    const err = feed(agg, FX.realError);
    agg = err.next;
    const turn = agg.turns[agg.turns.length - 1];
    check(
      failures,
      "error frame terminates the turn",
      err.effect === "error" &&
        turn.status === "error" &&
        turn.errorDetail === "The model failed to produce a response for this prompt.",
    );
    // Frames after the terminal error must not resurrect or mutate the turn.
    const lateDelta = feed(agg, FX.delta2);
    const lateEos = feed(agg, FX.endOfStream);
    check(
      failures,
      "post-error frames are inert (turn stays terminated)",
      lateDelta.effect === "none" &&
        lateEos.effect === "none" &&
        lateEos.next.turns[lateEos.next.turns.length - 1].status === "error",
    );
  }

  // --- end_of_stream completes the turn with whole_response -----------------
  {
    let agg = beginTurn(createAggregate(), "a 20mm cube");
    agg = feed(agg, FX.delta1).next;
    const eos = feed(agg, FX.endOfStream);
    const turn = eos.next.turns[eos.next.turns.length - 1];
    check(
      failures,
      "end_of_stream completes turn and carries whole_response",
      eos.effect === "turn-complete" &&
        turn.status === "done" &&
        turn.wholeResponse === "Here is a 20mm cube in KCL.",
    );
  }

  // --- extractKcl edge shapes -------------------------------------------------
  {
    check(
      failures,
      "extractKcl: single file returns raw source",
      extractKcl({ outputs: { "main.kcl": "cube()" } }) === "cube()",
    );
    const two = extractKcl({ outputs: { "a.kcl": "a", "b.kcl": "b" } });
    check(
      failures,
      "extractKcl: multiple files get filename banners",
      two !== null && two.includes("// --- a.kcl ---") && two.includes("// --- b.kcl ---"),
    );
    check(
      failures,
      "extractKcl: nested one level deep is found",
      extractKcl({ edit_kcl_code: { outputs: { "main.kcl": "cube()" } } }) === "cube()",
    );
    check(failures, "extractKcl: no outputs → null", extractKcl({ status: "ok" }) === null);
    check(failures, "extractKcl: non-object → null", extractKcl("cube()") === null);
  }

  // --- full recorded lifecycle (FN-028 order) --------------------------------
  {
    let agg = createAggregate();
    const script: [string, ApplyEffect][] = [
      [FX.spuriousAuthError, "spurious-auth-swallowed"], // opens every session
      [FX.sessionData, "updated"],
      [FX.conversationId, "updated"],
      [FX.conversationId, "duplicate"], // arrives twice every session
      [FX.modesResponse, "updated"],
      [FX.pong, "none"],
    ];
    for (const [raw, expected] of script) {
      const r = feed(agg, raw);
      check(
        failures,
        `lifecycle setup: ${classifyFrame(raw).kind} → ${expected}`,
        r.effect === expected,
        `got ${r.effect}`,
      );
      agg = r.next;
    }
    agg = beginTurn(agg, "a 20mm cube");
    const turnScript: [string, ApplyEffect][] = [
      [FX.reasoning, "updated"],
      [FX.delta1, "updated"],
      [FX.delta2, "updated"],
      [FX.delta3, "updated"],
      [FX.info, "updated"],
      [FX.toolOutputKcl, "updated"],
      [FX.toolOutputKcl, "duplicate"], // FN-027: identical consecutive
      [FX.endOfStream, "turn-complete"],
    ];
    for (const [raw, expected] of turnScript) {
      const r = feed(agg, raw);
      check(
        failures,
        `lifecycle turn: ${classifyFrame(raw).kind} → ${expected}`,
        r.effect === expected,
        `got ${r.effect}`,
      );
      agg = r.next;
    }
    const turn = agg.turns[0];
    check(
      failures,
      "lifecycle final state",
      agg.apiCallId === "3b1f0a52-9c1e-4f7a-8d2b-5e6c7a8b9c0d" &&
        agg.conversationId === "9d8c7b6a-5f4e-4d3c-b2a1-0f9e8d7c6b5a" &&
        agg.defaultMode === "auto" &&
        agg.turns.length === 1 &&
        turn.status === "done" &&
        turn.reply === "I'll create a 20mm cube in KCL." &&
        turn.reasoning.length === 1 &&
        turn.infos.length === 1 &&
        turn.toolOutputCount === 1 &&
        turn.kcl !== null &&
        turn.wholeResponse === "Here is a 20mm cube in KCL.",
    );
  }

  return failures;
}

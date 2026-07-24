// Native thin client for Zoo's ML copilot websocket ("Zookeeper").
//
// Protocol reference: KittyCAD/web-zookeeper (github.com/KittyCAD/web-zookeeper,
// SPECIFICATION.md is the doc). Credited as the reference client only — we do
// NOT depend on the npm package because it is unpublishable as released
// (entrypoint dist/ is not committed and there is no prepare script;
// docs/API_FIELD_NOTES.md FN-025).
//
// Every behavior below was measured live against wss://api.zoo.dev/ws/ml/copilot
// in server/spikes/ws-copilot-spike.mjs and written up as FN-025..FN-028:
//   - auth is a post-upgrade JSON text frame {type:"headers",...} sent on open
//   - the server opens every session with a SPURIOUS auth error even when auth
//     succeeded — swallow exactly that text ONCE; a second auth error is real
//     (FN-026)
//   - send nothing else until the FIRST server payload arrives, or the backend
//     may close the socket (FN-026)
//   - server frames are single-top-level-key JSON with NO sequence numbers;
//     duplicates arrive (conversation_id twice per session, identical
//     consecutive tool_outputs) — dedupe by content (FN-027)
//   - JSON text frames only in this client; replay/msgpack/BSON deliberately
//     unsupported (FN-028)
//   - heartbeat {type:"ping"} every 4 s; {type:"system",command:"bye"} then
//     close on disconnect; the server reports close code 1006 even on clean
//     shutdown, so a deliberate disconnect never surfaces 1006 as an error
//   - turn ends at end_of_stream (carries whole_response) or error (which
//     terminates the turn — no end_of_stream follows)
//
// Token doctrine (operator mode): the token is held in client memory only for
// the instant needed to build the auth frame, is sent ONLY to Zoo's wss
// endpoint, is never logged, never persisted, and is wiped from this object
// the moment the auth frame is on the wire.
//
// Structure: pure, unit-testable frame classifier / aggregator functions
// (everything above the ZookeeperClient class) with zero socket or DOM
// dependencies — exercised offline by zookeeper.selfcheck.ts — plus a thin
// browser WebSocket wrapper class underneath.

// ---------------------------------------------------------------------------
// Wire constants (measured; see spike header comment)
// ---------------------------------------------------------------------------

export const COPILOT_URL = "wss://api.zoo.dev/ws/ml/copilot";

/** Exact text of the routine false-positive auth error (FN-026). The reference
 * client swallows it by exact string comparison; so do we — once only. */
export const SPURIOUS_AUTH_ERROR =
  'Please send `{ headers: { Authorization: "Bearer <token>" } }` over this websocket.';

const HEARTBEAT_MS = 4000; // worker-zookeeper's cadence, confirmed live

// ---------------------------------------------------------------------------
// Pure layer 1 — frame classification
// ---------------------------------------------------------------------------

export interface CopilotMode {
  id: string;
  label?: string;
  description?: string;
  disabled?: boolean;
}

/** One server frame, classified by its single top-level key (FN-027 shape).
 * Keys we don't model (replay, files, request_attachments, metrics family…)
 * become "ignored" — they never affect a drafting session. */
export type ServerFrame =
  | { kind: "pong" }
  | { kind: "session_data"; apiCallId: string }
  | { kind: "conversation_id"; conversationId: string }
  | { kind: "modes_response"; defaultMode: string; modes: CopilotMode[] }
  | { kind: "delta"; text: string }
  | { kind: "reasoning"; reasoningType: string; content: string }
  | { kind: "info"; text: string }
  | { kind: "tool_output"; result: unknown }
  | { kind: "error"; detail: string }
  | {
      kind: "end_of_stream";
      promptId: string | null;
      wholeResponse: string | null;
      startedAt: string | null;
      completedAt: string | null;
    }
  | { kind: "backend_shutdown"; reason: string | null }
  | { kind: "ignored"; key: string }
  | { kind: "unparseable"; raw: string };

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Classify one raw JSON text frame. Never throws. */
export function classifyFrame(raw: string): ServerFrame {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return { kind: "unparseable", raw };
  }
  const rec = asRecord(msg);
  if (!rec) return { kind: "unparseable", raw };
  const key = Object.keys(rec)[0];
  if (key === undefined) return { kind: "ignored", key: "(empty object)" };
  const body = asRecord(rec[key]) ?? {};

  switch (key) {
    case "pong":
      return { kind: "pong" };
    case "session_data":
      return { kind: "session_data", apiCallId: asString(body.api_call_id) ?? "" };
    case "conversation_id":
      return {
        kind: "conversation_id",
        conversationId: asString(body.conversation_id) ?? "",
      };
    case "modes_response": {
      const rawModes = Array.isArray(body.modes) ? body.modes : [];
      const modes: CopilotMode[] = [];
      for (const m of rawModes) {
        const mo = asRecord(m);
        if (!mo) continue;
        modes.push({
          id: asString(mo.id) ?? "?",
          label: asString(mo.label) ?? undefined,
          description: asString(mo.description) ?? undefined,
          disabled: typeof mo.disabled === "boolean" ? mo.disabled : undefined,
        });
      }
      return {
        kind: "modes_response",
        defaultMode: asString(body.default_mode) ?? "",
        modes,
      };
    }
    case "delta":
      return { kind: "delta", text: asString(body.delta) ?? "" };
    case "reasoning":
      return {
        kind: "reasoning",
        reasoningType: asString(body.type) ?? "?",
        // The spike saw non-string contents too; stringify rather than drop.
        content: asString(body.content) ?? JSON.stringify(body),
      };
    case "info":
      return { kind: "info", text: asString(body.text) ?? JSON.stringify(body) };
    case "tool_output":
      return { kind: "tool_output", result: body.result };
    case "error":
      return { kind: "error", detail: asString(body.detail) ?? JSON.stringify(body) };
    case "end_of_stream":
      return {
        kind: "end_of_stream",
        promptId: asString(body.id),
        wholeResponse: asString(body.whole_response),
        startedAt: asString(body.started_at),
        completedAt: asString(body.completed_at),
      };
    case "backend_shutdown":
      return { kind: "backend_shutdown", reason: asString(body.reason) };
    default:
      return { kind: "ignored", key };
  }
}

/** Pull generated KCL out of a tool_output result. Measured live: the
 * copilot's KCL tools (edit_kcl_code / text_to_cad, FN-028) carry source under
 * an `outputs` map of filename → code. Checked at the top level and one level
 * of nesting; multiple files are joined with filename banners. */
export function extractKcl(result: unknown): string | null {
  const rec = asRecord(result);
  if (!rec) return null;
  const direct = kclFromOutputs(rec.outputs);
  if (direct !== null) return direct;
  for (const v of Object.values(rec)) {
    const nested = asRecord(v);
    if (!nested) continue;
    const found = kclFromOutputs(nested.outputs);
    if (found !== null) return found;
  }
  return null;
}

function kclFromOutputs(outputs: unknown): string | null {
  const rec = asRecord(outputs);
  if (!rec) return null;
  const files: [string, string][] = [];
  for (const [name, src] of Object.entries(rec)) {
    if (typeof src === "string") files.push([name, src]);
  }
  if (files.length === 0) return null;
  if (files.length === 1) return files[0][1];
  return files.map(([name, src]) => `// --- ${name} ---\n${src}`).join("\n\n");
}

// ---------------------------------------------------------------------------
// Pure layer 2 — session aggregation
// ---------------------------------------------------------------------------

export interface ReasoningLine {
  type: string;
  content: string;
}

export interface TurnRecord {
  prompt: string;
  /** Aggregated delta text — the reply as it streams (spike: deltas are
   * aggregated, never rendered frame-by-frame). */
  reply: string;
  reasoning: ReasoningLine[];
  infos: string[];
  toolOutputCount: number;
  /** Latest KCL seen in a tool_output this turn, if any. */
  kcl: string | null;
  status: "streaming" | "done" | "error";
  errorDetail: string | null;
  wholeResponse: string | null;
}

export interface SessionAggregate {
  apiCallId: string | null; // the metering/billing handle (FN-028)
  conversationId: string | null;
  defaultMode: string | null;
  modes: CopilotMode[];
  /** FN-026: the one permitted swallow. A second auth error is real. */
  spuriousAuthSwallowed: boolean;
  /** Serialized content of the previous tool_output this turn — the FN-027
   * consecutive-duplicate dedupe window. Reset at each beginTurn. */
  lastToolOutputJson: string | null;
  lastError: string | null;
  turns: TurnRecord[];
}

export function createAggregate(): SessionAggregate {
  return {
    apiCallId: null,
    conversationId: null,
    defaultMode: null,
    modes: [],
    spuriousAuthSwallowed: false,
    lastToolOutputJson: null,
    lastError: null,
    turns: [],
  };
}

/** The turn currently streaming, if any. */
export function activeTurn(agg: SessionAggregate): TurnRecord | null {
  const last = agg.turns[agg.turns.length - 1];
  return last !== undefined && last.status === "streaming" ? last : null;
}

/** Open a new turn for a prompt about to be sent. */
export function beginTurn(agg: SessionAggregate, prompt: string): SessionAggregate {
  return {
    ...agg,
    lastToolOutputJson: null, // dedupe window is per turn
    lastError: null, // per-turn errors show on their own turn card, not as a stale banner
    turns: [
      ...agg.turns,
      {
        prompt,
        reply: "",
        reasoning: [],
        infos: [],
        toolOutputCount: 0,
        kcl: null,
        status: "streaming",
        errorDetail: null,
        wholeResponse: null,
      },
    ],
  };
}

export type ApplyEffect =
  | "none" // pong / ignored / frame with no active turn
  | "updated" // visible state change
  | "duplicate" // FN-027 duplicate dropped (conversation_id, consecutive tool_output)
  | "spurious-auth-swallowed" // FN-026 false positive, first occurrence only
  | "error" // real error frame — terminates the active turn if one exists
  | "turn-complete" // end_of_stream
  | "backend-shutdown";

export interface ApplyResult {
  next: SessionAggregate;
  effect: ApplyEffect;
}

function patchActiveTurn(
  agg: SessionAggregate,
  patch: Partial<TurnRecord>,
): SessionAggregate {
  const turns = agg.turns.slice();
  const last = turns[turns.length - 1];
  turns[turns.length - 1] = { ...last, ...patch };
  return { ...agg, turns };
}

/** Apply one classified frame to the session. Pure — returns a new aggregate
 * and an effect tag describing what happened (the socket wrapper and the
 * self-checks both key off the effect). */
export function applyFrame(agg: SessionAggregate, frame: ServerFrame): ApplyResult {
  switch (frame.kind) {
    case "pong":
    case "ignored":
    case "unparseable":
      return { next: agg, effect: "none" };

    case "session_data":
      if (agg.apiCallId === frame.apiCallId) return { next: agg, effect: "duplicate" };
      return { next: { ...agg, apiCallId: frame.apiCallId }, effect: "updated" };

    case "conversation_id":
      // FN-027: conversation_id arrives twice every session — dedupe by value.
      if (agg.conversationId === frame.conversationId)
        return { next: agg, effect: "duplicate" };
      return {
        next: { ...agg, conversationId: frame.conversationId },
        effect: "updated",
      };

    case "modes_response":
      return {
        next: {
          ...agg,
          defaultMode: frame.defaultMode !== "" ? frame.defaultMode : agg.defaultMode,
          modes: frame.modes,
        },
        effect: "updated",
      };

    case "delta": {
      const turn = activeTurn(agg);
      if (!turn) return { next: agg, effect: "none" };
      return {
        next: patchActiveTurn(agg, { reply: turn.reply + frame.text }),
        effect: "updated",
      };
    }

    case "reasoning": {
      const turn = activeTurn(agg);
      if (!turn) return { next: agg, effect: "none" };
      return {
        next: patchActiveTurn(agg, {
          reasoning: [
            ...turn.reasoning,
            { type: frame.reasoningType, content: frame.content },
          ],
        }),
        effect: "updated",
      };
    }

    case "info": {
      const turn = activeTurn(agg);
      if (!turn) return { next: agg, effect: "none" };
      return {
        next: patchActiveTurn(agg, { infos: [...turn.infos, frame.text] }),
        effect: "updated",
      };
    }

    case "tool_output": {
      const turn = activeTurn(agg);
      if (!turn) return { next: agg, effect: "none" };
      // FN-027: no sequence numbers — identical CONSECUTIVE tool_outputs are
      // duplicates; content equality is the only possible key.
      const json = JSON.stringify(frame.result) ?? "undefined";
      if (json === agg.lastToolOutputJson) return { next: agg, effect: "duplicate" };
      const kcl = extractKcl(frame.result);
      return {
        next: patchActiveTurn(
          { ...agg, lastToolOutputJson: json },
          {
            toolOutputCount: turn.toolOutputCount + 1,
            ...(kcl !== null ? { kcl } : {}),
          },
        ),
        effect: "updated",
      };
    }

    case "error": {
      // FN-026: the first spurious auth error is a false positive — swallow
      // exactly once. Any later auth error (even the same text) is real.
      if (frame.detail === SPURIOUS_AUTH_ERROR && !agg.spuriousAuthSwallowed) {
        return {
          next: { ...agg, spuriousAuthSwallowed: true },
          effect: "spurious-auth-swallowed",
        };
      }
      const withError = { ...agg, lastError: frame.detail };
      const turn = activeTurn(agg);
      if (!turn) return { next: withError, effect: "error" };
      // Error terminates the turn — no end_of_stream follows.
      return {
        next: patchActiveTurn(withError, {
          status: "error",
          errorDetail: frame.detail,
        }),
        effect: "error",
      };
    }

    case "end_of_stream": {
      const turn = activeTurn(agg);
      if (!turn) return { next: agg, effect: "none" };
      return {
        next: patchActiveTurn(agg, {
          status: "done",
          wholeResponse: frame.wholeResponse,
        }),
        effect: "turn-complete",
      };
    }

    case "backend_shutdown":
      return {
        next: {
          ...agg,
          lastError: frame.reason
            ? `backend shutdown: ${frame.reason}`
            : "backend shutdown",
        },
        effect: "backend-shutdown",
      };

    default: {
      const exhaustive: never = frame;
      return exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Socket wrapper — browser WebSocket, operator token in memory only
// ---------------------------------------------------------------------------

export type ConnectionPhase =
  | "idle" // no socket yet
  | "connecting" // socket opening / auth frame sent, waiting for first server payload
  | "handshake" // first payload arrived, list_modes sent, waiting for conversation_id
  | "ready" // conversation_id received — setup complete (spike: NOT socket open)
  | "closed" // deliberate disconnect
  | "failed"; // connection-level failure

export interface ClientSnapshot {
  phase: ConnectionPhase;
  /** Human-readable status note. Never contains the token. */
  note: string | null;
  aggregate: SessionAggregate;
}

export class ZookeeperClient {
  private ws: WebSocket | null = null;
  private token: string;
  private readonly url: string;
  private readonly onChange: (snap: ClientSnapshot) => void;
  private phase: ConnectionPhase = "idle";
  private note: string | null = null;
  private aggregate: SessionAggregate = createAggregate();
  private heartbeat: number | null = null;
  private sawFirstFrame = false;
  private deliberateClose = false;

  constructor(opts: {
    token: string;
    onChange: (snap: ClientSnapshot) => void;
    url?: string;
  }) {
    this.token = opts.token;
    this.onChange = opts.onChange;
    this.url = opts.url ?? COPILOT_URL;
  }

  connect(): void {
    if (this.ws) return;
    this.phase = "connecting";
    this.note = null;
    this.emit();

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      this.wipeToken();
      this.phase = "failed";
      this.note = e instanceof Error ? e.message : "could not open websocket";
      this.emit();
      return;
    }
    this.ws = ws;

    ws.addEventListener("open", () => {
      // Auth is a post-upgrade frame; it is built, sent, and never logged.
      ws.send(
        JSON.stringify({
          type: "headers",
          headers: { Authorization: `Bearer ${this.token}` },
        }),
      );
      // The token's only job is done — wipe our copy immediately.
      this.wipeToken();
      // FN-026: send NOTHING else (not even a ping) until the first server
      // payload arrives; racing ahead can get the socket closed.
    });
    ws.addEventListener("message", (ev) => this.onMessage(ev));
    ws.addEventListener("close", (ev) => this.onClose(ev));
    ws.addEventListener("error", () => {
      if (this.phase === "connecting") {
        this.note = "websocket error before handshake (network or endpoint refused)";
        this.emit();
      }
    });
  }

  /** Send one drafting prompt. Returns false when the session can't take one
   * (not ready, no mode yet, or a turn is still streaming). */
  sendPrompt(content: string): boolean {
    const text = content.trim();
    if (text === "" || this.phase !== "ready") return false;
    const mode = this.aggregate.defaultMode;
    if (mode === null || activeTurn(this.aggregate) !== null) return false;
    this.aggregate = beginTurn(this.aggregate, text);
    this.safeSend({ type: "user", content: text, mode });
    this.emit();
    return true;
  }

  /** Deliberate shutdown: system{bye}, close, wipe. The server reports close
   * code 1006 even on clean shutdown — never surfaced as an error here. */
  disconnect(): void {
    this.deliberateClose = true;
    this.stopHeartbeat();
    this.wipeToken();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.safeSend({ type: "system", command: "bye" });
    }
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) {
      try {
        this.ws.close(1000, "operator disconnect");
      } catch {
        // already closing
      }
    }
    this.phase = "closed";
    this.note = null;
    this.emit();
  }

  private onMessage(ev: MessageEvent): void {
    // JSON text frames only (FN-028) — replay/msgpack/BSON are out of scope.
    if (typeof ev.data !== "string") return;

    const phaseBefore = this.phase;
    if (!this.sawFirstFrame) {
      this.sawFirstFrame = true;
      // First server payload = safe to talk (FN-026).
      this.phase = "handshake";
      this.safeSend({ type: "list_modes" });
      this.startHeartbeat();
    }

    const frame = classifyFrame(ev.data);
    const { next, effect } = applyFrame(this.aggregate, frame);
    this.aggregate = next;

    if (frame.kind === "conversation_id" && this.phase === "handshake") {
      // Setup complete = conversation_id received, not socket open (spike).
      this.phase = "ready";
    }

    if (effect === "error" && this.phase !== "ready") {
      // A real error before setup completes is a connection failure. A second
      // spurious-text auth error means the token was actually rejected (FN-026).
      this.phase = "failed";
      this.note =
        frame.kind === "error" && frame.detail === SPURIOUS_AUTH_ERROR
          ? "Zoo rejected the token (auth error received twice)"
          : frame.kind === "error"
            ? frame.detail
            : "connection error";
      this.deliberateClose = true; // suppress the follow-up close-code note
      this.stopHeartbeat();
      if (this.ws && this.ws.readyState <= WebSocket.OPEN) {
        try {
          this.ws.close(1000, "auth failed");
        } catch {
          // already closing
        }
      }
    }

    if (effect === "backend-shutdown") {
      this.note = this.aggregate.lastError;
    }

    if ((effect !== "none" && effect !== "duplicate") || this.phase !== phaseBefore) {
      this.emit();
    }
  }

  private onClose(ev: CloseEvent): void {
    this.stopHeartbeat();
    this.wipeToken();
    this.ws = null;
    if (this.deliberateClose) {
      // Expected 1006 on clean shutdown — keep whatever phase disconnect() or
      // the auth-failure path already set.
      if (this.phase !== "failed") this.phase = "closed";
    } else if (this.phase !== "failed") {
      this.phase = "failed";
      // Keep a more specific note when one is already set (backend_shutdown
      // reason, pre-handshake socket error) — the generic close-code line is
      // the fallback only.
      if (this.note === null) {
        this.note = `connection lost (close code ${ev.code})`;
      }
    }
    this.emit();
  }

  private startHeartbeat(): void {
    if (this.heartbeat !== null) return;
    this.heartbeat = window.setInterval(
      () => this.safeSend({ type: "ping" }),
      HEARTBEAT_MS,
    );
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== null) {
      window.clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private safeSend(obj: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(obj));
      } catch {
        // socket died between the check and the send — close handler reports it
      }
    }
  }

  private wipeToken(): void {
    this.token = "";
  }

  private emit(): void {
    this.onChange({
      phase: this.phase,
      note: this.note,
      aggregate: this.aggregate,
    });
  }
}

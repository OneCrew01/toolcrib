// Zookeeper (ML copilot) websocket spike — wss://api.zoo.dev/ws/ml/copilot
// Protocol learned from the reference client KittyCAD/web-zookeeper (public
// 2026-07-22, no README — SPECIFICATION.md is the doc) and the worker it wraps,
// kittycad.ts src/worker-zookeeper.ts + src/api/ml/ml_copilot_ws.ts:
//   - URL: wss://api.zoo.dev/ws/ml/copilot [?replay=true&conversation_id=<uuid>&pr=<n>]
//   - auth = post-upgrade JSON text frame {"type":"headers","headers":{Authorization:
//     "Bearer …"}} sent on socket open (same pattern as engine socket, FN-013/FN-009)
//   - client frames are ALWAYS JSON text (worker sends JSON even though the lib
//     ships an unused toBSON); vocabulary: ping | list_modes | headers | user |
//     system{new|bye|continue|interrupt|cancel|answer_now} | project_context |
//     attachment_response
//   - server frames: JSON text normally; binary frames possible (replay is
//     msgpack; lib fallback path tries JSON then BSON). Discriminant is the
//     single top-level key: pong, session_data, conversation_id, modes_response,
//     delta, reasoning, info, tool_output, error, end_of_stream, replay,
//     backend_shutdown, request_attachments, attachments_loaded, files,
//     project_updated, zookeeper_auto_router_metadata, zookeeper_recovery_tool_output
//   - heartbeat: client sends {"type":"ping"} every 4s (worker-zookeeper does);
//     server answers {"pong":{}}
//   - setup complete = receiving conversation_id, NOT socket open; the reference
//     transport also refuses to send anything until the FIRST server payload
//     arrives ("backend can still close if app messages race ahead")
//   - known API false positive: an error frame with detail 'Please send
//     `{ headers: … }` over this websocket.' can arrive EVEN WHEN authed; the
//     reference client swallows it (SPURIOUS_AUTH_ERROR) — we tag, not abort
//   - turn ends at end_of_stream (carries whole_response + timing) or error
// Token is never printed; all logged frame text is redacted.
//
// Run from repo root:  node server/spikes/ws-copilot-spike.mjs
//   [--prompt="a 20mm cube"] [--mode=<id>] [--list-only] [--cap=ms]
//   [--replay=<conversation_id>]   (no prompt; verifies the replay frame + encoding)

import { loadToken } from "../lib/zoo.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const REPLAY_ID = typeof args.replay === "string" ? args.replay : null;
const URL_WS =
  "wss://api.zoo.dev/ws/ml/copilot" +
  (REPLAY_ID ? `?replay=true&conversation_id=${REPLAY_ID}` : "");
const PROMPT = args.prompt ?? "a 20mm cube";
const LIST_ONLY = !!args["list-only"] || !!REPLAY_ID;
const SESSION_CAP_MS = Number(args.cap ?? 240_000); // copilot turns can think; generous cap
const SMALL_FRAME = 500; // print full text of frames at or under this many chars

const token = loadToken();
const redact = (s) => String(s).replaceAll(token, "<token>");

// --- minimal MessagePack decoder (nil/bool/int/float/str/bin/array/map only) ---
// Enough to classify replay/binary frames honestly; anything else → hex head.
function mpDecode(buf) {
  let i = 0;
  const read = () => {
    const b = buf[i++];
    if (b <= 0x7f) return b; // positive fixint
    if (b >= 0xe0) return b - 0x100; // negative fixint
    if (b >= 0x80 && b <= 0x8f) return mpMap(b & 0x0f);
    if (b >= 0x90 && b <= 0x9f) return mpArr(b & 0x0f);
    if (b >= 0xa0 && b <= 0xbf) return mpStr(b & 0x1f);
    switch (b) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xc4: return mpBin(buf[i++]);
      case 0xc5: { const n = buf.readUInt16BE(i); i += 2; return mpBin(n); }
      case 0xc6: { const n = buf.readUInt32BE(i); i += 4; return mpBin(n); }
      case 0xca: { const v = buf.readFloatBE(i); i += 4; return v; }
      case 0xcb: { const v = buf.readDoubleBE(i); i += 8; return v; }
      case 0xcc: return buf[i++];
      case 0xcd: { const v = buf.readUInt16BE(i); i += 2; return v; }
      case 0xce: { const v = buf.readUInt32BE(i); i += 4; return v; }
      case 0xcf: { const v = buf.readBigUInt64BE(i); i += 8; return Number(v); }
      case 0xd0: return buf.readInt8(i++);
      case 0xd1: { const v = buf.readInt16BE(i); i += 2; return v; }
      case 0xd2: { const v = buf.readInt32BE(i); i += 4; return v; }
      case 0xd3: { const v = buf.readBigInt64BE(i); i += 8; return Number(v); }
      case 0xd9: return mpStr(buf[i++]);
      case 0xda: { const n = buf.readUInt16BE(i); i += 2; return mpStr(n); }
      case 0xdb: { const n = buf.readUInt32BE(i); i += 4; return mpStr(n); }
      case 0xdc: { const n = buf.readUInt16BE(i); i += 2; return mpArr(n); }
      case 0xdd: { const n = buf.readUInt32BE(i); i += 4; return mpArr(n); }
      case 0xde: { const n = buf.readUInt16BE(i); i += 2; return mpMap(n); }
      case 0xdf: { const n = buf.readUInt32BE(i); i += 4; return mpMap(n); }
      default: throw new Error(`msgpack byte 0x${b.toString(16)} unsupported`);
    }
  };
  const mpStr = (n) => { const s = buf.toString("utf8", i, i + n); i += n; return s; };
  const mpBin = (n) => { const s = buf.subarray(i, i + n); i += n; return s; };
  const mpArr = (n) => Array.from({ length: n }, read);
  const mpMap = (n) => { const o = {}; for (let k = 0; k < n; k++) { const key = read(); o[key] = read(); } return o; };
  return read();
}

// Parse a server frame the way worker-zookeeper does: text → JSON;
// binary → try UTF-8 JSON, then msgpack, else record hex head.
function parseFrame(data) {
  if (typeof data === "string") return { enc: "json", msg: JSON.parse(data), bytes: Buffer.byteLength(data) };
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  try { return { enc: "bin/json", msg: JSON.parse(buf.toString("utf8")), bytes: buf.length }; } catch {}
  try { return { enc: "bin/msgpack", msg: mpDecode(buf), bytes: buf.length }; } catch {}
  return { enc: "bin/unknown", msg: null, bytes: buf.length, hexHead: buf.subarray(0, 32).toString("hex") };
}

const SPURIOUS_AUTH_ERROR =
  'Please send `{ headers: { Authorization: "Bearer <token>" } }` over this websocket.';

const t0 = Date.now();
const ts = () => `+${((Date.now() - t0) / 1000).toFixed(3)}s`;
const log = (line) => console.log(`[${ts()}] ${redact(line)}`);

// --- session state ---------------------------------------------------------
let firstServerFrame = false;
let sentListModes = false;
let sentPrompt = false;
let conversationId = null;
let apiCallId = null;
let defaultMode = null;
let modes = [];
let deltas = 0, deltaChars = 0, pongs = 0;
const frameCounts = {};
let promptSentAt = null, firstDeltaAt = null, firstReasoningAt = null;
let done = false;

const ws = new WebSocket(URL_WS);
ws.binaryType = "arraybuffer";

const send = (obj, note = "") => {
  ws.send(JSON.stringify(obj));
  log(`-> ${obj.type}${note ? ` ${note}` : ""}`);
};

const finish = (why) => {
  if (done) return;
  done = true;
  log(`closing (${why})`);
  try { ws.send(JSON.stringify({ type: "system", command: "bye" })); log("-> system{bye}"); } catch {}
  try { ws.close(1000, "spike done"); } catch {}
  setTimeout(() => summary(why), 1500);
};

const watchdog = setTimeout(() => {
  if (sentPrompt && !done) { try { send({ type: "system", command: "cancel" }, "(cap hit)"); } catch {} }
  finish("session cap");
}, SESSION_CAP_MS);

ws.addEventListener("open", () => {
  log("socket open (101) — sending auth headers frame");
  // Never print the token; this frame is built and sent, not logged.
  ws.send(JSON.stringify({ type: "headers", headers: { Authorization: `Bearer ${token}` } }));
  // Reference client: do NOT send app messages until the first server payload.
});

// Heartbeat identical to worker-zookeeper: JSON ping every 4s.
const heartbeat = setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
}, 4000);

const maybeSendPrompt = () => {
  if (LIST_ONLY || sentPrompt || !conversationId || !defaultMode) return;
  sentPrompt = true;
  promptSentAt = Date.now();
  const mode = args.mode ?? defaultMode;
  send({ type: "user", content: PROMPT, mode }, `content="${PROMPT}" mode=${mode}`);
};

ws.addEventListener("message", (ev) => {
  const { enc, msg, bytes, hexHead } = parseFrame(ev.data);
  if (!firstServerFrame) {
    firstServerFrame = true;
    log(`first server payload arrived (${enc}, ${bytes} B) — safe to talk`);
    if (!sentListModes) { sentListModes = true; send({ type: "list_modes" }); }
  }
  if (msg === null) { log(`<- UNDECODABLE ${enc} (${bytes} B) hex=${hexHead}`); return; }

  const kind = typeof msg === "object" ? Object.keys(msg)[0] : typeof msg;
  frameCounts[kind] = (frameCounts[kind] ?? 0) + 1;

  switch (kind) {
    case "pong":
      pongs++;
      if (pongs === 1) log(`<- pong (${bytes} B) [heartbeat confirmed; further pongs counted silently]`);
      return;
    case "session_data":
      apiCallId = msg.session_data.api_call_id;
      log(`<- session_data (${bytes} B) api_call_id=${apiCallId}  [metering handle]`);
      return;
    case "conversation_id":
      conversationId = msg.conversation_id.conversation_id;
      log(`<- conversation_id (${bytes} B) ${conversationId}  [setup complete → Ready]`);
      maybeSendPrompt();
      return;
    case "modes_response": {
      modes = msg.modes_response.modes;
      defaultMode = msg.modes_response.default_mode;
      const list = modes.map((m) => `${m.id}${m.disabled ? "(disabled)" : ""}`).join(", ");
      log(`<- modes_response (${bytes} B) default=${defaultMode} modes=[${list}]`);
      for (const m of modes) log(`     mode ${m.id}: "${m.label}" — ${m.description}`);
      if (LIST_ONLY) { finish("list-only"); return; }
      maybeSendPrompt();
      return;
    }
    case "delta":
      deltas++;
      deltaChars += msg.delta.delta.length;
      if (!firstDeltaAt) { firstDeltaAt = Date.now(); log(`<- first delta (${bytes} B) "${msg.delta.delta.slice(0, 80)}"`); }
      return; // aggregated, per reference client — logged in summary
    case "reasoning": {
      if (!firstReasoningAt) firstReasoningAt = Date.now();
      const r = msg.reasoning;
      const body = String(r.content ?? JSON.stringify(r)).replace(/\s+/g, " ");
      log(`<- reasoning/${r.type ?? "?"} (${bytes} B) ${body.length <= SMALL_FRAME ? `"${body}"` : `"${body.slice(0, SMALL_FRAME)}…" [${body.length} chars]`}`);
      return;
    }
    case "info":
      log(`<- info (${bytes} B) "${msg.info.text}"`);
      return;
    case "tool_output": {
      const r = msg.tool_output.result;
      const s = JSON.stringify(r);
      log(`<- tool_output (${bytes} B) ${s.length <= SMALL_FRAME ? s : `${s.slice(0, SMALL_FRAME)}… [${s.length} chars]`}`);
      return;
    }
    case "error": {
      const detail = msg.error.detail;
      if (detail === SPURIOUS_AUTH_ERROR) {
        log(`<- error (${bytes} B) [SPURIOUS auth false-positive per reference client — ignored]`);
        return;
      }
      log(`<- error (${bytes} B) detail="${detail}" [terminates turn; no end_of_stream follows]`);
      if (sentPrompt) finish("error frame");
      return;
    }
    case "end_of_stream": {
      const e = msg.end_of_stream;
      const dur = e.started_at && e.completed_at
        ? `${((new Date(e.completed_at) - new Date(e.started_at)) / 1000).toFixed(1)}s server-side`
        : "no timing";
      log(`<- end_of_stream (${bytes} B) prompt_id=${e.id ?? "?"} ${dur}`);
      if (e.whole_response) {
        log(`   whole_response [${e.whole_response.length} chars]:`);
        console.log(redact(e.whole_response.length <= 2000 ? e.whole_response : e.whole_response.slice(0, 2000) + "\n… [trimmed]"));
      }
      finish("end_of_stream");
      return;
    }
    case "replay": {
      // replay.messages = array of byte arrays, each UTF-8 JSON of one frame.
      const kinds = {};
      for (const bm of msg.replay.messages) {
        try {
          const d = JSON.parse(Buffer.from(Uint8Array.from(Object.values(bm))).toString("utf8"));
          const k = d?.type === "user" ? "user" : Object.keys(d ?? {})[0] ?? "?";
          kinds[k] = (kinds[k] ?? 0) + 1;
        } catch { kinds.undecodable = (kinds.undecodable ?? 0) + 1; }
      }
      log(`<- replay (${enc}, ${bytes} B) ${msg.replay.messages.length} folded frames: ${JSON.stringify(kinds)}`);
      if (REPLAY_ID) finish("replay received");
      return;
    }
    case "backend_shutdown":
      log(`<- backend_shutdown (${bytes} B) reason=${msg.backend_shutdown.reason ?? "none"}`);
      finish("backend_shutdown");
      return;
    default: {
      const s = JSON.stringify(msg);
      log(`<- ${kind} (${enc}, ${bytes} B) ${s.length <= SMALL_FRAME ? s : `${s.slice(0, SMALL_FRAME)}… [${s.length} chars]`}`);
    }
  }
});

ws.addEventListener("close", (ev) => {
  log(`socket closed code=${ev.code} reason="${ev.reason}"`);
  summary(`close ${ev.code}`);
});
ws.addEventListener("error", () => log("socket error event"));

function summary(why) {
  if (summary.done) return;
  summary.done = true;
  clearInterval(heartbeat);
  clearTimeout(watchdog);
  const line = (k, v) => console.log(`  ${k.padEnd(26)} ${v}`);
  console.log(`\n=== ws-copilot-spike summary (${why}) ===`);
  line("conversation_id", conversationId ?? "never received");
  line("api_call_id", apiCallId ?? "never received");
  line("default mode", defaultMode ?? "unknown");
  line("frame counts", JSON.stringify(frameCounts));
  line("deltas aggregated", `${deltas} frames, ${deltaChars} chars`);
  if (promptSentAt && firstDeltaAt) line("prompt → first delta", `${((firstDeltaAt - promptSentAt) / 1000).toFixed(2)}s`);
  if (promptSentAt && firstReasoningAt) line("prompt → first reasoning", `${((firstReasoningAt - promptSentAt) / 1000).toFixed(2)}s`);
  line("total wall time", `${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(0);
}

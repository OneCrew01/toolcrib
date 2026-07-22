// Engine websocket spike — wss://api.zoo.dev/ws/modeling/commands
// Protocol per OpenAPI: send WebSocketRequest variants (modeling_cmd_req, ping,
// headers); receive {success, request_id, resp:{type,data}} or {success:false, errors}.
// Measured here (2026-07-22):
//   - upgrade returns 101 regardless of auth (FN-009); ?token= query param is IGNORED
//   - real auth = post-upgrade {"type":"headers","headers":{Authorization:"Bearer …"}};
//     unauthenticated sockets get an auth_token_missing nag 1/s, dropped ~4-5s (1006)
//   - responses arrive as JSON text frames; export file contents are base64 strings
//     (binary/BSON path exists per spec but was never observed on this socket)
//   - no idle timeout seen <=25s; metrics_request every ~10s, safe to ignore;
//     export2d does NOT end the session; client close() reports as 1006, not 1000
// Token is never printed.
//
// Run from repo root:  node server/spikes/ws-modeling-spike.mjs
//   [--rung=1..4] [--auth=headers|query] [--skip-probe] [--linger=ms]
//   [--probe=keepalive --seconds=N --interval=ms --pings=N --metrics]
// Sessions self-limit to <60s connected time (metering unknown).

import { randomUUID } from "node:crypto";
import { loadToken } from "../lib/zoo.mjs";

const WS_BASE = "wss://api.zoo.dev/ws/modeling/commands?webrtc=false";
const SESSION_CAP_MS = 55_000;
const CMD_TIMEOUT_MS = 15_000;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const MAX_RUNG = Number(args.rung ?? 4);
const AUTH_MODE = args.auth ?? "headers"; // "query" kept as evidence mode: server ignores it

const token = loadToken();
const redact = (s) => String(s).replaceAll(token, "<token>");

// --- minimal BSON decoder (doc/array/string/binary/double/int/bool/null only) ---
function bsonDoc(buf, offset = 0) {
  const len = buf.readInt32LE(offset);
  const end = offset + len - 1;
  let i = offset + 4;
  const out = {};
  while (i < end) {
    const t = buf[i++];
    let s = i;
    while (buf[s] !== 0) s++;
    const name = buf.toString("utf8", i, s);
    i = s + 1;
    let v;
    switch (t) {
      case 0x01: v = buf.readDoubleLE(i); i += 8; break;
      case 0x02: { const l = buf.readInt32LE(i); v = buf.toString("utf8", i + 4, i + 3 + l); i += 4 + l; break; }
      case 0x03: { const l = buf.readInt32LE(i); v = bsonDoc(buf, i); i += l; break; }
      case 0x04: { const l = buf.readInt32LE(i); v = Object.values(bsonDoc(buf, i)); i += l; break; }
      case 0x05: { const l = buf.readInt32LE(i); v = buf.subarray(i + 5, i + 5 + l); i += 5 + l; break; }
      case 0x08: v = !!buf[i]; i += 1; break;
      case 0x0a: v = null; break;
      case 0x10: v = buf.readInt32LE(i); i += 4; break;
      case 0x11:
      case 0x12: v = Number(buf.readBigInt64LE(i)); i += 8; break;
      default: throw new Error(`bson type 0x${t.toString(16)} @${i}`);
    }
    out[name] = v;
  }
  return out;
}

// Transcript-safe stringify: cap long arrays/strings/buffers.
function summarize(v, depth = 0) {
  if (v === null || typeof v !== "object") {
    if (typeof v === "string" && v.length > 120) return JSON.stringify(v.slice(0, 120) + `…(${v.length} chars)`);
    return JSON.stringify(v);
  }
  if (Buffer.isBuffer(v) || v instanceof Uint8Array)
    return `<${v.length} bytes: ${Buffer.from(v.subarray(0, 24)).toString("utf8").replace(/[^\x20-\x7e]/g, ".")}…>`;
  if (Array.isArray(v)) {
    const head = v.slice(0, 8).map((x) => summarize(x, depth + 1));
    return `[${head.join(",")}${v.length > 8 ? `,…(${v.length} total)` : ""}]`;
  }
  const entries = Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}:${summarize(x, depth + 1)}`);
  return `{${entries.join(",")}}`;
}

class Session {
  constructor(name, { withToken = true, authViaHeadersMsg = false } = {}) {
    this.name = name;
    this.t0 = 0;
    this.pending = new Map(); // request_id -> {resolve, reject, timer}
    this.unmatched = [];
    this.closed = null;
    this.authViaHeadersMsg = authViaHeadersMsg;
    this.url = withToken && !authViaHeadersMsg ? `${WS_BASE}&token=${token}` : WS_BASE;
  }

  log(line) {
    const dt = this.t0 ? `+${String(Date.now() - this.t0).padStart(5)}ms` : "     --";
    console.log(`[${this.name} ${dt}] ${redact(line)}`);
  }

  open() {
    this.log(`CONNECT ${redact(this.url)}`);
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      this.watchdog = setTimeout(() => {
        this.log(`WATCHDOG session cap ${SESSION_CAP_MS}ms — closing`);
        ws.close(1000, "session cap");
      }, SESSION_CAP_MS);

      ws.addEventListener("open", () => {
        this.t0 = Date.now();
        this.log("OPEN (101 upgrade complete)");
        if (this.authViaHeadersMsg) {
          this.send({ type: "headers", headers: { Authorization: `Bearer ${token}` } }, "headers(auth)");
        }
        resolve();
      });
      ws.addEventListener("error", (e) => {
        this.log(`ERROR ${e.message ?? e}`);
        reject(new Error(String(e.message ?? "ws error")));
      });
      ws.addEventListener("close", (e) => {
        this.closed = { code: e.code, reason: e.reason };
        this.log(`CLOSE code=${e.code} reason=${JSON.stringify(e.reason)}`);
        clearTimeout(this.watchdog);
        for (const p of this.pending.values()) p.reject(new Error(`closed ${e.code}`));
        this.pending.clear();
      });
      ws.addEventListener("message", (e) => this.onMessage(e));
    });
  }

  onMessage(e) {
    let msg, tag;
    if (typeof e.data === "string") {
      tag = `text ${e.data.length}B`;
      try { msg = JSON.parse(e.data); } catch { this.log(`← RECV ${tag} (unparseable) ${e.data.slice(0, 200)}`); return; }
    } else {
      const buf = Buffer.from(e.data);
      tag = `binary ${buf.length}B`;
      try { msg = bsonDoc(buf); } catch (err) {
        this.log(`← RECV ${tag} bson-decode-failed (${err.message}) head=${buf.subarray(0, 32).toString("hex")}`);
        return;
      }
    }
    this.log(`← RECV ${tag} ${summarize(msg)}`);
    const rid = msg.request_id;
    if (rid && this.pending.has(rid)) {
      const p = this.pending.get(rid);
      this.pending.delete(rid);
      clearTimeout(p.timer);
      msg.success === false ? p.reject(Object.assign(new Error("failure response"), { msg })) : p.resolve(msg);
    } else {
      this.unmatched.push(msg);
    }
  }

  send(obj, label) {
    this.log(`→ SENT ${label ?? obj.type} ${label === "headers(auth)" ? "{Authorization: Bearer <token>}" : summarize(obj)}`);
    this.ws.send(JSON.stringify(obj));
  }

  // One modeling command round-trip, correlated by cmd_id === request_id.
  cmd(cmd, label) {
    const cmd_id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(cmd_id);
        reject(new Error(`timeout ${CMD_TIMEOUT_MS}ms waiting for ${label ?? cmd.type}`));
      }, CMD_TIMEOUT_MS);
      this.pending.set(cmd_id, { resolve, reject, timer });
      this.send({ type: "modeling_cmd_req", cmd, cmd_id }, `modeling_cmd_req ${label ?? cmd.type} cmd_id=${cmd_id.slice(0, 8)}`);
    }).then((r) => ({ ...r, cmd_id }));
  }

  wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

  close() {
    clearTimeout(this.watchdog);
    if (this.ws && this.ws.readyState <= 1) this.ws.close(1000, "done");
  }
}

// Rung 1a — control: no token at all. What does the server do post-upgrade?
async function probeNoToken() {
  console.log("\n=== RUNG 1a: no-token control probe ===");
  const s = new Session("no-tok", { withToken: false });
  try {
    await s.open();
    await s.wait(3000);
    if (!s.closed) {
      s.send({ type: "ping" }, "ping");
      await s.wait(2000);
    }
    if (!s.closed) {
      try {
        await s.cmd({ type: "default_camera_get_settings" });
      } catch (e) {
        s.log(`cmd outcome: ${e.msg ? summarize(e.msg) : e.message}`);
      }
      await s.wait(1500);
    }
  } catch (e) {
    s.log(`probe ended: ${e.message}`);
  } finally {
    s.close();
  }
  return s.closed;
}

// Rungs 1b–4 in one authed session to stay under the time cap.
async function authedLadder() {
  console.log(`\n=== RUNG 1b: authed connect (auth=${AUTH_MODE}) ===`);
  const s = new Session("auth", { authViaHeadersMsg: AUTH_MODE === "headers" });
  const results = { rung: 1 };
  try {
    await s.open();
    await s.wait(5200); // survival check >5s before first command
    if (s.closed) throw new Error(`closed during survival window: ${s.closed.code}`);
    s.log(`SURVIVED >5s; server-initiated frames so far: ${s.unmatched.length}`);

    if (MAX_RUNG >= 2) {
      console.log("\n=== RUNG 2: benign read-only command ===");
      const r = await s.cmd({ type: "default_camera_get_settings" });
      results.rung = 2;
      results.camera = r.resp;
    }

    if (MAX_RUNG >= 3) {
      console.log("\n=== RUNG 3: cube via path commands + bounding box ===");
      const path = await s.cmd({ type: "start_path" });
      const P = path.cmd_id;
      await s.cmd({ type: "move_path_pen", path: P, to: { x: 0, y: 0, z: 0 } });
      for (const [x, y] of [[10, 0], [10, 10], [0, 10]])
        await s.cmd({ type: "extend_path", path: P, segment: { type: "line", end: { x, y, z: 0 }, relative: false } }, `extend_path→(${x},${y})`);
      await s.cmd({ type: "close_path", path_id: P });
      await s.cmd({ type: "extrude", target: P, distance: 10 });
      const bb = await s.cmd({ type: "bounding_box", entity_ids: [], output_unit: "mm" });
      results.rung = 3;
      results.bbox = bb.resp;
    }

    if (MAX_RUNG >= 4) {
      console.log("\n=== RUNG 4: 2D DXF export of a fresh sketch ===");
      const p2 = await s.cmd({ type: "start_path" }, "start_path(sketch2)");
      const P2 = p2.cmd_id;
      await s.cmd({ type: "move_path_pen", path: P2, to: { x: 20, y: 0, z: 0 } });
      for (const [x, y] of [[25, 0], [25, 5], [20, 5]])
        await s.cmd({ type: "extend_path", path: P2, segment: { type: "line", end: { x, y, z: 0 }, relative: false } }, `extend_path→(${x},${y})`);
      await s.cmd({ type: "close_path", path_id: P2 });
      const exp = await s.cmd({ type: "export2d", entity_ids: [P2], format: { type: "dxf", storage: "ascii" } }, "export2d dxf");
      results.rung = 4;
      results.export = exp.resp;
    }
  } catch (e) {
    console.log(`LADDER STOPPED at rung ${results.rung}: ${e.msg ? summarize(e.msg) : e.message}`);
    results.error = e.msg ?? e.message;
  } finally {
    if (args.linger && !s.closed) {
      s.log(`lingering ${args.linger}ms to observe server-side close behavior`);
      await s.wait(Number(args.linger));
    }
    s.close();
    await s.wait(300);
  }
  return results;
}

// Lifetime probe: authed + pinging, no modeling traffic. Distinguishes an idle
// timeout from a drop-after-export. All ClientMetrics fields are nullable, so
// an empty metrics_response is schema-valid.
async function probeKeepalive(seconds = 25) {
  const intervalMs = Number(args.interval ?? 2000);
  const maxPings = Number(args.pings ?? Infinity);
  console.log(`\n=== KEEPALIVE PROBE: authed, ping every ${intervalMs}ms (max ${maxPings}), ${seconds}s ===`);
  const s = new Session("keep", { authViaHeadersMsg: true });
  await s.open();
  let sent = 0;
  const pinger = setInterval(() => {
    if (s.closed || sent >= maxPings) return clearInterval(pinger);
    if (args.metrics) s.send({ type: "metrics_response", metrics: {} }, "metrics_response");
    s.send({ type: "ping" }, "ping");
    sent++;
  }, intervalMs);
  await s.wait(seconds * 1000);
  clearInterval(pinger);
  s.log(s.closed ? `dropped at code=${s.closed.code}` : `still open after ${seconds}s`);
  s.close();
  await s.wait(300);
  return s.closed;
}

if (args.probe === "keepalive") {
  await probeKeepalive(Number(args.seconds ?? 25));
  process.exit(0);
}

const noTokClose = args["skip-probe"] ? null : await probeNoToken();
const res = await authedLadder();

console.log("\n=== SUMMARY ===");
if (noTokClose) console.log(`no-token session close: code=${noTokClose.code} reason=${JSON.stringify(noTokClose.reason)}`);
console.log(`highest rung reached: ${res.rung}${res.error ? " (with error above)" : ""}`);
if (res.bbox) console.log(`bounding box resp: ${summarize(res.bbox)}`);

// Export contents arrive base64 over the JSON socket (spec says binary/bson —
// that applies to binary frames; text frames carry base64). Decode and verify.
const file = res.export?.data?.modeling_response?.data?.files?.[0];
if (file) {
  const dxf = Buffer.from(file.contents, "base64").toString("utf8");
  const lines = (dxf.match(/^LINE$/gm) ?? []).length;
  console.log(`dxf file "${file.name}": ${dxf.length} bytes decoded, ${lines} LINE entities`);
  console.log(`dxf head: ${JSON.stringify(dxf.slice(0, 48))}`);
  console.log(`dxf has sketch coords 20/25: ${dxf.includes("25.0") && dxf.includes("20.0")}`);
}
process.exit(0);

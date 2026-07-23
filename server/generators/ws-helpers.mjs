// Modeling-websocket helpers for generator validation — distilled from
// server/spikes/ws-modeling-spike.mjs (FN-013..016). Auth is the
// post-upgrade headers frame; commands are modeling_cmd_req envelopes
// correlated by cmd_id. Token is never printed.

import { randomUUID } from "node:crypto";
import { loadToken } from "../lib/zoo.mjs";

const WS_URL = "wss://api.zoo.dev/ws/modeling/commands?webrtc=false";
const CMD_TIMEOUT_MS = 15_000;
const SESSION_CAP_MS = 50_000;

class ModelingSession {
  constructor(token) {
    this.token = token;
    this.pending = new Map();
    this.closed = null;
  }

  open() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      this.watchdog = setTimeout(() => ws.close(1000, "session cap"), SESSION_CAP_MS);
      ws.addEventListener("open", () => {
        ws.send(JSON.stringify({ type: "headers", headers: { Authorization: `Bearer ${this.token}` } }));
        resolve();
      });
      ws.addEventListener("error", (e) => reject(new Error(String(e.message ?? "ws error"))));
      ws.addEventListener("close", (e) => {
        this.closed = { code: e.code, reason: e.reason };
        clearTimeout(this.watchdog);
        for (const p of this.pending.values()) p.reject(new Error(`socket closed ${e.code}`));
        this.pending.clear();
      });
      ws.addEventListener("message", (e) => {
        if (typeof e.data !== "string") return; // JSON text frames only on this path
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        const p = msg.request_id && this.pending.get(msg.request_id);
        if (!p) return;
        this.pending.delete(msg.request_id);
        clearTimeout(p.timer);
        msg.success === false
          ? p.reject(Object.assign(new Error("modeling command failed"), { msg }))
          : p.resolve(msg);
      });
    });
  }

  cmd(cmd) {
    const cmd_id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(cmd_id);
        reject(new Error(`timeout waiting for ${cmd.type}`));
      }, CMD_TIMEOUT_MS);
      this.pending.set(cmd_id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ type: "modeling_cmd_req", cmd, cmd_id }));
    }).then((r) => ({ ...r, cmd_id }));
  }

  wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

  close() {
    clearTimeout(this.watchdog);
    if (this.ws && this.ws.readyState <= 1) this.ws.close(1000, "done");
  }
}

/** Open an authed session, run fn(session), always close. */
export async function withModelingSession(fn, token = loadToken()) {
  const s = new ModelingSession(token);
  await s.open();
  await s.wait(1200); // let the auth frame land before the first command
  try {
    return await fn(s);
  } finally {
    s.close();
    await s.wait(200);
  }
}

// Measured 2026-07-22: bounding_box responds {center:{x,y,z}, dimensions:{x,y,z}}
// (not min/max as the name suggests). Accept either shape, normalize to
// {center, dims}.
function findBounds(node) {
  if (!node || typeof node !== "object") return null;
  const isVec = (v) => v && typeof v.x === "number" && typeof v.y === "number" && typeof v.z === "number";
  if (isVec(node.center) && isVec(node.dimensions)) return { center: node.center, dims: node.dimensions };
  if (isVec(node.min) && isVec(node.max)) {
    return {
      center: { x: (node.min.x + node.max.x) / 2, y: (node.min.y + node.max.y) / 2, z: (node.min.z + node.max.z) / 2 },
      dims: { x: node.max.x - node.min.x, y: node.max.y - node.min.y, z: node.max.z - node.min.z },
    };
  }
  for (const v of Object.values(node)) {
    const hit = findBounds(v);
    if (hit) return hit;
  }
  return null;
}

/**
 * Build a centered w x h rectangle, extrude to depth, return the scene
 * bounding box {center, dims} in mm. One solid per session keeps the box honest.
 */
export async function boxBoundingBox({ widthMm: w, heightMm: h, depthMm: t }) {
  return withModelingSession(async (s) => {
    const path = await s.cmd({ type: "start_path" });
    const P = path.cmd_id;
    await s.cmd({ type: "move_path_pen", path: P, to: { x: -w / 2, y: -h / 2, z: 0 } });
    for (const [x, y] of [[w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]) {
      await s.cmd({ type: "extend_path", path: P, segment: { type: "line", end: { x, y, z: 0 }, relative: false } });
    }
    await s.cmd({ type: "close_path", path_id: P });
    await s.cmd({ type: "extrude", target: P, distance: t });
    const bb = await s.cmd({ type: "bounding_box", entity_ids: [], output_unit: "mm" });
    const bounds = findBounds(bb.resp);
    if (!bounds) throw new Error(`no min/max pair in bounding_box response: ${JSON.stringify(bb.resp).slice(0, 400)}`);
    return bounds;
  });
}

#!/usr/bin/env node
// Handshake probe for the Engine websocket (/ws/modeling/commands).
// Checks which auth carriers the upgrade accepts: Authorization header vs ?token=.
// (Node's standard WebSocket API cannot set an Authorization header, so knowing
// whether a query token works decides how a zero-dependency client must connect.)

import { request } from "node:https";
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

function loadToken() {
  if (process.env.ZOO_API_TOKEN) return process.env.ZOO_API_TOKEN;
  if (existsSync(".env")) {
    const m = readFileSync(".env", "utf8").match(/^ZOO_API_TOKEN=(.+)$/m);
    if (m) return m[1].trim();
  }
  console.error("No ZOO_API_TOKEN");
  process.exit(1);
}
const TOKEN = loadToken();

function upgradeProbe(path, extraHeaders = {}) {
  return new Promise((resolve) => {
    const req = request({
      host: "api.zoo.dev",
      path,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
        ...extraHeaders,
      },
    });
    req.on("upgrade", (res, socket) => {
      socket.destroy();
      resolve({ status: res.statusCode, note: "upgrade event (101)" });
    });
    req.on("response", (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, note: body.slice(0, 200) }));
    });
    req.on("error", (e) => resolve({ status: null, note: e.message }));
    req.end();
  });
}

const target = "/ws/modeling/commands?webrtc=false";
const results = {
  authHeader: await upgradeProbe(target, { Authorization: `Bearer ${TOKEN}` }),
  queryToken: await upgradeProbe(`${target}&token=${TOKEN}`),
  noAuth: await upgradeProbe(target),
};
for (const [k, v] of Object.entries(results)) console.log(`${k}: ${v.status} — ${v.note}`);

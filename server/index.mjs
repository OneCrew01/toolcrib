#!/usr/bin/env node
// ToolCRIB backend skeleton — the ONLY process that holds the Zoo token.
// The web app is a thin client to this; it never calls Zoo or holds a key.
// Zero dependencies: node:http + fetch. Grows into the job/state-machine host (Day 2).

import { createServer } from "node:http";

const PORT = process.env.PORT || 8787;

const routes = {
  "GET /health": () => ({ ok: true, service: "toolcrib", ts: new Date().toISOString() }),
  // Day 2+: POST /jobs (create from generationRequest), GET /jobs/:id, POST /jobs/:id/approve
};

createServer(async (req, res) => {
  const key = `${req.method} ${new URL(req.url, "http://x").pathname}`;
  const handler = routes[key];
  res.setHeader("content-type", "application/json");
  if (!handler) {
    res.statusCode = 404;
    return res.end(JSON.stringify({ error: "not found" }));
  }
  try {
    res.end(JSON.stringify(await handler(req)));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(e.message ?? e) }));
  }
}).listen(PORT, () => console.log(`toolcrib backend on :${PORT}`));

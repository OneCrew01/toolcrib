#!/usr/bin/env node
// ToolCRIB backend — the ONLY process that would ever hold the Zoo token.
// The web app is a thin client to this; it never calls Zoo or holds a key.
// All routes and behavior live in server/api/server.mjs; this file just boots
// it on the contract port against the shared pipeline data dir.

import { createApiServer } from "./api/server.mjs";

const PORT = Number(process.env.PORT || 8787);

// Loopback only, and deliberately NOT configurable. `.listen(PORT)` with no
// host argument binds every interface, and this server has no authentication
// on any route: POST /api/jobs starts a pipeline and POST
// /api/jobs/:id/decision signs a named human approval — the gate this whole
// entry's trust story rests on. Bound wide, anything that can reach the
// operator's machine on this port can sign that approval. There is no env
// escape hatch because an escape hatch is how the wide bind comes back.
const HOST = "127.0.0.1";

const server = createApiServer();
server.listen(PORT, HOST, () => {
  // Reported from the listening socket, not echoed from the constant above:
  // the log line is then evidence of where the process ACTUALLY bound, and it
  // reads 0.0.0.0 the moment someone drops the host argument.
  const bound = server.address();
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      evt: "listen",
      service: "toolcrib",
      host: bound.address,
      port: bound.port,
    }),
  );
});

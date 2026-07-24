#!/usr/bin/env node
// ToolCRIB backend — the ONLY process that would ever hold the Zoo token.
// The web app is a thin client to this; it never calls Zoo or holds a key.
// All routes and behavior live in server/api/server.mjs; this file just boots
// it on the contract port against the shared pipeline data dir.

import { createApiServer } from "./api/server.mjs";

const PORT = Number(process.env.PORT || 8787);

createApiServer().listen(PORT, () =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), evt: "listen", service: "toolcrib", port: PORT })),
);

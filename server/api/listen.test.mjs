// Where the server BINDS is decided in one place — server/index.mjs — and it
// is not decided by anything createApiServer() returns, so a test that calls
// createApiServer() cannot see the property at all. This one spawns the real
// boot file on a free port and checks the binding two ways:
//
//   1. the startup log line, which reports server.address() off the listening
//      socket rather than echoing the constant, so dropping the host argument
//      makes it read 0.0.0.0 and this assertion fails on any machine;
//   2. a TCP connect to this machine's own non-loopback address, which is the
//      property itself: the LAN must get connection-refused.
//
// (2) is the real claim and (1) is the one that cannot be defeated by a
// firewall silently doing the job the bind was supposed to do, which is why
// both are here.

import { test } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";

const ENTRY = fileURLToPath(new URL("../index.mjs", import.meta.url));

/** A port nothing is on: bind ephemeral, read it back, let it go. */
function freePort() {
  return new Promise((done) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => done(port));
    });
  });
}

function canConnect(host, port, timeoutMs = 2_000) {
  return new Promise((done) => {
    const sock = connect({ host, port });
    const settle = (ok) => {
      sock.destroy();
      done(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => settle(true));
    sock.once("timeout", () => settle(false));
    sock.once("error", () => settle(false));
  });
}

/** The boot file's first structured log line, parsed. */
function firstListenLine(child, timeoutMs = 15_000) {
  return new Promise((done, fail) => {
    let buf = "";
    const timer = setTimeout(() => fail(new Error(`no listen line in ${timeoutMs}ms; saw: ${buf}`)), timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      for (const line of buf.split("\n")) {
        try {
          const row = JSON.parse(line);
          if (row.evt === "listen") {
            clearTimeout(timer);
            return done(row);
          }
        } catch {
          // partial line, or a line that is not JSON: keep reading
        }
      }
    });
    child.once("error", (e) => {
      clearTimeout(timer);
      fail(e);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      fail(new Error(`the server exited (${code}) before it listened; saw: ${buf}`));
    });
  });
}

test("the API binds loopback only — the LAN cannot reach the approval gate", async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [ENTRY], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const listening = await firstListenLine(child);
    assert.equal(listening.service, "toolcrib");
    assert.equal(listening.port, port);
    // Read off the socket, not off the constant: with the host argument dropped
    // this is "0.0.0.0" and the run goes red here, network or no network.
    assert.equal(
      listening.host,
      "127.0.0.1",
      `the server bound ${listening.host}; an unauthenticated approval gate may only be on loopback`,
    );

    // the console's own address must still work — a control that refuses
    // everything is not a control, it is an outage
    assert.equal(await canConnect("127.0.0.1", port), true, "loopback could not reach the API");

    // and the property itself, on whatever real addresses this machine has
    const lan = Object.values(networkInterfaces())
      .flat()
      .filter((n) => n && n.family === "IPv4" && !n.internal)
      .map((n) => n.address);
    for (const addr of lan)
      assert.equal(
        await canConnect(addr, port),
        false,
        "the API answered on a non-loopback address — that address is the LAN",
      );
    // With no non-loopback IPv4 at all (an offline machine), the loop is empty
    // and assertion (1) above is the whole proof. It is enough on its own.
  } finally {
    child.kill();
  }
});

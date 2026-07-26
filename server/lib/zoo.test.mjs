// zoo client tests — offline. `fetch` is stubbed for every case here; nothing
// in this file opens a socket or spends a credit.
//
// The counter is the only thing under test, and it is load-bearing: it is the
// sole honest source for the API-call total a sealed package states. Before
// FN-031 that total was `apiRuns.length` — fixture files on replay, generations
// on live — and a single generation issuing a dispatch, a poll every pollS and
// an outputs fetch was sealed as "1 call".

import { test } from "node:test";
import assert from "node:assert";
import { zooClient } from "./zoo.mjs";

// Explicit token: never touches loadToken(), so no .env and no real credential.
const client = () => zooClient("test-token-not-a-credential");

const withFetch = async (impl, fn) => {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = real; }
};

const ok = (body = {}) => ({ ok: true, status: 200, json: async () => body, text: async () => "" });

test("httpRequests counts every request the client issues", async () => {
  await withFetch(async () => ok({ status: "completed" }), async () => {
    const zoo = client();
    assert.strictEqual(zoo.httpRequests, 0, "a fresh client has issued nothing");

    await zoo.getTextToCad("id-1");
    assert.strictEqual(zoo.httpRequests, 1);

    await zoo.getAsyncOp("id-1");
    await zoo.startTextToCad("a plate", "stl");
    assert.strictEqual(zoo.httpRequests, 3);

    // massG posts raw bytes and cannot route through api() — count it anyway,
    // or a mass cross-check would be a free call in the ledger and a billed
    // one on the invoice.
    await withFetch(async () => ok({ mass: 13.0786 }), () => zoo.massG(Buffer.from("solid\n")));
    assert.strictEqual(zoo.httpRequests, 4);
  });
});

test("a request that fails still counts — it was issued, and issued is billed", async () => {
  await withFetch(async () => ({ ok: false, status: 404, text: async () => "not found" }), async () => {
    const zoo = client();
    await assert.rejects(() => zoo.getTextToCad("missing"), /404/);
    assert.strictEqual(zoo.httpRequests, 1);
  });

  await withFetch(async () => { throw new Error("ECONNRESET"); }, async () => {
    const zoo = client();
    await assert.rejects(() => zoo.getAsyncOp("boom"), /ECONNRESET/);
    assert.strictEqual(zoo.httpRequests, 1, "a request that threw was still dispatched");
  });
});

test("poll loops and 404 retries are counted individually, not as one operation", async () => {
  // fetchOutputs retries a 404 up to `tries` times; each retry is a request.
  await withFetch(async () => ({ ok: false, status: 404, text: async () => "nope" }), async () => {
    const zoo = client();
    const outputs = await zoo.fetchOutputs("id-x", { tries: 3, delayS: 0 });
    assert.strictEqual(outputs, null); // FN-011: outputs can be permanently unreachable
    assert.strictEqual(zoo.httpRequests, 3, "three attempts must read as three requests");
  });

  // waitTextToCad polls until terminal; two polls is two requests, not one call.
  let n = 0;
  await withFetch(async () => ok(++n < 2 ? { status: "in_progress" } : { status: "completed" }), async () => {
    const zoo = client();
    const r = await zoo.waitTextToCad("id-y", { pollS: 0 });
    assert.strictEqual(r.status, "completed");
    assert.strictEqual(zoo.httpRequests, 2);
  });
});

test("the counter is per client — two clients never share a tally", async () => {
  await withFetch(async () => ok(), async () => {
    const a = client();
    const b = client();
    await a.getTextToCad("id-1");
    await a.getTextToCad("id-2");
    assert.strictEqual(a.httpRequests, 2);
    assert.strictEqual(b.httpRequests, 0);
  });
});

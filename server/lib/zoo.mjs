// Shared Zoo API client — zero dependencies. For the Node floor see the README's
// "Node versions" section; we don't restate a version here that we haven't executed.
// The only module that touches the token. Everything speaks raw REST.

import { readFileSync, existsSync } from "node:fs";

const BASE = "https://api.zoo.dev";

export function loadToken() {
  if (process.env.ZOO_API_TOKEN) return process.env.ZOO_API_TOKEN;
  if (existsSync(".env")) {
    const m = readFileSync(".env", "utf8").match(/^ZOO_API_TOKEN=(.+)$/m);
    if (m) return m[1].trim();
  }
  throw new Error("No ZOO_API_TOKEN in env or .env — see .env.example");
}

export function zooClient(token = loadToken()) {
  const HDRS = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // Every request this client issues, counted where they all pass through.
  // A packaged run reports its API-call count from this counter and nowhere
  // else: a count inferred from an array length is a guess wearing a number's
  // clothes, and that is exactly the defect FN-031 records — `apiRuns.length`
  // shipped as `totalCalls` while a single generation issued a POST, a dozen
  // polls and an outputs fetch. Counted BEFORE the await on purpose: a request
  // that 404s or throws was still issued, and still billed for.
  let httpRequests = 0;

  async function api(path, opts = {}) {
    httpRequests += 1;
    const res = await fetch(BASE + path, { headers: HDRS, ...opts });
    if (!res.ok) throw new Error(`${opts.method ?? "GET"} ${path} → ${res.status}: ${await res.text()}`);
    return res.json();
  }

  return {
    api,

    /**
     * HTTP requests this client has issued since it was constructed —
     * poll iterations, 404 retries and failed requests all included.
     * Read it as a delta across an operation to get that operation's count.
     */
    get httpRequests() { return httpRequests; },

    /** Remaining stable credits in USD. */
    async balanceUsd() {
      const b = await api("/user/payment/balance");
      return b.stable_api_credits_remaining_monetary_value;
    },

    /** Fire a text-to-cad generation; returns the queued job record. */
    startTextToCad(prompt, format = "step") {
      return api(`/ai/text-to-cad/${format}?kcl=true`, {
        method: "POST",
        body: JSON.stringify({ prompt }),
      });
    },

    /** Async-operation record — the ONLY surface that carries `outputs` (FN-007). */
    getAsyncOp(id) {
      return api(`/async/operations/${id}`);
    },

    /** Text-to-cad record on the user surface: reliable status + code, never outputs. */
    getTextToCad(id) {
      return api(`/user/text-to-cad/${id}`);
    },

    /**
     * Fetch a completed job's output files from the async surface, tolerating 404s.
     * Returns the outputs object or null if unreachable (FN-011: burst-dispatched
     * jobs can complete with their outputs permanently missing from this surface).
     */
    async fetchOutputs(id, { tries = 6, delayS = 5 } = {}) {
      for (let i = 0; i < tries; i++) {
        try {
          const r = await this.getAsyncOp(id);
          if (r.outputs) return r.outputs;
        } catch (e) {
          if (!String(e.message).includes("404")) throw e;
        }
        await new Promise((r) => setTimeout(r, delayS * 1000));
      }
      return null;
    },

    /**
     * Poll a text-to-cad job to a terminal state.
     * Resolves { status, record, latencyS }; status ∈ completed|failed|timeout.
     * Polls the USER surface (/user/text-to-cad/{id}) — under burst dispatch the
     * async-operations surface 404s, sometimes permanently (FN-011). Outputs are
     * fetched separately via fetchOutputs().
     */
    async waitTextToCad(id, { timeoutMin = 20, pollS = 6 } = {}) {
      const t0 = Date.now();
      for (;;) {
        const latencyS = (Date.now() - t0) / 1000;
        let r = null;
        try {
          r = await this.getTextToCad(id);
        } catch (e) {
          // brief 404 grace right after dispatch, in case this surface lags too
          if (!String(e.message).includes("404") || latencyS > 120) throw e;
        }
        if (r && (r.status === "completed" || r.status === "failed"))
          return { status: r.status, record: r, latencyS };
        if (latencyS > timeoutMin * 60) return { status: "timeout", record: r, latencyS };
        await new Promise((res) => setTimeout(res, pollS * 1000));
      }
    },

    /** Decode an outputs entry (unpadded base64 — Node's decoder is lenient, FN-007). */
    decodeOutput(b64) {
      return Buffer.from(b64, "base64");
    },

    /** Mass of a CAD file in grams via the Engine's REST surface (FN-008). */
    async massG(bytes, { densityKgM3 = 2700, srcFormat = "step" } = {}) {
      httpRequests += 1; // posts raw bytes, so it cannot go through api() — count it here
      const res = await fetch(
        `${BASE}/file/mass?material_density=${densityKgM3}&material_density_unit=kg:m3&src_format=${srcFormat}&output_unit=g`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: bytes },
      );
      if (!res.ok) throw new Error(`/file/mass → ${res.status}: ${await res.text()}`);
      return (await res.json()).mass;
    },
  };
}

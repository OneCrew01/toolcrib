// Shared Zoo API client — zero dependencies, Node 18+.
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

  async function api(path, opts = {}) {
    const res = await fetch(BASE + path, { headers: HDRS, ...opts });
    if (!res.ok) throw new Error(`${opts.method ?? "GET"} ${path} → ${res.status}: ${await res.text()}`);
    return res.json();
  }

  return {
    api,

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

    /**
     * Poll a text-to-cad job to a terminal state.
     * Resolves { status, record, latencyS }; status ∈ completed|failed|timeout.
     */
    async waitTextToCad(id, { timeoutMin = 20, pollS = 6 } = {}) {
      const t0 = Date.now();
      for (;;) {
        const r = await this.getAsyncOp(id);
        const latencyS = (Date.now() - t0) / 1000;
        if (r.status === "completed" || r.status === "failed")
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
      const res = await fetch(
        `${BASE}/file/mass?material_density=${densityKgM3}&material_density_unit=kg:m3&src_format=${srcFormat}&output_unit=g`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: bytes },
      );
      if (!res.ok) throw new Error(`/file/mass → ${res.status}: ${await res.text()}`);
      return (await res.json()).mass;
    },
  };
}

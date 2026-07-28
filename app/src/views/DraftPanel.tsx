// Draft with Zookeeper — operator mode.
//
// Natural-language drafting chat over Zoo's copilot websocket
// (wss://api.zoo.dev/ws/ml/copilot) that feeds the New Job form.
//
// Token boundary (a hard rule): the token is entered at runtime, held in
// component/client memory ONLY — never localStorage/sessionStorage, never
// logged, never sent anywhere except Zoo's wss endpoint. The backend is never
// in the TOKEN's path. Say it that way, not "the backend has zero involvement"
// — App.tsx polls /health every 5 s on this view too (usePoll has no view
// gate), so the page does talk to the backend while this panel is open. The
// narrow claim is the one the code guarantees and the one the on-screen strings
// below make. Disconnecting (or leaving this view) wipes the token.

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  activeTurn,
  ZookeeperClient,
  type ClientSnapshot,
  type TurnRecord,
} from "../lib/zookeeper.ts";
import { CopyButton, ErrorBanner, PulseDot } from "../components.tsx";

/** Compose the New Job prompt: the operator's final prompt text plus, when
 * present, the end_of_stream whole_response as a design-notes suffix. */
export function composeDesignIntent(turn: TurnRecord): string {
  const notes = turn.wholeResponse?.trim();
  if (!notes) return turn.prompt;
  return `${turn.prompt}\n\n--- design notes (Zookeeper draft) ---\n${notes}`;
}

export function DraftPanelView({
  onUseIntent,
}: {
  onUseIntent: (promptText: string) => void;
}) {
  const [snap, setSnap] = useState<ClientSnapshot | null>(null);
  const [token, setToken] = useState("");
  const [prompt, setPrompt] = useState("");
  const clientRef = useRef<ZookeeperClient | null>(null);

  // Leaving the view is a disconnect: wipes the token, says bye, closes.
  useEffect(
    () => () => {
      clientRef.current?.disconnect();
      clientRef.current = null;
    },
    [],
  );

  const connected =
    snap !== null &&
    (snap.phase === "connecting" || snap.phase === "handshake" || snap.phase === "ready");

  const connect = (e: FormEvent) => {
    e.preventDefault();
    const t = token.trim();
    if (t === "" || connected) return;
    clientRef.current?.disconnect();
    // Instance guard: each client only publishes state while it is still the
    // current one. Without this, a superseded client's ASYNC onClose (the
    // socket close event lands after disconnect() returns) could clobber a
    // new client's live snapshot on a quick disconnect → reconnect. The guard
    // also covers the disconnect() path: its synchronous "closed" emit fires
    // while clientRef.current === client, then the ref is nulled/replaced and
    // the trailing close-event emit is dropped.
    const client: ZookeeperClient = new ZookeeperClient({
      token: t,
      onChange: (s) => {
        if (clientRef.current === client) setSnap(s);
      },
    });
    clientRef.current = client;
    // Memory-only rule: the field is cleared the moment the client takes
    // the token; the client wipes its own copy once the auth frame is sent.
    setToken("");
    client.connect();
  };

  const disconnect = () => {
    clientRef.current?.disconnect();
    clientRef.current = null;
  };

  const send = (e: FormEvent) => {
    e.preventDefault();
    const client = clientRef.current;
    if (client && client.sendPrompt(prompt)) setPrompt("");
  };

  const agg = snap?.aggregate ?? null;
  const streaming = agg !== null && activeTurn(agg) !== null;
  const ready = snap?.phase === "ready";

  return (
    <section className="draft-layout">
      <div className="section-head">
        <h2>
          Draft with Zookeeper{" "}
          <span className="chip chip-gate">operator mode</span>
        </h2>
        {connected && streaming && <PulseDot label="drafting…" />}
      </div>

      <div className="draft-notice">
        <strong>Your token connects your browser directly to Zoo. This is the only
        screen in the console that touches a credential.</strong>{" "}
        The token lives in this tab's memory only — never stored, never logged,
        never proxied through the ToolCRIB backend. Disconnecting (or leaving
        this view) wipes it.
      </div>

      {snap?.phase === "failed" && snap.note && <ErrorBanner message={snap.note} />}

      {!connected && (
        <div className="panel">
          <div className="panel-head">
            <h3>What this is</h3>
          </div>
          <div className="draft-explain">
            <p>
              A natural-language drafting chat with <strong>Zookeeper</strong>,
              Zoo's ML copilot. Describe the part in prose; the copilot reasons,
              drafts KCL, and streams its reply. When a draft looks right, push
              it into the <strong>New job</strong> form as design intent — the
              reviewed pipeline (gates, ledger, human sign-off) stays exactly the
              same.
            </p>
            <p>
              <span className="draft-explain-k">Security property</span> — this
              panel opens a websocket from <em>your browser</em> to{" "}
              <span className="mono">wss://api.zoo.dev/ws/ml/copilot</span>. The
              token is sent once, inside that connection's auth frame, and
              nowhere else — never into localStorage, never a cookie, never a
              log line, never the ToolCRIB backend.
            </p>
            <p>
              <span className="draft-explain-k">Where to get a token</span> —
              sign in at{" "}
              <a
                href="https://zoo.dev/account/api-tokens"
                target="_blank"
                rel="noreferrer"
                className="dl-link"
              >
                zoo.dev → Account → API tokens
              </a>{" "}
              and generate one. Zookeeper turns are billed to your Zoo account
              (one API call per turn — the id is shown here while you draft).
            </p>
            <form className="draft-token-form" onSubmit={connect} autoComplete="off">
              <label className="field">
                <span className="field-label">Zoo API token (memory only)</span>
                <input
                  type="password"
                  className="mono"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="paste token — held in memory, wiped on disconnect"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={token.trim() === ""}
              >
                Connect
              </button>
            </form>
            {snap?.phase === "closed" && (
              <p className="muted draft-wiped-note">
                disconnected — token wiped from memory
              </p>
            )}
          </div>
        </div>
      )}

      {connected && snap && agg && (
        <>
          <div className="draft-status-strip">
            <span className={`health ${ready ? "health-up" : "health-down"}`}>
              <span className="health-dot" aria-hidden="true" />
              {snap.phase === "connecting" && "connecting — auth sent, awaiting first frame"}
              {snap.phase === "handshake" && "handshake — awaiting conversation_id"}
              {snap.phase === "ready" && "connected"}
            </span>
            <span className="muted">
              mode{" "}
              <span className="mono">{agg.defaultMode ?? "—"}</span>
            </span>
            <span
              className="muted"
              title="One Zoo API call per turn (FN-028) — this id is the metering handle for the current turn, not a cost figure. Of the frame keys this client classifies, none carries minutes or price; four key families are unaudited, not cleared (FN-031)"
            >
              api_call_id{" "}
              <span className="mono">{agg.apiCallId ?? "—"}</span>
            </span>
            {agg.lastError !== null && (
              <span className="draft-strip-error">
                last server error: {agg.lastError}
              </span>
            )}
            <button type="button" className="btn btn-small" onClick={disconnect}>
              disconnect &amp; wipe token
            </button>
          </div>

          <div className="draft-chat panel">
            {agg.turns.length === 0 && (
              <p className="muted draft-empty">
                {ready
                  ? "connected — describe the part you want to draft"
                  : "completing handshake…"}
              </p>
            )}
            {agg.turns.map((turn, i) => (
              <TurnBlock key={i} turn={turn} onUse={() => onUseIntent(composeDesignIntent(turn))} />
            ))}
          </div>

          <form className="draft-composer" onSubmit={send}>
            <textarea
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A flush-mount panel, 120 × 80 × 3 mm, 40 × 30 opening with a 45° chamfer…"
              disabled={!ready || streaming}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!ready || streaming || prompt.trim() === ""}
            >
              {streaming ? "drafting…" : "Send"}
            </button>
          </form>
        </>
      )}
    </section>
  );
}

function TurnBlock({ turn, onUse }: { turn: TurnRecord; onUse: () => void }) {
  return (
    <div className="draft-turn">
      <div className="draft-turn-prompt">
        <span className="actor actor-human">[HUMAN:operator]</span>{" "}
        <span className="draft-turn-prompt-text">{turn.prompt}</span>
      </div>

      {turn.reasoning.length > 0 && (
        <details className="draft-reasoning">
          <summary className="muted">
            reasoning · {turn.reasoning.length}{" "}
            {turn.reasoning.length === 1 ? "line" : "lines"}
          </summary>
          <div className="draft-reasoning-body">
            {turn.reasoning.map((r, i) => (
              <div key={i} className="draft-reasoning-line mono">
                <span className="draft-reasoning-type">[{r.type}]</span> {r.content}
              </div>
            ))}
          </div>
        </details>
      )}

      {turn.infos.map((text, i) => (
        <div key={i} className="draft-info muted">
          {text}
        </div>
      ))}

      {turn.reply !== "" && <div className="draft-reply">{turn.reply}</div>}

      {turn.kcl !== null && (
        <div className="draft-kcl">
          <div className="draft-kcl-head">
            <h3>KCL</h3>
            <CopyButton text={turn.kcl} label="copy KCL" />
          </div>
          <pre className="draft-kcl-pre">{turn.kcl}</pre>
        </div>
      )}

      {turn.status === "error" && turn.errorDetail !== null && (
        <div className="banner banner-error draft-turn-error">
          turn terminated by server error — {turn.errorDetail}
        </div>
      )}

      {turn.status === "done" && (
        <div className="draft-turn-actions">
          <button type="button" className="btn btn-primary" onClick={onUse}>
            Use as design intent →
          </button>
          {turn.wholeResponse !== null && (
            <span className="muted draft-turn-actions-note">
              carries the final response as design notes
            </span>
          )}
        </div>
      )}
    </div>
  );
}

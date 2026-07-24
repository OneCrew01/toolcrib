import { useState } from "react";
import type { ActorKind } from "./lib/api.ts";
import { gateLabel, gateTone, stateTone } from "./lib/format.ts";

/** State chip, colored by the actor class of the state. */
export function StateChip({ state }: { state: string }) {
  return <span className={`chip chip-${stateTone(state)}`}>{state}</span>;
}

/** Ledger actor badge: [SYS:pipeline] gray, [HUMAN:name] green. */
export function ActorBadge({ actor }: { actor: { kind: ActorKind; id: string } }) {
  const cls = actor.kind === "HUMAN" ? "actor actor-human" : "actor actor-sys";
  return (
    <span className={cls}>
      [{actor.kind}:{actor.id}]
    </span>
  );
}

export function GatePill({ result }: { result: string }) {
  return <span className={`pill pill-${gateTone(result)}`}>{gateLabel(result)}</span>;
}

/** Quiet pulse dot — the only motion allowed for polling. */
export function PulseDot({ label }: { label: string }) {
  return (
    <span className="pulse-wrap" title={label}>
      <span className="pulse-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function CopyButton({ text, label = "copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (non-secure context) — leave the button as-is
    }
  };
  return (
    <button type="button" className="btn btn-small" onClick={() => void copy()}>
      {copied ? "copied ✓" : label}
    </button>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return <div className="banner banner-error">{message}</div>;
}

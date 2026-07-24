// Pure display formatters — no fetch, no DOM, no React. Kept separate from the
// client so behavior is plain functions the type-checker can pin down.

import { FAILURE_STATES, GATE_STATE, PIPELINE_STATES } from "./api.ts";

const pad = (n: number): string => String(n).padStart(2, "0");

/** ISO timestamp → local "YYYY-MM-DD HH:MM:SS"; echoes input if unparseable. */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** Compact age string for tables: "8s", "3m", "2h", "5d" ago. */
export function timeAgo(iso: string, nowMs: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const s = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Byte count → human string with one decimal above 1 KB. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

/** Leading slice of a hash for dense tables. */
export function shortHash(hash: string, chars = 10): string {
  if (typeof hash !== "string" || hash.length === 0) return "—";
  return hash.length <= chars ? hash : hash.slice(0, chars);
}

export function isFailureState(state: string): boolean {
  return (FAILURE_STATES as readonly string[]).includes(state);
}

export type ChipTone = "sys" | "gate" | "good" | "fail";

/**
 * Chip color follows the actor class of the state: SYS pipeline states blue,
 * the human gate (and revision loop) amber, approved/delivered green,
 * failures red. Unknown states fall back to the SYS tone.
 */
export function stateTone(state: string): ChipTone {
  if (state === "APPROVED" || state === "DELIVERED") return "good";
  if (state === GATE_STATE || state === "REVISION_REQUESTED") return "gate";
  if (isFailureState(state)) return "fail";
  if ((PIPELINE_STATES as readonly string[]).includes(state)) return "sys";
  return "sys";
}

export type GateTone = "pass" | "fail" | "skip";

/** Gate result → PASS | FAIL | SKIPPED (drops any ":detail" suffix). */
export function gateLabel(result: string): string {
  const head = String(result).split(":")[0].toUpperCase();
  if (head === "PASS" || head === "FAIL") return head;
  if (head === "SKIP" || head === "SKIPPED") return "SKIPPED";
  return head || "—";
}

export function gateTone(result: string): GateTone {
  const label = gateLabel(result);
  if (label === "PASS") return "pass";
  if (label === "FAIL") return "fail";
  return "skip";
}

/** DRAFT-watermark warnings get an amber badge; everything else plain text. */
export function isDraftWarning(warning: string): boolean {
  return warning.startsWith("DRAFT");
}

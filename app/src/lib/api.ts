// Typed client for the ToolCRIB backend HTTP API.
//
// All paths are relative (/api/..., /health): the vite dev server proxies them
// to the backend (vite.config.ts). This app holds no API keys — the backend is
// the only Zoo client.

export type Backend = "replay" | "flushmount" | "live";

export type ActorKind = "SYS" | "HUMAN";

// Zoo UnitLength vocabulary (mirrors server/state/request.mjs).
export const UNITS = ["cm", "ft", "in", "m", "mm", "yd"] as const;
export type Units = (typeof UNITS)[number];

// State names mirror server/state/states.mjs — the single source of truth.
export const PIPELINE_STATES = [
  "DRAFT",
  "VALIDATING",
  "GENERATING",
  "GEOMETRY_CHECK",
  "PACKAGING",
  "PDF_GENERATION",
] as const;

export const FAILURE_STATES = [
  "INPUT_ERROR",
  "CAPABILITY_MISSING",
  "GENERATION_FAILED",
  "OUTPUTS_UNREACHABLE",
  "GEOMETRY_INVALID",
  "EXPORT_FAILED",
  "PDF_FAILED",
] as const;

export const GATE_STATE = "WAITING_FOR_HUMAN_REVIEW";

export interface GenerationRequest {
  title: string;
  /** Exactly one of prompt / structuredIntent. */
  prompt?: string;
  structuredIntent?: Record<string, unknown>;
  material: { name: string; densityKgM3: number };
  units: Units;
  requester: string;
  expectedMassG?: { minG: number; maxG: number };
}

export interface JobSummary {
  jobId: string;
  title: string;
  state: string;
  rev: number;
  createdAt: string;
  updatedAt: string;
  backend: Backend;
}

export interface LedgerRow {
  ts: string;
  rev: number;
  from: string;
  to: string;
  actor: { kind: ActorKind; id: string };
  reason: string;
  rowHash: string;
}

export interface GateResult {
  gate: string;
  result: string;
  threshold?: string;
  measured?: string;
  notes?: string;
}

export interface ManifestFile {
  path: string;
  format: string;
  revision: number;
  createdAt: string;
  status: string;
  bytes: number;
  sha256: string;
}

export interface Manifest {
  jobId: string;
  projectId: string;
  revision: number;
  workflowId: string;
  packageStatus: string;
  completedAt: string;
  packageHash: string;
  files: ManifestFile[];
  validation?: GateResult[];
  warnings?: string[];
}

export interface JobDetail {
  job: {
    jobId: string;
    title: string;
    state: string;
    rev: number;
    request: GenerationRequest;
    backend: Backend;
    createdAt: string;
    updatedAt: string;
  };
  ledger: LedgerRow[];
  ledgerVerified: boolean;
  gates: GateResult[] | null;
  manifest: Manifest | null;
  warnings: string[] | null;
}

export interface Health {
  ok: boolean;
  service: string;
  ts: string;
}

export type DecisionAction = "approve" | "revise";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body: unknown = await res.json();
      if (body && typeof body === "object") {
        const b = body as { error?: unknown; errors?: unknown };
        if (typeof b.error === "string") message = b.error;
        else if (Array.isArray(b.errors)) message = b.errors.join("; ");
      }
    } catch {
      // non-JSON error body — keep the status line
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export const api = {
  health(): Promise<Health> {
    return request<Health>("/health");
  },

  listJobs(): Promise<{ jobs: JobSummary[] }> {
    return request<{ jobs: JobSummary[] }>("/api/jobs");
  },

  createJob(req: GenerationRequest, backend: Backend): Promise<{ jobId: string }> {
    return request<{ jobId: string }>("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: req, backend }),
    });
  },

  getJob(jobId: string): Promise<JobDetail> {
    return request<JobDetail>(`/api/jobs/${encodeURIComponent(jobId)}`);
  },

  decide(
    jobId: string,
    action: DecisionAction,
    actorName: string,
    reason?: string,
  ): Promise<unknown> {
    return request<unknown>(`/api/jobs/${encodeURIComponent(jobId)}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, actorName, ...(reason ? { reason } : {}) }),
    });
  },
};

/** URL for streaming one file out of a job's package bundle. */
export function fileUrl(jobId: string, relPath: string): string {
  const encoded = relPath.split("/").map(encodeURIComponent).join("/");
  return `/api/jobs/${encodeURIComponent(jobId)}/files/${encoded}`;
}

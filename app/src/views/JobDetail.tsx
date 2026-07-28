import { useEffect, useState } from "react";
import {
  api,
  fileUrl,
  GATE_STATE,
  type GateResult,
  type JobDetail,
  type LedgerRow,
  type Manifest,
} from "../lib/api.ts";
import {
  formatBytes,
  formatTimestamp,
  isDraftWarning,
  isFailureState,
  shortHash,
} from "../lib/format.ts";
import {
  ActorBadge,
  CopyButton,
  ErrorBanner,
  GatePill,
  PulseDot,
  StateChip,
} from "../components.tsx";
import { usePoll } from "../lib/usePoll.ts";

const POLL_MS = 2000;
const ACTOR_KEY = "toolcrib.actorName";

export function JobDetailView({
  jobId,
  onBack,
}: {
  jobId: string;
  onBack: () => void;
}) {
  const [refreshTick, setRefreshTick] = useState(0);
  const { data, error } = usePoll(
    () => api.getJob(jobId),
    POLL_MS,
    `${jobId}:${refreshTick}`,
  );
  const refresh = () => setRefreshTick((n) => n + 1);

  return (
    <section className={data?.job.state === GATE_STATE ? "with-review-bar" : ""}>
      <div className="section-head">
        <button type="button" className="btn" onClick={onBack}>
          ← jobs
        </button>
        <PulseDot label="polling 2s" />
      </div>

      {error && <ErrorBanner message={`backend unreachable — ${error}`} />}
      {!data && !error && <p className="muted">loading…</p>}

      {data && (
        <>
          <JobHeader detail={data} />
          {isFailureState(data.job.state) && <FailureBanner detail={data} />}
          <LedgerTimeline ledger={data.ledger} verified={data.ledgerVerified} />
          {data.gates && data.gates.length > 0 && <GateCards gates={data.gates} />}
          {data.manifest && (
            <PackagePanel
              jobId={jobId}
              manifest={data.manifest}
              warnings={data.warnings ?? data.manifest.warnings ?? []}
            />
          )}
          {data.job.state === GATE_STATE && (
            <ReviewBar jobId={jobId} onDecided={refresh} />
          )}
        </>
      )}
    </section>
  );
}

function JobHeader({ detail }: { detail: JobDetail }) {
  const { job } = detail;
  return (
    <header className="job-head">
      <div className="job-head-top">
        <h2>{job.title}</h2>
        <StateChip state={job.state} />
      </div>
      <div className="job-head-meta mono">
        <span>rev {job.rev}</span>
        <span>backend {job.backend}</span>
        <span>{job.jobId}</span>
        <span>updated {formatTimestamp(job.updatedAt)}</span>
      </div>
      <div className="job-head-meta">
        <span>
          requester <strong>{job.request?.requester ?? "—"}</strong>
        </span>
        <span>
          material {job.request?.material?.name ?? "—"} ·{" "}
          <span className="mono">{job.request?.material?.densityKgM3 ?? "—"} kg/m³</span>
        </span>
        <span>
          units <span className="mono">{job.request?.units ?? "—"}</span>
        </span>
      </div>
    </header>
  );
}

function FailureBanner({ detail }: { detail: JobDetail }) {
  const state = detail.job.state;
  // The row that moved the job into the failure state carries the reason.
  const row = [...detail.ledger].reverse().find((r) => r.to === state);
  return (
    <div className="banner banner-failure">
      <div className="banner-failure-state">{state}</div>
      <div>{row?.reason ?? "no reason recorded in ledger"}</div>
    </div>
  );
}

function LedgerTimeline({
  ledger,
  verified,
}: {
  ledger: LedgerRow[];
  verified: boolean;
}) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Transition ledger</h3>
        {verified ? (
          <span className="pill pill-pass">ledger verified ✓ (hash chain intact)</span>
        ) : (
          <span className="pill pill-fail">ledger verification FAILED</span>
        )}
      </div>
      <div className="table-wrap">
      <table className="data-table ledger-table">
        <thead>
          <tr>
            <th>ts</th>
            <th className="num">rev</th>
            <th>transition</th>
            <th>actor</th>
            <th>reason</th>
            <th>rowHash</th>
          </tr>
        </thead>
        <tbody>
          {ledger.map((row, i) => (
            <tr key={`${row.rowHash}-${i}`}>
              <td className="mono nowrap">{formatTimestamp(row.ts)}</td>
              <td className="num mono">{row.rev}</td>
              <td className="mono nowrap">
                {row.from} <span className="arrow">→</span> {row.to}
              </td>
              <td>
                <ActorBadge actor={row.actor} />
              </td>
              <td className="reason">{row.reason}</td>
              <td className="mono">{shortHash(row.rowHash)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function GateCards({ gates }: { gates: GateResult[] }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Validation gates</h3>
      </div>
      <div className="gate-grid">
        {gates.map((g) => (
          <div className="gate-card" key={g.gate}>
            <div className="gate-card-head">
              <span className="gate-name">{g.gate}</span>
              <GatePill result={g.result} />
            </div>
            <div className="gate-card-body">
              <div>
                <span className="gate-k">threshold</span>
                <span className="mono">{g.threshold ?? "—"}</span>
              </div>
              <div>
                <span className="gate-k">measured</span>
                <span className="mono">{g.measured ?? "—"}</span>
              </div>
            </div>
            {g.notes && <div className="gate-notes">{g.notes}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function PackagePanel({
  jobId,
  manifest,
  warnings,
}: {
  jobId: string;
  manifest: Manifest;
  warnings: string[];
}) {
  const previews = manifest.files.filter(
    (f) => f.path.startsWith("previews/") && f.path.endsWith(".png"),
  );
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Package</h3>
        <span className="mono muted">{manifest.packageStatus}</span>
      </div>

      {previews.length > 0 && (
        <div className="preview-row">
          {previews.map((f) => (
            <img
              key={f.path}
              src={fileUrl(jobId, f.path)}
              alt={f.path}
              className="preview-img"
            />
          ))}
        </div>
      )}

      <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>file</th>
            <th className="num">size</th>
            <th>sha256</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {manifest.files.map((f) => (
            <tr key={f.path}>
              <td className="mono">{f.path}</td>
              <td className="num mono nowrap">{formatBytes(f.bytes)}</td>
              <td className="mono">{shortHash(f.sha256, 12)}</td>
              <td>
                <a
                  className="dl-link"
                  href={fileUrl(jobId, f.path)}
                  download
                  target="_blank"
                  rel="noreferrer"
                >
                  download
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <div className="package-hash">
        <span className="gate-k">packageHash</span>
        <span className="mono hash-full">{manifest.packageHash}</span>
        <CopyButton text={manifest.packageHash} />
      </div>

      {warnings.length > 0 && (
        <ul className="warnings">
          {warnings.map((w) => (
            <li key={w}>
              {isDraftWarning(w) ? (
                <>
                  <span className="pill pill-draft">DRAFT</span>{" "}
                  {w.replace(/^DRAFT\s*[—-]?\s*/, "")}
                </>
              ) : (
                w
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReviewBar({ jobId, onDecided }: { jobId: string; onDecided: () => void }) {
  const [actorName, setActorName] = useState(
    () => window.localStorage.getItem(ACTOR_KEY) ?? "",
  );
  const [reason, setReason] = useState("");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Approve arms on first click, fires on the second; disarm after 10s
  // (4s proved too tight for a deliberating human — or a polling reviewer).
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 10000);
    return () => window.clearTimeout(id);
  }, [armed]);

  const persistName = (name: string) => {
    setActorName(name);
    window.localStorage.setItem(ACTOR_KEY, name);
  };

  const decide = async (action: "approve" | "revise") => {
    if (busy) return;
    setError(null);
    if (!actorName.trim()) {
      setError("actor name is required — decisions are made by named humans only");
      return;
    }
    if (action === "revise" && !reason.trim()) {
      setError("a revision request needs a reason");
      return;
    }
    setBusy(true);
    try {
      await api.decide(jobId, action, actorName.trim(), reason.trim() || undefined);
      setArmed(false);
      setReason("");
      onDecided();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="review-bar">
      <div className="review-bar-inner">
        <span className="review-title">HUMAN REVIEW</span>
        <input
          className="review-name"
          value={actorName}
          onChange={(e) => persistName(e.target.value)}
          placeholder="your name (required)"
        />
        <input
          className="review-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="reason (required for revision)"
        />
        {armed ? (
          <button
            type="button"
            className="btn btn-approve armed"
            disabled={busy}
            onClick={() => void decide("approve")}
          >
            confirm approve ✓
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-approve"
            disabled={busy}
            onClick={() => setArmed(true)}
          >
            Approve
          </button>
        )}
        <button
          type="button"
          className="btn btn-revise"
          disabled={busy}
          onClick={() => void decide("revise")}
        >
          Request revision
        </button>
      </div>
      {/* What the button means, beside the button. The same sentence is printed
          above the signature line in the manufacturing PDF and written into
          approvals/approvalRecord.json (server/package/assemble.mjs,
          SIGNATURE_MEANING) — a reviewer should not have to open the PDF to
          learn what their name on this job records. */}
      <div className="review-meaning">
        Approving records that you, by name, accepted this package and passed it to the
        next step. It is not approval of the part.
      </div>
      {error && <div className="review-error">{error}</div>}
    </div>
  );
}

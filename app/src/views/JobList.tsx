import { api, type JobSummary } from "../lib/api.ts";
import { timeAgo } from "../lib/format.ts";
import { usePoll } from "../lib/usePoll.ts";
import { ErrorBanner, PulseDot, StateChip } from "../components.tsx";

const POLL_MS = 2000;

export function JobListView({
  onOpen,
  onNew,
}: {
  onOpen: (jobId: string) => void;
  onNew: () => void;
}) {
  const { data, error } = usePoll(() => api.listJobs(), POLL_MS, "jobs");
  const jobs: JobSummary[] | null = data ? data.jobs : null;

  return (
    <section>
      <div className="section-head">
        <h2>Jobs</h2>
        <div className="section-head-right">
          <PulseDot label="polling 2s" />
          <button type="button" className="btn btn-primary" onClick={onNew}>
            New job
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={`backend unreachable — ${error}`} />}

      {jobs === null && !error && <p className="muted">loading…</p>}

      {jobs !== null && jobs.length === 0 && (
        <p className="muted">No jobs yet. Start one with “New job”.</p>
      )}

      {jobs !== null && jobs.length > 0 && (
        <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>State</th>
              <th className="num">Rev</th>
              <th>Backend</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.jobId} className="row-link" onClick={() => onOpen(j.jobId)}>
                <td>
                  <span className="job-title">{j.title}</span>
                  <span className="mono job-id-inline">{j.jobId.slice(0, 8)}</span>
                </td>
                <td>
                  <StateChip state={j.state} />
                </td>
                <td className="num mono">{j.rev}</td>
                <td className="mono">{j.backend}</td>
                <td className="mono">{timeAgo(j.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </section>
  );
}

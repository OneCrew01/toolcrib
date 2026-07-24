import { useState } from "react";
import { api } from "./lib/api.ts";
import { usePoll } from "./lib/usePoll.ts";
import { JobListView } from "./views/JobList.tsx";
import { NewJobView } from "./views/NewJob.tsx";
import { JobDetailView } from "./views/JobDetail.tsx";

// react-router is not installed on purpose — three screens, one switch.
type View =
  | { name: "list" }
  | { name: "new" }
  | { name: "detail"; jobId: string };

export default function App() {
  const [view, setView] = useState<View>({ name: "list" });
  const health = usePoll(() => api.health(), 5000, "health");
  const backendUp = health.data?.ok === true;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <button
            type="button"
            className="brand"
            onClick={() => setView({ name: "list" })}
          >
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-name">
              Tool<strong>CRIB</strong>
            </span>
            <span className="brand-sub">review console</span>
          </button>
          <span className={`health ${backendUp ? "health-up" : "health-down"}`}>
            <span className="health-dot" aria-hidden="true" />
            {backendUp ? "backend connected" : "backend unreachable"}
          </span>
        </div>
      </header>

      <main className="content">
        {view.name === "list" && (
          <JobListView
            onOpen={(jobId) => setView({ name: "detail", jobId })}
            onNew={() => setView({ name: "new" })}
          />
        )}
        {view.name === "new" && (
          <NewJobView
            onCreated={(jobId) => setView({ name: "detail", jobId })}
            onCancel={() => setView({ name: "list" })}
          />
        )}
        {view.name === "detail" && (
          <JobDetailView
            jobId={view.jobId}
            onBack={() => setView({ name: "list" })}
          />
        )}
      </main>

      <footer className="footbar">
        this app holds no API keys — the backend is the only Zoo client
      </footer>
    </div>
  );
}

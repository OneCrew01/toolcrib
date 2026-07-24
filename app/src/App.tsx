import { useState } from "react";
import { api } from "./lib/api.ts";
import { usePoll } from "./lib/usePoll.ts";
import { JobListView } from "./views/JobList.tsx";
import { NewJobView } from "./views/NewJob.tsx";
import { JobDetailView } from "./views/JobDetail.tsx";
import { DraftPanelView } from "./views/DraftPanel.tsx";

// react-router is not installed on purpose — four screens, one switch.
type View =
  | { name: "list" }
  | { name: "new" }
  | { name: "detail"; jobId: string }
  | { name: "draft" };

export default function App() {
  const [view, setView] = useState<View>({ name: "list" });
  // Handoff from the Zookeeper draft panel into the New Job prompt field.
  const [draftPrompt, setDraftPrompt] = useState<string | null>(null);
  const health = usePoll(() => api.health(), 5000, "health");
  const backendUp = health.data?.ok === true;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="topbar-left">
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
            <nav className="topnav">
              <button
                type="button"
                className={`navlink ${view.name !== "draft" ? "on" : ""}`}
                onClick={() => setView({ name: "list" })}
              >
                jobs
              </button>
              <button
                type="button"
                className={`navlink ${view.name === "draft" ? "on" : ""}`}
                onClick={() => setView({ name: "draft" })}
              >
                draft with Zookeeper
              </button>
            </nav>
          </div>
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
            onNew={() => {
              setDraftPrompt(null);
              setView({ name: "new" });
            }}
          />
        )}
        {view.name === "new" && (
          <NewJobView
            initialPrompt={draftPrompt ?? undefined}
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
        {view.name === "draft" && (
          <DraftPanelView
            onUseIntent={(promptText) => {
              setDraftPrompt(promptText);
              setView({ name: "new" });
            }}
          />
        )}
      </main>

      <footer className="footbar">
        {view.name === "draft"
          ? "operator mode — your Zoo token lives in this tab's memory only and talks straight to Zoo; the backend is never involved"
          : "this app holds no API keys — the backend is the only Zoo client"}
      </footer>
    </div>
  );
}

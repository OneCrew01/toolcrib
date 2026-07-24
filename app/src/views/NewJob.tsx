import { useState, type FormEvent } from "react";
import {
  api,
  UNITS,
  type Backend,
  type GenerationRequest,
  type Units,
} from "../lib/api.ts";
import { ErrorBanner } from "../components.tsx";

const REQUESTER_KEY = "toolcrib.requester";

const INTENT_PLACEHOLDER = `{
  "flushMount": {
    "panel": { "widthMm": 120, "heightMm": 80, "thicknessMm": 3 },
    "opening": { "widthMm": 40, "heightMm": 30 },
    "clearancePerSideMm": 0.2,
    "chamfer": { "angleDeg": 45 },
    "colors": {}
  }
}`;

export function NewJobView({
  onCreated,
  onCancel,
}: {
  onCreated: (jobId: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [intentMode, setIntentMode] = useState<"prompt" | "json">("prompt");
  const [prompt, setPrompt] = useState("");
  const [intentJson, setIntentJson] = useState("");
  const [materialName, setMaterialName] = useState("aluminum 6061");
  const [density, setDensity] = useState("2700");
  const [units, setUnits] = useState<Units>("mm");
  const [requester, setRequester] = useState(
    () => window.localStorage.getItem(REQUESTER_KEY) ?? "",
  );
  const [backend, setBackend] = useState<Backend>("replay");
  const [massMin, setMassMin] = useState("");
  const [massMax, setMassMax] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    const problems: string[] = [];
    if (!title.trim()) problems.push("title is required");
    if (!requester.trim()) problems.push("requester name is required");

    const densityNum = Number(density);
    if (!Number.isFinite(densityNum) || densityNum <= 0)
      problems.push("material density must be a number > 0");

    let structuredIntent: Record<string, unknown> | undefined;
    if (intentMode === "prompt") {
      if (!prompt.trim()) problems.push("prompt is required");
    } else {
      try {
        const parsed: unknown = JSON.parse(intentJson);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          problems.push("structured intent must be a JSON object");
        } else {
          structuredIntent = parsed as Record<string, unknown>;
        }
      } catch {
        problems.push("structured intent is not valid JSON");
      }
    }

    let expectedMassG: { minG: number; maxG: number } | undefined;
    const hasMin = massMin.trim() !== "";
    const hasMax = massMax.trim() !== "";
    if (hasMin !== hasMax) {
      problems.push("expected mass range needs both min and max");
    } else if (hasMin && hasMax) {
      const minG = Number(massMin);
      const maxG = Number(massMax);
      if (!Number.isFinite(minG) || !Number.isFinite(maxG) || minG < 0 || maxG < minG)
        problems.push("expected mass range must be numbers with min ≤ max");
      else expectedMassG = { minG, maxG };
    }

    if (problems.length > 0) {
      setError(problems.join(" · "));
      return;
    }

    const request: GenerationRequest = {
      title: title.trim(),
      ...(intentMode === "prompt"
        ? { prompt: prompt.trim() }
        : { structuredIntent }),
      material: { name: materialName.trim(), densityKgM3: densityNum },
      units,
      requester: requester.trim(),
      ...(expectedMassG ? { expectedMassG } : {}),
    };

    setSubmitting(true);
    try {
      window.localStorage.setItem(REQUESTER_KEY, requester.trim());
      const { jobId } = await api.createJob(request, backend);
      onCreated(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <section>
      <div className="section-head">
        <h2>New job</h2>
        <button type="button" className="btn" onClick={onCancel}>
          ← back to jobs
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      <form className="job-form" onSubmit={(e) => void submit(e)}>
        <label className="field">
          <span className="field-label">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Flush mounting plate, 50 mm square, four corner holes"
          />
        </label>

        <div className="field">
          <span className="field-label">Intent — exactly one of prompt / structured</span>
          <div className="toggle-row" role="tablist">
            <button
              type="button"
              className={`btn btn-toggle ${intentMode === "prompt" ? "on" : ""}`}
              onClick={() => setIntentMode("prompt")}
            >
              prose prompt
            </button>
            <button
              type="button"
              className={`btn btn-toggle ${intentMode === "json" ? "on" : ""}`}
              onClick={() => setIntentMode("json")}
            >
              structured intent (JSON)
            </button>
          </div>
          {intentMode === "prompt" ? (
            <textarea
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A 50mm x 50mm x 2mm aluminum plate with four 5mm diameter holes, one near each corner, each hole center 10mm from both adjacent edges"
            />
          ) : (
            <textarea
              rows={10}
              className="mono"
              value={intentJson}
              onChange={(e) => setIntentJson(e.target.value)}
              placeholder={INTENT_PLACEHOLDER}
              spellCheck={false}
            />
          )}
        </div>

        <div className="field-row">
          <label className="field">
            <span className="field-label">Material name</span>
            <input
              value={materialName}
              onChange={(e) => setMaterialName(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Density (kg/m³)</span>
            <input
              className="mono"
              inputMode="decimal"
              value={density}
              onChange={(e) => setDensity(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Units</span>
            <select value={units} onChange={(e) => setUnits(e.target.value as Units)}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span className="field-label">Requester</span>
            <input
              value={requester}
              onChange={(e) => setRequester(e.target.value)}
              placeholder="shop-floor@example.com"
            />
          </label>
          <label className="field">
            <span className="field-label">Backend</span>
            <select
              value={backend}
              onChange={(e) => setBackend(e.target.value as Backend)}
            >
              <option value="replay">replay — recorded Zoo outputs, zero network</option>
              <option value="flushmount">flushmount — deterministic generator</option>
              <option value="live">live — real Zoo calls</option>
            </select>
            {backend === "live" && (
              <span className="field-note">
                requires TOOLCRIB_ALLOW_LIVE on the backend — refused with 403 otherwise
              </span>
            )}
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span className="field-label">Expected mass min (g, optional)</span>
            <input
              className="mono"
              inputMode="decimal"
              value={massMin}
              onChange={(e) => setMassMin(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Expected mass max (g, optional)</span>
            <input
              className="mono"
              inputMode="decimal"
              value={massMax}
              onChange={(e) => setMassMax(e.target.value)}
            />
          </label>
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? "submitting…" : "Submit job"}
          </button>
        </div>
      </form>
    </section>
  );
}

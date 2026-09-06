import { useEffect, useState } from "react";
import { useStore } from "@/state/store";
import { timeAgo } from "@/core/format";
import OverviewTab from "./OverviewTab";
import MonitoringTab from "./MonitoringTab";
import ScenarioTab from "./ScenarioTab";
import HistoryTab from "./HistoryTab";

export type SccTabId = "overview" | "monitoring" | "scenario" | "history";

const TABS: { id: SccTabId; label: string; hint: string }[] = [
  { id: "overview", label: "◈ Overview", hint: "Risk, drivers, what to do next" },
  { id: "monitoring", label: "◉ Live Monitoring", hint: "Sensor streams on this slope" },
  { id: "scenario", label: "⚗ Scenario Lab", hint: "Test storms and interventions" },
  { id: "history", label: "🕓 History & Validation", hint: "Past events, model vs reality" },
];

export default function SlopeCommandCenter() {
  const [tab, setTab] = useState<SccTabId>("overview");
  const selectedSlopeId = useStore((s) => s.selectedSlopeId);
  const slopes = useStore((s) => s.slopes);
  const assessments = useStore((s) => s.assessments);
  const gameTime = useStore((s) => s.gameTime);
  const selectSlope = useStore((s) => s.selectSlope);
  const flyToSlope = useStore((s) => s.flyToSlope);

  // a newly selected slope always starts on Overview
  useEffect(() => {
    setTab("overview");
  }, [selectedSlopeId]);

  // Esc closes the command center
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") selectSlope(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectSlope]);

  const slope = slopes.find((s) => s.id === selectedSlopeId);
  const assessment = selectedSlopeId ? assessments.get(selectedSlopeId) : undefined;
  if (!slope || !assessment) return null;

  return (
    <div className="scc-overlay">
      <div className="scc-header">
        <button className="btn sm" onClick={() => selectSlope(null)}>← Back to map</button>
        <h2>{slope.id}</h2>
        <span className={`badge ${assessment.category}`}>{assessment.category.replace("-", " ")}</span>
        <span className="badge synth">Synthetic</span>
        <button className="btn sm" onClick={() => flyToSlope(slope.id)} title="Fit this slope into the visible map">Locate slope</button>
        <div className="meta">
          {slope.district}, {slope.region} · {slope.slopeType} · {slope.slopeAngleDeg}° · {slope.heightM} m high · sensors updated {timeAgo(slope.freshness.sensor, gameTime)}
        </div>
        <span className="close-hint"><span className="kbd">Esc</span> closes</span>
      </div>
      <div className="scc-body">
        <div className="scc-nav">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)} title={t.hint}>
              {t.label}
            </button>
          ))}
          <div style={{ marginTop: "auto", padding: "10px 8px", fontSize: 10, color: "var(--text-2)", lineHeight: 1.5 }}>
            SLOPE COMMAND CENTER
            <br />
            All values synthetic · risk model heuristic
          </div>
        </div>
        <div className="scc-content" key={tab}>
          {tab === "overview" && <OverviewTab slope={slope} assessment={assessment} onNavigate={setTab} />}
          {tab === "monitoring" && <MonitoringTab slope={slope} />}
          {tab === "scenario" && <ScenarioTab slope={slope} assessment={assessment} />}
          {tab === "history" && <HistoryTab slope={slope} />}
        </div>
      </div>
    </div>
  );
}

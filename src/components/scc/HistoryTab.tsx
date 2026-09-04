import { useEffect, useMemo, useState } from "react";
import { registry } from "@/core/registry";
import { useStore } from "@/state/store";
import type { Slope, ValidationRecord } from "@/core/types";

const KIND_ICONS: Record<string, string> = {
  inspection: "🔍",
  maintenance: "🛠",
  "uav-survey": "🛩",
  "lidar-survey": "📡",
  "minor-movement": "〰",
  works: "🏗",
  "extreme-rainfall": "⛈",
  "sensor-anomaly": "⚠",
  incident: "⛰",
};

export default function HistoryTab({ slope }: { slope: Slope }) {
  const gameTime = useStore((s) => s.gameTime);
  const [validation, setValidation] = useState<ValidationRecord[]>([]);
  const [timeCursor, setTimeCursor] = useState(1); // 0..1 across history span

  useEffect(() => {
    void registry.validation.getRecords().then((r) => setValidation(r.filter((v) => v.slopeId === slope.id)));
  }, [slope.id]);

  const events = useMemo(() => [...slope.history].sort((a, b) => a.date.localeCompare(b.date)), [slope.history]);
  const span = useMemo(() => {
    if (events.length === 0) return { start: gameTime - 86400_000, end: gameTime };
    return { start: Date.parse(events[0].date), end: gameTime };
  }, [events, gameTime]);
  const cursorTime = span.start + (span.end - span.start) * timeCursor;
  const visibleEvents = events.filter((e) => Date.parse(e.date) <= cursorTime);
  const stateAt = visibleEvents.length ? visibleEvents[visibleEvents.length - 1] : null;

  return (
    <div className="grid2">
      <div className="card">
        <h3>Historical Timeline — scrub through time</h3>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
          <input type="range" min={0} max={1} step={0.01} value={timeCursor} onChange={(e) => setTimeCursor(+e.target.value)} style={{ flex: 1, accentColor: "var(--accent)" }} />
          <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{new Date(cursorTime).toISOString().slice(0, 10)}</span>
        </div>
        {stateAt && (
          <div style={{ fontSize: 11.5, color: "var(--text-1)", marginBottom: 10 }}>
            State at cursor: last recorded event was <b>{stateAt.label}</b> on {stateAt.date.slice(0, 10)}. {visibleEvents.length} of {events.length} events occurred by this date.
          </div>
        )}
        <div className="timeline">
          {visibleEvents
            .slice()
            .reverse()
            .map((e, i) => (
              <div className={`tl-item ${e.kind === "incident" ? "incident" : ""}`} key={i}>
                <div className="tl-date">{e.date.slice(0, 10)}</div>
                <div className="tl-label">
                  {KIND_ICONS[e.kind] ?? "•"} {e.label}
                  {e.detail && <div style={{ fontSize: 10.5, color: "var(--text-2)" }}>{e.detail}</div>}
                </div>
              </div>
            ))}
          <div className="tl-item">
            <div className="tl-date">{new Date(gameTime).toISOString().slice(0, 10)}</div>
            <div className="tl-label">📍 Current state</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Model vs Reality — this slope</h3>
        {validation.length === 0 && (
          <div style={{ color: "var(--text-2)", fontSize: 12 }}>
            No validated historical incident on this slope. City-wide validation is under Reports → Model Validation.
          </div>
        )}
        {validation.map((v) => (
          <div key={v.incidentId} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, marginBottom: 6 }}>
              <b>{v.incidentId}</b> · {v.date.slice(0, 10)} · model {v.modelVersion}
            </div>
            <table className="data">
              <thead>
                <tr><th>Metric</th><th>Predicted</th><th>Observed</th><th>Error</th></tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Failure time (h)", v.predicted.failureTimeH, v.observed.failureTimeH],
                    ["Runout (m)", v.predicted.runoutM, v.observed.runoutM],
                    ["Displacement (mm)", v.predicted.displacementMm, v.observed.displacementMm],
                    ["Affected area (m²)", v.predicted.areaM2, v.observed.areaM2],
                  ] as [string, number, number][]
                ).map(([label, p, o]) => {
                  const err = o !== 0 ? Math.round(((p - o) / o) * 100) : 0;
                  return (
                    <tr key={label}>
                      <td>{label}</td>
                      <td>{p.toLocaleString()}</td>
                      <td>{o.toLocaleString()}</td>
                      <td style={{ color: Math.abs(err) > 25 ? "#ff8577" : "var(--risk-low)" }}>{err > 0 ? "+" : ""}{err}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

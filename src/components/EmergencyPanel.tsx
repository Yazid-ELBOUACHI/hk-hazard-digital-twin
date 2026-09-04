import { useMemo } from "react";
import { useStore } from "@/state/store";
import { allocateResources, RESOURCES } from "@/decision/resources";
import { fmtInt, timeAgo } from "@/core/format";
import { RISK_COLORS } from "@/core/types";

export default function EmergencyPanel() {
  const slopes = useStore((s) => s.slopes);
  const assessments = useStore((s) => s.assessments);
  const incidents = useStore((s) => s.incidents);
  const kpi = useStore((s) => s.kpi);
  const gameTime = useStore((s) => s.gameTime);
  const selectSlope = useStore((s) => s.selectSlope);
  const flyToSlope = useStore((s) => s.flyToSlope);

  const threats = useMemo(
    () =>
      [...slopes]
        .map((s) => ({ s, a: assessments.get(s.id)! }))
        .filter(({ a }) => a && (a.category === "critical" || a.category === "high"))
        .sort((x, y) => y.a.score - x.a.score)
        .slice(0, 12),
    [slopes, assessments]
  );

  const deployments = useMemo(() => allocateResources(slopes, assessments), [slopes, assessments]);
  const deployedIds = new Set(deployments.map((d) => d.resource.id));

  return (
    <div className="side right" style={{ width: 380, background: "#0e0a0a", borderLeft: "1px solid #3a1c1c" }}>
      {kpi && (
        <div className="panel" style={{ borderBottom: "1px solid #3a1c1c" }}>
          <h3 style={{ color: "#c98f8f" }}>Situation</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, textAlign: "center" }}>
            <div className="em-card" style={{ margin: 0, padding: "10px 6px" }}>
              <div className="em-big" style={{ color: "var(--risk-critical)" }}>{kpi.criticalSlopes}</div>
              <div className="stat-label">Critical</div>
            </div>
            <div className="em-card" style={{ margin: 0, padding: "10px 6px" }}>
              <div className="em-big" style={{ color: "var(--risk-high)" }}>{kpi.highRiskSlopes}</div>
              <div className="stat-label">High</div>
            </div>
            <div className="em-card" style={{ margin: 0, padding: "10px 6px" }}>
              <div className="em-big" style={{ color: "var(--risk-elevated)" }}>{fmtInt(kpi.populationExposed)}</div>
              <div className="stat-label">People</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 11.5, color: "#c98f8f" }}>
            <span>🚧 {kpi.roadsExposed} roads at risk</span>
            <span>🏢 {kpi.buildingsExposed} buildings</span>
            <span>⚠ {incidents.length} incidents</span>
          </div>
        </div>
      )}

      <div className="panel" style={{ borderBottom: "1px solid #3a1c1c" }}>
        <h3 style={{ color: "#c98f8f" }}>Active Threats</h3>
        {threats.map(({ s, a }) => (
          <div
            key={s.id}
            className="alert-row"
            style={{ background: "#150d0d" }}
            onClick={() => {
              selectSlope(s.id);
              flyToSlope(s.id);
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 4, background: RISK_COLORS[a.category], flexShrink: 0 }} />
            <div>
              <div style={{ fontFamily: "var(--mono)", fontWeight: 600, fontSize: 11.5 }}>{s.id}</div>
              <div style={{ fontSize: 10.5, color: "#c98f8f" }}>
                {s.district} · ~{fmtInt(s.populationNearby)} people · conf {Math.round(a.confidence * 100)}%
              </div>
            </div>
            <span className="count" style={{ color: RISK_COLORS[a.category] }}>{a.score}</span>
          </div>
        ))}
      </div>

      <div className="panel" style={{ borderBottom: "1px solid #3a1c1c" }}>
        <h3 style={{ color: "#c98f8f" }}>Recommended Deployments</h3>
        {deployments.map((d) => (
          <div key={d.resource.id} className="alert-row" style={{ background: "#150d0d", alignItems: "flex-start" }} onClick={() => flyToSlope(d.slopeId)}>
            <span style={{ fontSize: 13 }}>
              {d.resource.kind === "uav-team" ? "🛩" : d.resource.kind === "lidar-unit" ? "📡" : d.resource.kind === "emergency-vehicle" ? "🚨" : d.resource.kind === "temp-barrier" ? "🚧" : d.resource.kind === "engineer" ? "👷" : "🔍"}
            </span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 11.5 }}>
                {d.resource.label} → <span style={{ fontFamily: "var(--mono)" }}>{d.slopeId}</span>
              </div>
              <div style={{ fontSize: 10.5, color: "#c98f8f" }}>{d.reason} · ETA ~{d.travelMin} min</div>
            </div>
          </div>
        ))}
        <div style={{ fontSize: 10.5, color: "#7c5a5a", marginTop: 6 }}>
          {RESOURCES.filter((r) => !deployedIds.has(r.id)).length} resources held in reserve · mock prioritization (risk, exposure, uncertainty, travel time)
        </div>
      </div>

      <div className="panel">
        <h3 style={{ color: "#c98f8f" }}>Active Incidents</h3>
        {incidents.map((i) => (
          <div key={i.id} className="alert-row" style={{ background: "#150d0d" }} onClick={() => i.slopeId && flyToSlope(i.slopeId)}>
            <span>{i.kind === "flooding" ? "🌊" : "⛰"}</span>
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 600 }}>{i.kind.replace("-", " ")} · severity {i.severity}</div>
              <div style={{ fontSize: 10.5, color: "#c98f8f" }}>{i.slopeId} · {timeAgo(i.startedAt, gameTime)} · {i.status}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Slope Command Center — Overview. Ordered by decision value:
// 1) bottom line + what to do next, 2) why (drivers, trajectory) and the cross-section,
// 3) data freshness and consequences, 4) engineering detail behind a fold.

import { useEffect, useState } from "react";
import { registry } from "@/core/registry";
import { useStore } from "@/state/store";
import { timeAgo, isStale, fmtInt } from "@/core/format";
import { RISK_COLORS, RiskAssessment, SensorReading, Slope, Asset } from "@/core/types";
import SlopeDiagram from "./SlopeDiagram";
import ConsequenceChain from "./ConsequenceChain";
import Collapsible from "../ui/Collapsible";
import type { SccTabId } from "./SlopeCommandCenter";

interface Suggestion {
  icon: string;
  text: JSX.Element;
  action?: { label: string; tab: SccTabId };
}

function suggest(slope: Slope, a: RiskAssessment, gameTime: number): Suggestion[] {
  const out: Suggestion[] = [];
  const esc = a.trajectory.find((t) => t.horizonH > 0 && t.horizonH <= 12 && t.score > a.score + 8 && (t.category === "high" || t.category === "critical"));
  if (esc) {
    out.push({
      icon: "⚠",
      text: <>Risk expected to reach <b>{esc.category}</b> ({esc.score}/100) within <b>{esc.horizonH} h</b>. Test the forecast rainfall on this slope.</>,
      action: { label: "Run scenario", tab: "scenario" },
    });
  }
  if (a.confidence < 0.5) {
    out.push({
      icon: "◔",
      text: <>Model confidence is <b>{Math.round(a.confidence * 100)}%</b> (sensor coverage {Math.round(a.sensorCoverage * 100)}%). Verify before acting: UAV/LiDAR survey or extra sensors.</>,
      action: { label: "Check sensors", tab: "monitoring" },
    });
  }
  const anomalous = slope.sensors.filter((s) => s.anomalous).length;
  if (anomalous > 0) {
    out.push({
      icon: "〰",
      text: <><b>{anomalous} sensor{anomalous > 1 ? "s" : ""} anomalous</b> — inspect the live streams for drift or a real movement signal.</>,
      action: { label: "Live monitoring", tab: "monitoring" },
    });
  }
  if (isStale(slope.freshness.geometry, gameTime, 365)) {
    out.push({
      icon: "📡",
      text: <>Geometry survey is <b>{timeAgo(slope.freshness.geometry, gameTime)}</b>. Schedule a LiDAR/UAV update — runout and volume estimates depend on it.</>,
    });
  }
  if (slope.drainage.type !== "none" && slope.drainage.condition < 0.5) {
    out.push({
      icon: "🚰",
      text: <>Drainage condition <b>{Math.round(slope.drainage.condition * 100)}%</b> — clear before the next rain band; compare “Improve drainage” in the lab.</>,
      action: { label: "Compare", tab: "scenario" },
    });
  }
  const weakMit = slope.mitigations.find((m) => m.condition < 0.5);
  if (weakMit) {
    out.push({
      icon: "🧱",
      text: <><b>{weakMit.type.replace(/-/g, " ")}</b> ({weakMit.installedYear}) in {Math.round(weakMit.condition * 100)}% condition — inspect and consider strengthening.</>,
      action: { label: "Compare", tab: "scenario" },
    });
  }
  if (out.length === 0) {
    out.push({ icon: "✓", text: <>No immediate action indicated. Continue routine monitoring; re-check if rainfall exceeds the forecast.</> });
  }
  return out.slice(0, 3);
}

export default function OverviewTab({ slope, assessment, onNavigate }: { slope: Slope; assessment: RiskAssessment; onNavigate: (t: SccTabId) => void }) {
  const gameTime = useStore((s) => s.gameTime);
  const [latest, setLatest] = useState<SensorReading[]>([]);
  const [nearbyAssets, setNearbyAssets] = useState<Asset[]>([]);

  useEffect(() => {
    void registry.sensors.getLatestAll(slope.id, gameTime).then(setLatest);
  }, [slope.id, Math.floor(gameTime / 600_000)]);

  useEffect(() => {
    void registry.assets.getByIds(slope.nearbyAssetIds).then(setNearbyAssets);
  }, [slope.id]);

  const sat = latest.find((r) => r.kind === "soil-moisture")?.latest.value ?? 50;
  const disp = latest.find((r) => r.kind === "displacement-total")?.latest.value ?? 0;

  const freshRows: { k: string; iso: string; staleDays: number }[] = [
    { k: "Sensor data", iso: slope.freshness.sensor, staleDays: 1 },
    { k: "Rainfall", iso: slope.freshness.rainfall, staleDays: 1 },
    { k: "Geometry (LiDAR/UAV)", iso: slope.freshness.geometry, staleDays: 365 },
    { k: "Inspection", iso: slope.freshness.inspection, staleDays: 365 },
    { k: "Simulation", iso: slope.freshness.simulation, staleDays: 30 },
    { k: "Government record", iso: slope.freshness.record, staleDays: 30 },
  ];
  const staleCount = freshRows.filter((r) => isStale(r.iso, gameTime, r.staleDays)).length;
  const suggestions = suggest(slope, assessment, gameTime);
  const color = RISK_COLORS[assessment.category];

  return (
    <div>
      {/* Row 1: bottom line + next steps | cross-section */}
      <div className="grid2">
        <div className="card">
          <h3>Bottom line</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 10 }}>
            <div>
              <div className="stat-big" style={{ color }}>
                {assessment.score}
                <span style={{ fontSize: 13, color: "var(--text-2)" }}>/100</span>
              </div>
              <span className={`badge ${assessment.category}`}>{assessment.category.replace("-", " ")}</span>
            </div>
            <div className="kv" style={{ flex: 1 }}>
              <span className="k">Trend (3 h)</span>
              <span className={`v trend-${assessment.trend}`}>{assessment.trend === "up" ? "↑ increasing" : assessment.trend === "down" ? "↓ decreasing" : "→ stable"}</span>
              <span className="k">Model confidence</span>
              <span className="v" style={{ color: assessment.confidence < 0.5 ? "#d9a6ff" : undefined }}>{Math.round(assessment.confidence * 100)}%</span>
              <span className="k">People nearby</span>
              <span className="v">~{fmtInt(slope.populationNearby)}</span>
            </div>
          </div>
          <p className="bottom-line">{assessment.explanation}</p>

          <h3 style={{ marginTop: 14 }}>Suggested next steps</h3>
          {suggestions.map((s, i) => (
            <div className="action-row" key={i}>
              <span className="ico">{s.icon}</span>
              <span className="txt">{s.text}</span>
              {s.action && (
                <button className="btn sm" onClick={() => onNavigate(s.action!.tab)}>
                  {s.action.label} →
                </button>
              )}
            </div>
          ))}
          <div className="row-hint">Rule-based suggestions from the synthetic risk model — decision support, not instructions.</div>
        </div>

        <div className="card">
          <h3>
            Slope Cross-Section <span className="hint badge synth">Synthetic</span>
          </h3>
          <div className="anim-canvas-wrap">
            <SlopeDiagram
              slope={slope}
              state={{
                saturation: Math.min(1, sat / 100),
                deformationMm: disp,
                debrisFrac: 0,
                phase: "CURRENT STATE",
                raining: (latest.find((r) => r.kind === "rainfall")?.latest.value ?? 0) > 2,
                failed: false,
              }}
            />
          </div>
          <div className="row-hint">Live saturation and displacement from this slope’s sensors. Animated in the Scenario Lab.</div>
        </div>
      </div>

      {/* Row 2: why | freshness + consequences */}
      <div className="grid2">
        <div className="card">
          <h3>Risk trajectory</h3>
          <div className="traj">
            {assessment.trajectory.map((t) => (
              <div className="step" key={t.horizonH} style={{ borderColor: RISK_COLORS[t.category] + "66" }}>
                <div className="h">{t.horizonH === 0 ? "now" : `+${t.horizonH}h`}</div>
                <div className="s" style={{ color: RISK_COLORS[t.category] }}>{t.score}</div>
                <div className="c" style={{ color: RISK_COLORS[t.category] }}>{t.category === "no-data" ? "—" : t.category}</div>
              </div>
            ))}
          </div>

          <h3 style={{ marginTop: 14 }}>Why is this slope risky?</h3>
          {assessment.drivers
            .filter((d) => d.sharePct > 0)
            .map((d) => (
              <div className="driver-row" key={d.factor}>
                <div className="name">{d.factor}</div>
                <div className="bar"><div style={{ width: `${d.sharePct}%` }} /></div>
                <div className="pct">{d.sharePct}%</div>
              </div>
            ))}
          <Collapsible title="Confidence breakdown" className="flat" summary={`sensors ${Math.round(assessment.sensorCoverage * 100)}% · geometry ${Math.round(assessment.geometryConfidence * 100)}%`}>
            <div className="kv">
              <span className="k">Sensor coverage</span><span className="v">{Math.round(assessment.sensorCoverage * 100)}%</span>
              <span className="k">Geometry confidence</span><span className="v">{Math.round(assessment.geometryConfidence * 100)}%</span>
              <span className="k">Parameter uncertainty</span><span className="v">{Math.round(assessment.parameterUncertainty * 100)}%</span>
              <span className="k">Freshness penalty</span><span className="v">{Math.round(assessment.freshnessPenalty * 100)}%</span>
            </div>
          </Collapsible>
        </div>

        <div className="card">
          <h3>
            Data freshness
            {staleCount > 0 && <span className="hint badge stale">{staleCount} stale</span>}
          </h3>
          {freshRows.map((r) => {
            const stale = isStale(r.iso, gameTime, r.staleDays);
            return (
              <div className="freshness-row" key={r.k}>
                <span className="k">{r.k}</span>
                <span className={`badge ${stale ? "stale" : "fresh"}`}>{timeAgo(r.iso, gameTime)}{stale ? " · stale" : ""}</span>
              </div>
            );
          })}
          <div className="row-hint">Stale inputs lower model confidence and are flagged in the suggested steps above.</div>
        </div>
      </div>

      {/* Row 3: consequence cascade, full width */}
      <div className="card">
        <h3>
          If it fails — consequence cascade
          <span className="hint" style={{ color: "var(--text-2)" }}>{nearbyAssets.length} linked assets</span>
        </h3>
        <ConsequenceChain slope={slope} assessment={assessment} assets={nearbyAssets} />
      </div>

      {/* Row 3: engineering detail, folded */}
      <Collapsible
        title="Engineering attributes, mitigation & sensor snapshot"
        storageKey="scc.engineering"
        summary={`${slope.slopeType} · ${slope.geology.replace(" (synthetic)", "")} · ${slope.mitigations.length} mitigation${slope.mitigations.length === 1 ? "" : "s"} · ${latest.length} sensors online`}
      >
        <div className="grid2" style={{ marginTop: 6 }}>
          <div>
            <h3 className="stat-label" style={{ marginBottom: 8 }}>Engineering attributes</h3>
            <div className="kv">
              <span className="k">Slope type</span><span className="v">{slope.slopeType}</span>
              <span className="k">Geology</span><span className="v" style={{ fontSize: 10 }}>{slope.geology.replace(" (synthetic)", "")}</span>
              <span className="k">Elevation</span><span className="v">{slope.elevationM} mPD</span>
              <span className="k">Height / Angle</span><span className="v">{slope.heightM} m / {slope.slopeAngleDeg}°</span>
              <span className="k">Aspect</span><span className="v">{slope.aspectDeg}°</span>
              <span className="k">Area</span><span className="v">{fmtInt(slope.areaM2)} m²</span>
              <span className="k">Cohesion / φ</span><span className="v">{slope.soil.cohesionKPa} kPa / {slope.soil.frictionAngleDeg}°</span>
              <span className="k">Permeability</span><span className="v">{slope.soil.permeability}</span>
              <span className="k">Vegetation cover</span><span className="v">{Math.round(slope.vegetationCover * 100)}%</span>
              <span className="k">Drainage</span><span className="v">{slope.drainage.type} · {Math.round(slope.drainage.condition * 100)}%</span>
            </div>
          </div>
          <div>
            <h3 className="stat-label" style={{ marginBottom: 8 }}>Mitigation measures</h3>
            {slope.mitigations.length === 0 && <div className="muted" style={{ fontSize: 12 }}>None registered.</div>}
            {slope.mitigations.map((m, i) => (
              <div className="freshness-row" key={i}>
                <span className="k">{m.type.replace(/-/g, " ")} ({m.installedYear})</span>
                <span className={`badge ${m.condition > 0.7 ? "fresh" : "stale"}`}>condition {Math.round(m.condition * 100)}%</span>
              </div>
            ))}
            <h3 className="stat-label" style={{ margin: "14px 0 8px" }}>Live sensor snapshot</h3>
            {latest.length === 0 && <div className="muted" style={{ fontSize: 12 }}>No online sensors on this slope.</div>}
            {latest.map((r) => (
              <div className="freshness-row" key={r.kind}>
                <span className="k">{r.kind.replace(/-/g, " ")}</span>
                <span className="v" style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}>
                  {r.latest.value} {r.latest.unit}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Collapsible>
    </div>
  );
}


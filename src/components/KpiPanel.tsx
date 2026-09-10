// Left-hand indicator panel. Grouped by the question the user is asking
// (how bad is it → who is exposed → what is the weather doing → can I trust the data),
// with the headline numbers large and everything secondary one click away.

import { useStore } from "@/state/store";
import { fmtInt } from "@/core/format";
import type { Trend } from "@/core/types";
import Collapsible from "./ui/Collapsible";
import Term from "./ui/Term";
import type { ReactNode } from "react";

const fmtSmall = (v: number) => (v >= 10 ? fmtInt(v) : v >= 1 ? v.toFixed(1) : v.toFixed(2));

function TrendMark({ t }: { t?: Trend }) {
  if (!t || t === "stable") return <span className="kpi-trend trend-stable">→</span>;
  return <span className={`kpi-trend trend-${t}`}>{t === "up" ? "↑" : "↓"}</span>;
}

function Tile({ label, value, unit, color, trend, sub, wide }: { label: ReactNode; value: string; unit?: string; color: string; trend?: Trend; sub?: string; wide?: boolean }) {
  return (
    <div className={`tile ${wide ? "wide" : ""}`}>
      <div className="tile-l">
        <span className="dot" style={{ background: color }} />
        {label}
      </div>
      <div className="tile-v" style={{ color }}>
        {value}
        {unit && <span className="unit">{unit}</span>}
        <TrendMark t={trend} />
      </div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}

function Row({ label, value, color, trend, title }: { label: ReactNode; value: string; color: string; trend?: Trend; title?: string }) {
  return (
    <div className="kpi-row" title={title}>
      <span className="dot" style={{ background: color }} />
      <span className="l">{label}</span>
      <span className="v">{value}</span>
      <TrendMark t={trend} />
    </div>
  );
}

export default function KpiPanel() {
  const kpi = useStore((s) => s.kpi);
  const weather = useStore((s) => s.weather);
  if (!kpi) return <div className="side" />;
  const live = weather?.live;
  const rain24Real = weather ? !weather.rainfallLast24hMm.isSynthetic : false;

  return (
    <div className="side">
      <div className="panel">
        <h3>Risk picture now</h3>
        <div className="tiles">
          <Tile label="Critical" value={String(kpi.criticalSlopes)} color="var(--risk-critical)" trend={kpi.trends.criticalSlopes} />
          <Tile label="High" value={String(kpi.highRiskSlopes)} color="var(--risk-high)" trend={kpi.trends.highRiskSlopes} />
        </div>
        <div className="kpi-rows">
          <Row label="Elevated" value={String(kpi.elevatedSlopes)} color="var(--risk-elevated)" />
          <Row label="Moderate" value={String(kpi.moderateSlopes)} color="var(--risk-moderate)" trend={kpi.trends.moderateSlopes} />
          <Row label="Requiring monitoring" value={String(kpi.monitoringRequired)} color="var(--accent)" />
          {kpi.expectedLandslides !== undefined && (
            <>
              <Row
                label={<Term id="expected-landslides">Expected landslides</Term>}
                value={fmtSmall(kpi.expectedLandslides)}
                title={kpi.expectedLandslides5 !== undefined ? `This storm, Σ P(H|R) over the inventory · 5–95 %: ${fmtSmall(kpi.expectedLandslides5)}–${fmtSmall(kpi.expectedLandslides95 ?? 0)} · full breakdown in Reports → Storm Report` : undefined}
                color="var(--accent)"
              />
              <Row label={<Term id="pll">Expected fatalities</Term>} value={(kpi.pllEvent ?? 0) >= 0.1 ? (kpi.pllEvent ?? 0).toFixed(1) : (kpi.pllEvent ?? 0).toExponential(1)} color="var(--risk-high)" title="This storm, Σ PLL over the inventory — see Reports → Storm Report" />
            </>
          )}
        </div>
      </div>

      <div className="panel">
        <h3>Exposure</h3>
        <div className="tiles">
          <Tile label={<Term id="people-at-risk" />} value={fmtInt(kpi.populationExposed)} color="var(--risk-high)" trend={kpi.trends.populationExposed} wide />
        </div>
        <div className="kpi-rows">
          <Row label="Active incidents" value={String(kpi.activeIncidents)} color="var(--risk-high)" />
          <Row label="Roads exposed" value={String(kpi.roadsExposed)} color="var(--risk-elevated)" />
          <Row label="Buildings exposed" value={String(kpi.buildingsExposed)} color="var(--risk-elevated)" />
        </div>
      </div>

      <div className="panel">
        <h3>
          Rainfall
          {live ? (
            <span className="hint badge real" title={`HKO Open Data · ${live.stations} stations · observation ${live.obsTime.slice(11, 16)} HKT`}>
              live · HKO
            </span>
          ) : (
            <span className="hint badge synth">synthetic</span>
          )}
        </h3>
        <div className="tiles" style={{ marginBottom: 0 }}>
          <Tile
            label="Last 24 h"
            value={String(kpi.rainfall24hMm)}
            unit="mm"
            color="var(--accent)"
            trend={kpi.trends.rainfall24hMm}
            sub={rain24Real ? `HKO · ${live?.hours24 ?? 0}/24 h accumulated` : live ? "24-h total not yet available" : "synthetic baseline"}
          />
          <Tile label="Next 24 h" value={String(kpi.forecastRainfallMm)} unit="mm" color="var(--accent)" sub="synthetic forecast" />
        </div>
        {kpi.nowcast2hMm !== undefined && (
          <div className="kpi-rows" style={{ marginTop: 6 }}>
            <Row label={<Term id="nowcast">Next 2 h · HKO nowcast</Term>} value={`${kpi.nowcast2hMm} mm`} color="var(--accent)" title={`HKO gridded rainfall nowcast, territory mean over the twin's stations${weather?.nowcast ? ` · issued ${weather.nowcast.updated.slice(11, 16)} HKT` : ""} · real data`} />
          </div>
        )}
      </div>

      <div className="panel" style={{ paddingTop: 8 }}>
        <Collapsible
          title="Data health"
          storageKey="kpi.datahealth"
          className="flat"
          summary={`${kpi.insufficientData} no data · ${kpi.sensorsOffline} sensors offline`}
        >
          <div className="kpi-rows">
            <Row label="Insufficient data (grey)" value={String(kpi.insufficientData)} color="var(--risk-nodata)" />
            <Row label="Sensors anomalous" value={String(kpi.sensorsAnomalous)} color="var(--risk-moderate)" />
            <Row label="Sensors offline" value={String(kpi.sensorsOffline)} color="var(--risk-nodata)" />
            <Row label="Simulations running" value={String(kpi.simulationsRunning)} color="var(--accent)" />
          </div>
        </Collapsible>
      </div>

      <div className="panel" style={{ marginTop: "auto" }}>
        <div className="section-note">● Risk, sensors, incidents synthetic · rainfall {live ? "live (HKO)" : "synthetic"} · population census 2021 · trends vs −24 h</div>
      </div>
    </div>
  );
}

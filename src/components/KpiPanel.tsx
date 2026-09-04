// Left-hand indicator panel. Grouped by the question the user is asking
// (how bad is it → who is exposed → what is the weather doing → can I trust the data),
// with the headline numbers large and everything secondary one click away.

import { useStore } from "@/state/store";
import { fmtInt } from "@/core/format";
import type { Trend } from "@/core/types";
import Collapsible from "./ui/Collapsible";

function TrendMark({ t }: { t?: Trend }) {
  if (!t || t === "stable") return <span className="kpi-trend trend-stable">→</span>;
  return <span className={`kpi-trend trend-${t}`}>{t === "up" ? "↑" : "↓"}</span>;
}

function Tile({ label, value, unit, color, trend, sub, wide }: { label: string; value: string; unit?: string; color: string; trend?: Trend; sub?: string; wide?: boolean }) {
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

function Row({ label, value, color, trend }: { label: string; value: string; color: string; trend?: Trend }) {
  return (
    <div className="kpi-row">
      <span className="dot" style={{ background: color }} />
      {label}
      <span className="v">{value}</span>
      <TrendMark t={trend} />
    </div>
  );
}

export default function KpiPanel() {
  const kpi = useStore((s) => s.kpi);
  if (!kpi) return <div className="side" />;

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
        </div>
      </div>

      <div className="panel">
        <h3>Exposure</h3>
        <div className="tiles">
          <Tile label="People near at-risk slopes" value={fmtInt(kpi.populationExposed)} color="var(--risk-high)" trend={kpi.trends.populationExposed} wide />
        </div>
        <div className="kpi-rows">
          <Row label="Active incidents" value={String(kpi.activeIncidents)} color="var(--risk-high)" />
          <Row label="Roads exposed" value={String(kpi.roadsExposed)} color="var(--risk-elevated)" />
          <Row label="Buildings exposed" value={String(kpi.buildingsExposed)} color="var(--risk-elevated)" />
        </div>
      </div>

      <div className="panel">
        <h3>Rainfall</h3>
        <div className="tiles" style={{ marginBottom: 0 }}>
          <Tile label="Last 24 h" value={String(kpi.rainfall24hMm)} unit="mm" color="var(--accent)" trend={kpi.trends.rainfall24hMm} />
          <Tile label="Next 24 h" value={String(kpi.forecastRainfallMm)} unit="mm" color="var(--accent)" sub="synthetic forecast" />
        </div>
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
        <div className="section-note">● All values from synthetic providers · trends vs −24 h</div>
      </div>
    </div>
  );
}

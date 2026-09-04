// Automatic situation report generator (government-style operational briefing).

import type { Incident, KpiSnapshot, RiskAssessment, Slope, WeatherState } from "@/core/types";
import { fmtClock, fmtInt, timeAgo } from "@/core/format";

export function generateSitrep(
  gameTime: number,
  kpi: KpiSnapshot,
  weather: WeatherState,
  slopes: Slope[],
  assessments: Map<string, RiskAssessment>,
  incidents: Incident[]
): string {
  const worst = [...slopes]
    .map((s) => ({ s, a: assessments.get(s.id)! }))
    .filter(({ a }) => a && (a.category === "critical" || a.category === "high"))
    .sort((x, y) => y.a.score - x.a.score);

  const emerging = [...slopes]
    .map((s) => ({ s, a: assessments.get(s.id)! }))
    .filter(({ a }) => a && a.category !== "critical" && a.category !== "high" && a.trajectory.some((t) => t.horizonH <= 12 && (t.category === "high" || t.category === "critical")))
    .slice(0, 8);

  const lowConf = worst.filter(({ a }) => a.confidence < 0.5).slice(0, 5);
  const staleGeom = slopes.filter((s) => gameTime - Date.parse(s.freshness.geometry) > 365 * 86400_000).length;

  const lines: string[] = [];
  lines.push(`HONG KONG NATURAL HAZARD SITUATION REPORT`);
  lines.push(`Issued ${fmtClock(gameTime)} — SYNTHETIC DEMONSTRATION DATA — NOT AN OFFICIAL PRODUCT`);
  lines.push(``);
  lines.push(`1. CURRENT CONDITIONS`);
  lines.push(`   Territory-mean rainfall (24 h): ${kpi.rainfall24hMm} mm; current intensity ${weather.rainfallRateMmHr.value} mm/hr.`);
  lines.push(
    weather.stormActive
      ? `   ${weather.stormName} — heavy rain band arriving in ~${weather.stormEtaHours} h.`
      : `   No storm event active. Unsettled showers across the territory.`
  );
  lines.push(``);
  lines.push(`2. FORECAST`);
  lines.push(`   Next 24 h projected rainfall: ${kpi.forecastRainfallMm} mm (synthetic forecast).`);
  lines.push(``);
  lines.push(`3. SLOPE RISK PICTURE`);
  lines.push(`   Critical: ${kpi.criticalSlopes} · High: ${kpi.highRiskSlopes} · Elevated: ${kpi.elevatedSlopes} · Moderate: ${kpi.moderateSlopes}`);
  lines.push(`   Requiring monitoring: ${kpi.monitoringRequired} · Insufficient data: ${kpi.insufficientData}`);
  if (worst.length) {
    lines.push(`   Top concerns:`);
    worst.slice(0, 6).forEach(({ s, a }) =>
      lines.push(`     • ${s.id} (${s.district}) — ${a.category.toUpperCase()} ${a.score}/100, confidence ${Math.round(a.confidence * 100)}%, trend ${a.trend}`)
    );
  }
  lines.push(``);
  lines.push(`4. EMERGING RISKS (band escalation expected ≤12 h)`);
  if (emerging.length === 0) lines.push(`   None identified at this time.`);
  emerging.forEach(({ s, a }) => {
    const t = a.trajectory.find((t) => t.category === "high" || t.category === "critical");
    lines.push(`     • ${s.id} (${s.district}) — ${a.category} → ${t?.category.toUpperCase()} at +${t?.horizonH} h`);
  });
  lines.push(``);
  lines.push(`5. INFRASTRUCTURE EXPOSURE`);
  lines.push(`   Roads potentially exposed: ${kpi.roadsExposed} · Buildings: ${kpi.buildingsExposed} · Population: ${fmtInt(kpi.populationExposed)}`);
  lines.push(``);
  lines.push(`6. ACTIVE INCIDENTS (${incidents.length})`);
  incidents.slice(0, 8).forEach((i) =>
    lines.push(`     • ${i.id} ${i.kind.toUpperCase()} sev-${i.severity} @ ${i.slopeId ?? "n/a"} — ${i.status}, started ${timeAgo(i.startedAt, gameTime)}`)
  );
  lines.push(``);
  lines.push(`7. DATA GAPS`);
  lines.push(`   ${kpi.insufficientData} slopes lack sufficient data (GREY). ${staleGeom} slopes have geometry older than 12 months.`);
  if (lowConf.length) {
    lines.push(`   High-risk slopes with LOW model confidence (verification priority):`);
    lowConf.forEach(({ s, a }) => lines.push(`     • ${s.id} — confidence ${Math.round(a.confidence * 100)}%`));
  }
  lines.push(`   Sensors offline: ${kpi.sensorsOffline} · anomalous: ${kpi.sensorsAnomalous}.`);
  lines.push(``);
  lines.push(`8. RECOMMENDED ACTIONS`);
  if (kpi.criticalSlopes > 0) lines.push(`   • Dispatch inspection to ${Math.min(kpi.criticalSlopes, 5)} critical slopes; pre-position barriers on top runout paths.`);
  if (lowConf.length) lines.push(`   • Task UAV/LiDAR verification of low-confidence high-risk slopes listed in §7.`);
  if (weather.stormActive) lines.push(`   • Activate storm staffing; review evacuation triggers for districts with critical slopes.`);
  lines.push(`   • Clear drainage on slopes with condition < 50% before next rain band.`);
  lines.push(``);
  lines.push(`9. SIMULATIONS RUNNING: ${kpi.simulationsRunning}`);
  lines.push(``);
  lines.push(`— END OF REPORT (synthetic demonstration output) —`);
  return lines.join("\n");
}

// Slope Command Center — History & Validation. Real records (CEDD incidents, LPM works) are badged
// REAL on the timeline; the nearest GEO raingauge gives a real 40-year rainfall context for the slope.

import { useEffect, useMemo, useState } from "react";
import { registry } from "@/core/registry";
import { useStore } from "@/state/store";
import { loadRainfallHistory, type RainfallHistory } from "@/live/rainfallHistory";
import { fmtDistance } from "@/core/geo";
import { fmtDate } from "@/core/format";
import type { Slope, ValidationRecord } from "@/core/types";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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

function GaugeRecord({ slope }: { slope: Slope }) {
  const [h, setH] = useState<RainfallHistory | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    loadRainfallHistory().then(setH).catch((e) => setErr(String(e?.message ?? e)));
  }, []);

  const data = useMemo(() => {
    if (!h || !slope.nearestGauge) return null;
    const g = h.gaugeIndex(slope.nearestGauge.id);
    if (g < 0) return null;
    const max = h.annualMaxMm(g);
    const total = h.annualTotalMm(g);
    const incidentYears = new Set(slope.realIncidents.filter((i) => i.date).map((i) => +i.date!.slice(0, 4)));
    const rows = max.map((mm, i) => ({ year: h.epochYear + i, maxDay: mm, total: total[i], incident: incidentYears.has(h.epochYear + i) })).filter((r) => r.total > 0);
    const wettest = rows.reduce((b, r) => (r.maxDay > b.maxDay ? r : b), rows[0]);
    const meanTotal = rows.length ? Math.round(rows.reduce((s, r) => s + r.total, 0) / rows.length) : 0;
    return { rows, wettest, meanTotal, gauge: h.gauges[g] };
  }, [h, slope]);

  if (!slope.nearestGauge) return null;
  return (
    <div className="card">
      <h3>
        Rainfall record at the nearest GEO gauge
        <span className="hint badge real">REAL · CEDD/GEO</span>
      </h3>
      <div style={{ fontSize: 11.5, color: "var(--text-1)", marginBottom: 8 }}>
        <b>{slope.nearestGauge.name}</b> <span style={{ fontFamily: "var(--mono)", color: "var(--text-2)" }}>{slope.nearestGauge.id}</span> · {fmtDistance(slope.nearestGauge.distM)} from the slope
        {data && (
          <>
            {" "}· record {data.gauge.from}–{data.gauge.to} · mean {data.meanTotal.toLocaleString("en-US")} mm/yr · wettest day <b>{data.wettest?.maxDay} mm</b> in {data.wettest?.year}
          </>
        )}
      </div>
      {err && <div style={{ color: "#ff8577", fontSize: 12 }}>Rainfall record unavailable: {err}</div>}
      {!err && !data && <div className="muted" style={{ fontSize: 12 }}>Loading the 1984 → present gauge record…</div>}
      {data && (
        <div style={{ height: 150 }}>
          <ResponsiveContainer>
            <BarChart data={data.rows}>
              <CartesianGrid stroke="#1b2330" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 9, fill: "#6d7a8c" }} interval={4} />
              <YAxis tick={{ fontSize: 9, fill: "#6d7a8c" }} width={36} unit="" />
              <Tooltip
                contentStyle={{ background: "#0c1017", border: "1px solid #232c3a", fontSize: 11 }}
                formatter={(v: any, n: any) => [`${v} mm`, n === "maxDay" ? "wettest day" : n]}
                labelFormatter={(l) => `${l}${data.rows.find((r) => r.year === l)?.incident ? " · landslide recorded on this slope" : ""}`}
              />
              <Bar dataKey="maxDay" name="maxDay">
                {data.rows.map((r) => (
                  <Cell key={r.year} fill={r.incident ? "#e04a3a" : "#3d8bfd"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="row-hint">Wettest day of each year (mm). Red bars: years with a CEDD landslide incident recorded on this slope. Gauge data 1984 → present, daily totals.</div>
    </div>
  );
}

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
  const realCount = events.filter((e) => e.real).length;
  const undated = slope.realIncidents.filter((i) => !i.date);

  return (
    <div>
      <div className="grid2">
        <div className="card">
          <h3>
            Historical Timeline — scrub through time
            {realCount > 0 && <span className="hint badge real">{realCount} real record{realCount > 1 ? "s" : ""}</span>}
          </h3>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
            <input type="range" min={0} max={1} step={0.01} value={timeCursor} onChange={(e) => setTimeCursor(+e.target.value)} style={{ flex: 1, accentColor: "var(--accent)" }} />
            <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{fmtDate(cursorTime)}</span>
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
                <div className={`tl-item ${e.kind === "incident" ? "incident" : ""} ${e.real ? "real" : ""}`} key={i}>
                  <div className="tl-date">{e.date.slice(0, 10)}</div>
                  <div className="tl-label">
                    {KIND_ICONS[e.kind] ?? "•"} {e.label}
                    {e.detail && <div style={{ fontSize: 10.5, color: "var(--text-2)" }}>{e.detail}</div>}
                  </div>
                </div>
              ))}
            <div className="tl-item">
              <div className="tl-date">{fmtDate(gameTime)}</div>
              <div className="tl-label">📍 Current state</div>
            </div>
          </div>
          {undated.length > 0 && (
            <div className="row-hint">
              + {undated.length} undated CEDD incident record{undated.length > 1 ? "s" : ""} on this slope ({undated.map((i) => i.ref).join(", ")}).
            </div>
          )}
          <div className="row-hint">Events marked REAL come from CEDD's incident database and LPMitP works programme; inspections, surveys and sensor events are synthetic.</div>
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

          {slope.realIncidents.length > 0 && (
            <>
              <h3 style={{ marginTop: 6 }}>
                Recorded failures on this slope <span className="hint badge real">REAL · CEDD</span>
              </h3>
              <table className="data">
                <thead>
                  <tr><th>Date</th><th>Volume</th><th>CEDD ref</th></tr>
                </thead>
                <tbody>
                  {[...slope.realIncidents].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).map((i) => (
                    <tr key={i.ref}>
                      <td style={{ fontFamily: "var(--mono)" }}>{i.date ? i.date.slice(0, 10) : <span className="muted">undated</span>}</td>
                      <td>{i.volumeM3 !== null ? `${i.volumeM3} m³` : <span className="muted">—</span>}</td>
                      <td style={{ fontFamily: "var(--mono)", fontSize: 10.5 }}>{i.ref}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>

      <GaugeRecord slope={slope} />
    </div>
  );
}

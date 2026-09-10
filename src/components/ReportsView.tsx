import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/state/store";
import { registry } from "@/core/registry";
import { generateSitrep } from "@/decision/sitrep";
import { fmtClock, timeAgo } from "@/core/format";
import type { ValidationRecord } from "@/core/types";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Legend, ScatterChart, Scatter } from "recharts";
import { buildStormReport, LWS_CONTEXT } from "@/decision/stormReport";
import { replayStorms, type ReplayResult } from "@/decision/stormReplay";
import { loadRainfallHistory } from "@/live/rainfallHistory";
import { fmtInt } from "@/core/format";
import Term from "./ui/Term";
import DataSourcesPane from "./DataSourcesPane";
import WhatsNewPane from "./WhatsNewPane";
import RainfallLandslidesPane from "./RainfallLandslidesPane";
import type { ReportsTabId } from "@/state/store";

const TABS: { id: ReportsTabId; label: string; hint: string; real?: boolean }[] = [
  { id: "sitrep", label: "Situation Report", hint: "Operational briefing generated from the twin state" },
  { id: "storm", label: "Storm Report", hint: "PoLA one-page storm report: expected landslides by district and on GEO's grid, expected fatalities, HKO nowcast" },
  { id: "validation", label: "Model Validation", hint: "Predicted vs observed on synthetic historical incidents" },
  { id: "rainfall", label: "Rainfall & Landslides", hint: "REAL DATA — 40 years of GEO raingauge records against CEDD landslide incidents", real: true },
  { id: "sources", label: "Data Sources", hint: "Every dataset: what it is, how it is connected, real or synthetic, how fresh", real: true },
  { id: "whatsnew", label: "What's new", hint: "Every feature, dataset and model change, newest first" },
];

export default function ReportsView() {
  const tab = useStore((s) => s.reportsTab);
  const setTab = useStore((s) => s.setReportsTab);
  return (
    <div className="page">
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t.id} className={`chip ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)} title={t.hint}>
            {t.label}
            {t.real && <span style={{ marginLeft: 6, color: "#18b8a6", fontSize: 8.5, fontWeight: 700, letterSpacing: 0.6 }}>REAL</span>}
          </button>
        ))}
      </div>
      {tab === "sitrep" && <SitrepPane />}
      {tab === "storm" && <StormReportPane />}
      {tab === "validation" && <ValidationPane />}
      {tab === "rainfall" && <RainfallLandslidesPane />}
      {tab === "sources" && <DataSourcesPane />}
      {tab === "whatsnew" && <WhatsNewPane />}
    </div>
  );
}

function SitrepPane() {
  const gameTime = useStore((s) => s.gameTime);
  const kpi = useStore((s) => s.kpi);
  const weather = useStore((s) => s.weather);
  const slopes = useStore((s) => s.slopes);
  const assessments = useStore((s) => s.assessments);
  const incidents = useStore((s) => s.incidents);

  const [report, setReport] = useState<string>("");
  const [issuedAt, setIssuedAt] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = () => {
    if (!kpi || !weather) return;
    setReport(generateSitrep(gameTime, kpi, weather, slopes, assessments, incidents));
    setIssuedAt(gameTime);
  };
  useEffect(generate, [kpi === null, weather === null]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  const ageMin = issuedAt !== null ? Math.floor((gameTime - issuedAt) / 60_000) : 0;

  return (
    <div style={{ maxWidth: 1200 }}>
      <h1>Automatic Situation Report</h1>
      <div className="sub">Operational briefing generated from the live twin state. Regenerate before sharing — the twin keeps moving.</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <button className="btn primary" onClick={generate}>↻ Regenerate from current state</button>
        <button className="btn" onClick={copy} disabled={!report}>⎘ Copy to clipboard</button>
        {copied && <span className="copied">✓ Copied</span>}
        {issuedAt !== null && (
          <span className="row-hint" style={{ marginTop: 0, marginLeft: "auto" }}>
            Issued {fmtClock(issuedAt)} · {ageMin < 1 ? "current" : `${timeAgo(new Date(issuedAt).toISOString(), gameTime)}`}
            {ageMin >= 60 && <span className="flag stale" style={{ marginLeft: 6 }}>regenerate</span>}
          </span>
        )}
      </div>
      {report && <pre className="report">{report}</pre>}
    </div>
  );
}

function StormReportPane() {
  const gameTime = useStore((s) => s.gameTime);
  const slopes = useStore((s) => s.slopes);
  const assessments = useStore((s) => s.assessments);
  const weather = useStore((s) => s.weather);
  const kpi = useStore((s) => s.kpi);
  const report = useMemo(
    () => (slopes.length && assessments.size ? buildStormReport(slopes, assessments, weather, kpi, gameTime) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slopes, assessments, weather, kpi]
  );
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };
  const f = (x: number) => (x >= 10 ? fmtInt(x) : x >= 1 ? x.toFixed(1) : x.toFixed(2));
  if (!report) return <div className="muted">Waiting for the first risk pass…</div>;
  const t = report.totals;
  return (
    <div>
      <h1>Storm Report <span className="hint badge fresh">PoLA chain</span></h1>
      <div className="sub">
        The one-page prompt risk assessment of He, Zhang et al. (2023): the inventory's risk chain summed over the territory for the storm in progress. Regenerates with every risk pass. Issued {fmtClock(report.issuedAt)}.
      </div>
      <div className="tiles" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
        <div className="tile"><div className="tile-l"><Term id="expected-landslides">Expected landslides</Term></div><div className="tile-v">{f(t.expected)}<span className="unit">{f(t.expected5)}–{f(t.expected95)}</span></div></div>
        <div className="tile"><div className="tile-l">of which ≥ 50 m³</div><div className="tile-v">{f(t.expectedMajor)}</div></div>
        <div className="tile"><div className="tile-l"><Term id="pll">Expected fatalities</Term></div><div className="tile-v" style={{ color: "var(--risk-high)" }}>{t.pll.toExponential(1)}<span className="unit">{t.pll5.toExponential(1)}–{t.pll95.toExponential(1)}</span></div></div>
        <div className="tile"><div className="tile-l"><Term id="r24">Max R24</Term></div><div className="tile-v">{Math.round(t.maxR24)}<span className="unit">mm · ~{t.returnPeriodY} y</span></div></div>
        <div className="tile"><div className="tile-l"><Term id="nowcast">Next 2 h</Term></div><div className="tile-v">{weather?.nowcast ? weather.nowcast.mean2h : "—"}<span className="unit">{weather?.nowcast ? `mm mean · max ${weather.nowcast.max2h}` : "no nowcast"}</span></div></div>
      </div>

      <div className="card">
        <h3>By district <span className="hint">expected landslides · ≥ 50 m³ · PLL · max R24 · top slopes</span></h3>
        <div style={{ overflowX: "auto", maxHeight: 360, overflowY: "auto" }}>
          <table className="data">
            <thead><tr><th>District</th><th>Slopes</th><th>Expected</th><th>5–95 %</th><th>≥ 50 m³</th><th>PLL</th><th>Max R24</th><th>Top slopes</th></tr></thead>
            <tbody>
              {report.districts.map((d) => (
                <tr key={d.district}>
                  <td>{d.district}</td><td>{d.slopes}</td><td>{f(d.expected)}</td><td className="muted">{f(d.expected5)}–{f(d.expected95)}</td><td>{f(d.expectedMajor)}</td><td>{d.pll.toExponential(1)}</td><td>{Math.round(d.maxR24)} mm</td>
                  <td style={{ fontFamily: "var(--mono)", fontSize: 10.5 }}>{d.top.join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Hotspot cells <span className="hint">GEO 750 × 600 m grid — toggle the “Expected landslides grid” map layer to see them</span></h3>
        <table className="data">
          <thead><tr><th>Cell</th><th>Expected</th><th>≥ 50 m³</th><th>PLL</th><th>Slopes</th><th>Worst slope</th></tr></thead>
          <tbody>
            {report.cells.slice(0, 10).map((c) => (
              <tr key={`${c.q}:${c.r}`}>
                <td style={{ fontFamily: "var(--mono)" }}>{c.q}/{c.r}</td><td>{f(c.expected)}</td><td>{f(c.expectedMajor)}</td><td>{c.pll.toExponential(1)}</td><td>{c.slopes}</td><td style={{ fontFamily: "var(--mono)" }}>{c.worst}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Context — GEO's yardsticks <span className="hint badge real">REAL</span></h3>
        <div className="section-note">
          GEO reports about {LWS_CONTEXT.incidentsPerYear} landslides and issues about {LWS_CONTEXT.warningsPerYear} Landslip Warnings a year; the Warning goes out when numerous landslides are predicted from rainfall area, intensity and the slopes affected. On 7 September 2023 ({LWS_CONTEXT.storm20230907.r24Mm} mm in 24 h, ~1,000-year) about {LWS_CONTEXT.storm20230907.reported} incidents were reported and {LWS_CONTEXT.storm20230907.interpreted} landslides interpreted from satellite imagery; on 7 June 2008 ({LWS_CONTEXT.storm20080607.r24Mm} mm) {LWS_CONTEXT.storm20080607.manMadeFailures} man-made slopes failed. The inventory here is the {t.slopes.toLocaleString("en-US")} tallest or programmed slopes of 61,475 registered, so territory totals scale up. See Model Validation for the replay of the 40 wettest days.
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
        <button className="btn" onClick={copy}>⎘ Copy one-page report</button>
        {copied && <span className="copied">✓ Copied</span>}
      </div>
      <pre className="report">{report.text}</pre>
    </div>
  );
}

function ValidationPane() {
  const [records, setRecords] = useState<ValidationRecord[]>([]);
  const slopes = useStore((s) => s.slopes);
  const [replay, setReplay] = useState<ReplayResult | null>(null);
  useEffect(() => {
    void registry.validation.getRecords().then(setRecords);
  }, []);
  useEffect(() => {
    if (!slopes.length) return;
    let alive = true;
    void loadRainfallHistory().then((h) => { if (alive) setReplay(replayStorms(slopes, h)); }).catch(() => undefined);
    return () => { alive = false; };
  }, [slopes]);

  const byVersion = useMemo(() => {
    const groups = new Map<string, ValidationRecord[]>();
    for (const r of records) groups.set(r.modelVersion, [...(groups.get(r.modelVersion) ?? []), r]);
    const mape = (rs: ValidationRecord[], f: (r: ValidationRecord) => [number, number]) =>
      Math.round((rs.reduce((s, r) => { const [p, o] = f(r); return s + Math.abs(p - o) / Math.max(1e-6, o); }, 0) / rs.length) * 100);
    return [...groups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([v, rs]) => ({
        version: v,
        n: rs.length,
        runoutErr: mape(rs, (r) => [r.predicted.runoutM, r.observed.runoutM]),
        timeErr: mape(rs, (r) => [r.predicted.failureTimeH, r.observed.failureTimeH]),
        dispErr: mape(rs, (r) => [r.predicted.displacementMm, r.observed.displacementMm]),
        areaErr: mape(rs, (r) => [r.predicted.areaM2, r.observed.areaM2]),
      }));
  }, [records]);

  const first = byVersion[0];
  const last = byVersion[byVersion.length - 1];

  return (
    <div>
      <h1>Model vs Reality</h1>
      <div className="sub">The risk chain against the real CEDD record on the 40 wettest days since 1984, then prediction error against {records.length} synthetic historical incidents.</div>

      <div className="card">
        <h3>
          Storm replay — PoLA occurrence against CEDD incidents <span className="hint badge real">REAL · GEO raingauges + CEDD incidents</span>
        </h3>
        {!replay ? (
          <div className="muted">Replaying the 40 wettest days through the inventory…</div>
        ) : (
          <>
            <div className="tiles" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 10 }}>
              <div className="tile"><div className="tile-l">Correlation ρ · inventory-linked</div><div className="tile-v" style={{ color: replay.rho > 0.7 ? "var(--risk-low)" : "var(--risk-elevated)" }}>{replay.rho.toFixed(2)}<span className="unit">ln(1+x), {replay.storms} storms</span></div></div>
              <div className="tile"><div className="tile-l">Correlation ρ · all incidents</div><div className="tile-v">{replay.rhoAll.toFixed(2)}</div></div>
              <div className="tile"><div className="tile-l">Calibration factor</div><div className="tile-v" style={{ color: replay.calibration > 0.5 && replay.calibration < 2 ? "var(--risk-low)" : "var(--risk-elevated)" }}>×{replay.calibration.toFixed(2)}<span className="unit">observed / predicted</span></div></div>
              <div className="tile"><div className="tile-l">Inventory</div><div className="tile-v">{fmtInt(replay.inventory)}<span className="unit">slopes</span></div></div>
            </div>
            <div style={{ height: 220 }}>
              <ResponsiveContainer>
                <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid stroke="#1b2330" />
                  <XAxis dataKey="predicted" name="Predicted (Σ P)" type="number" tick={{ fontSize: 10, fill: "#6d7a8c" }} label={{ value: "predicted failures in the inventory", position: "insideBottom", offset: -2, fontSize: 10, fill: "#6d7a8c" }} />
                  <YAxis dataKey="observedLinked" name="Observed (linked)" type="number" tick={{ fontSize: 10, fill: "#6d7a8c" }} />
                  <Tooltip contentStyle={{ background: "#0c1017", border: "1px solid #232c3a", fontSize: 11 }} formatter={(v: number, n: string) => [typeof v === "number" ? v.toFixed(2) : v, n]} labelFormatter={() => ""} />
                  <Scatter data={replay.rows} fill="#f28c28" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div style={{ overflowX: "auto", maxHeight: 300, overflowY: "auto", marginTop: 8 }}>
              <table className="data">
                <thead><tr><th>Storm day</th><th>Max mm</th><th>Mean mm</th><th>Gauges</th><th>Predicted Σ P</th><th>Predicted ≥ 50 m³</th><th>Observed · inventory</th><th>Observed · all HK</th></tr></thead>
                <tbody>
                  {replay.rows.map((r) => (
                    <tr key={r.k}>
                      <td>{r.date}</td><td>{r.maxMm.toFixed(0)}</td><td>{r.meanMm.toFixed(0)}</td><td>{r.gauges}</td><td>{r.predicted.toFixed(2)}</td><td>{r.predictedMajor.toFixed(2)}</td><td>{r.observedLinked}</td><td>{r.observedAll}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row-hint">
              Each slope takes its nearest GEO gauge's daily total (daily totals can only understate the maximum rolling 24-h rainfall); no monitoring evidence, neutral material term. Observed · inventory = CEDD incidents that day citing a slope in this inventory (42 % of incidents cite a slope number). A calibration factor far from 1 means the occurrence anchor (1e-4 per slope-storm at 120 mm) should move by that factor — see Data sources → How it is calculated.
            </div>
          </>
        )}
      </div>

      {first && last && first !== last && (
        <div className="tiles" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          {(
            [
              ["Runout error", first.runoutErr, last.runoutErr],
              ["Failure-time error", first.timeErr, last.timeErr],
              ["Displacement error", first.dispErr, last.dispErr],
              ["Affected-area error", first.areaErr, last.areaErr],
            ] as [string, number, number][]
          ).map(([label, a, b]) => (
            <div className="tile" key={label}>
              <div className="tile-l">{label}</div>
              <div className="tile-v" style={{ color: b < a ? "var(--risk-low)" : "var(--risk-high)" }}>
                {b}%<span className="unit">from {a}% ({first.version}→{last.version})</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h3>Mean absolute error by model version (%)</h3>
        <div style={{ height: 220 }}>
          <ResponsiveContainer>
            <LineChart data={byVersion}>
              <CartesianGrid stroke="#1b2330" vertical={false} />
              <XAxis dataKey="version" tick={{ fontSize: 11, fill: "#aab6c5" }} />
              <YAxis tick={{ fontSize: 10, fill: "#6d7a8c" }} unit="%" />
              <Tooltip contentStyle={{ background: "#0c1017", border: "1px solid #232c3a", fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line dataKey="runoutErr" name="Runout" stroke="#f28c28" strokeWidth={2} />
              <Line dataKey="timeErr" name="Failure time" stroke="#3d8bfd" strokeWidth={2} />
              <Line dataKey="dispErr" name="Displacement" stroke="#e04a3a" strokeWidth={2} />
              <Line dataKey="areaErr" name="Affected area" stroke="#43d19a" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="row-hint">Error decreasing across versions indicates the (synthetic) model retraining loop is working.</div>
      </div>

      <div className="card">
        <h3>Individual predictions <span className="hint">P = predicted · O = observed</span></h3>
        <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
          <table className="data">
            <thead>
              <tr>
                <th>Incident</th><th>Slope</th><th>Date</th><th>Model</th>
                <th>Runout P/O (m)</th><th>Fail time P/O (h)</th><th>Disp P/O (mm)</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.incidentId}>
                  <td style={{ fontFamily: "var(--mono)" }}>{r.incidentId}</td>
                  <td style={{ fontFamily: "var(--mono)" }}>{r.slopeId}</td>
                  <td>{r.date.slice(0, 10)}</td>
                  <td>{r.modelVersion}</td>
                  <td>{r.predicted.runoutM} / {r.observed.runoutM}</td>
                  <td>{r.predicted.failureTimeH} / {r.observed.failureTimeH}</td>
                  <td>{r.predicted.displacementMm} / {r.observed.displacementMm}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/state/store";
import { registry } from "@/core/registry";
import { generateSitrep } from "@/decision/sitrep";
import { fmtClock, timeAgo } from "@/core/format";
import type { ValidationRecord } from "@/core/types";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Legend } from "recharts";

export default function ReportsView() {
  const [tab, setTab] = useState<"sitrep" | "validation">("sitrep");
  return (
    <div className="page">
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button className={`chip ${tab === "sitrep" ? "on" : ""}`} onClick={() => setTab("sitrep")}>Situation Report</button>
        <button className={`chip ${tab === "validation" ? "on" : ""}`} onClick={() => setTab("validation")}>Model Validation</button>
      </div>
      {tab === "sitrep" ? <SitrepPane /> : <ValidationPane />}
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
    <div style={{ maxWidth: 900 }}>
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

function ValidationPane() {
  const [records, setRecords] = useState<ValidationRecord[]>([]);
  useEffect(() => {
    void registry.validation.getRecords().then(setRecords);
  }, []);

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
    <div style={{ maxWidth: 980 }}>
      <h1>Model vs Reality</h1>
      <div className="sub">Prediction error against {records.length} synthetic historical incidents — is the model improving over time?</div>

      {first && last && first !== last && (
        <div className="tiles" style={{ gridTemplateColumns: "repeat(4, 1fr)", maxWidth: 980 }}>
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

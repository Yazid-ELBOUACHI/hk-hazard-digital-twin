// Right-hand context panel (Overview). Answers "where should I look first?":
// a short orientation card (dismissible), the weather outlook, a ranked "needs attention"
// list that opens the Slope Command Center, and the incident feed.

import { useMemo, useState } from "react";
import { useStore } from "@/state/store";
import { fmtInt, isStale, timeAgo } from "@/core/format";
import { RISK_COLORS } from "@/core/types";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import Collapsible from "./ui/Collapsible";

const HINT_KEY = "hkdt.hint.dismissed";

function GettingStarted() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(HINT_KEY) === "1";
    } catch {
      return false;
    }
  });
  if (dismissed) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="hint-card">
      <h4>
        How to use this twin
        <button onClick={dismiss} title="Dismiss">✕</button>
      </h4>
      <ol>
        <li><b>Scan</b> the map or the <b>Needs attention</b> list below.</li>
        <li><b>Click a slope</b> to open its Command Center (why it is risky, live sensors, history).</li>
        <li><b>Run a scenario</b> there to test a storm or an intervention, then compare.</li>
      </ol>
    </div>
  );
}

export default function RightPanel() {
  const weather = useStore((s) => s.weather);
  const incidents = useStore((s) => s.incidents);
  const slopes = useStore((s) => s.slopes);
  const assessments = useStore((s) => s.assessments);
  const gameTime = useStore((s) => s.gameTime);
  const role = useStore((s) => s.role);
  const selectSlope = useStore((s) => s.selectSlope);
  const flyToSlope = useStore((s) => s.flyToSlope);

  const forecastBars = useMemo(() => {
    if (!weather) return [];
    return weather.forecast72h
      .filter((_, i) => i % 3 === 0)
      .map((f, i) => ({ h: `+${(i + 1) * 3}h`, mm: +(f.mmHr * 3).toFixed(0) }));
  }, [weather]);

  // Ranked list: critical/high first by score; then slopes expected to escalate within 12 h.
  const attention = useMemo(() => {
    const rows = slopes
      .map((s) => ({ s, a: assessments.get(s.id) }))
      .filter((r) => r.a && r.a.category !== "no-data") as { s: (typeof slopes)[number]; a: NonNullable<ReturnType<typeof assessments.get>> }[];
    const urgent = rows.filter(({ a }) => a.category === "critical" || a.category === "high").sort((x, y) => y.a.score - x.a.score);
    const escalating = rows
      .filter(({ a }) => a.category !== "critical" && a.category !== "high")
      .filter(({ a }) => a.trajectory.some((t) => t.horizonH <= 12 && (t.category === "high" || t.category === "critical")))
      .sort((x, y) => y.a.score - x.a.score);
    return { urgent, escalating, list: [...urgent, ...escalating].slice(0, 7) };
  }, [slopes, assessments]);

  const open = (id: string) => {
    flyToSlope(id);
    selectSlope(id);
  };

  if (role === "public") {
    return (
      <div className="side right">
        <div className="panel">
          <h3>Public Safety Information</h3>
          <p style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--text-1)" }}>
            {weather?.stormActive
              ? "A severe rainstorm scenario is active in this demonstration. In a real event: stay away from steep slopes and retaining walls, do not park or wait near slope toes, and follow official announcements."
              : "Showery conditions in this demonstration. General advice: be aware of your surroundings near steep slopes during heavy rain."}
          </p>
          <div className="disclaimer" style={{ marginTop: 10 }}>Demonstration only — not real warnings</div>
        </div>
        {weather && (
          <div className="panel">
            <h3>Rainfall Outlook (synthetic)</h3>
            <div style={{ height: 130 }}>
              <ResponsiveContainer>
                <BarChart data={forecastBars}>
                  <XAxis dataKey="h" tick={{ fontSize: 9, fill: "#6d7a8c" }} interval={3} />
                  <YAxis tick={{ fontSize: 9, fill: "#6d7a8c" }} width={26} />
                  <Bar dataKey="mm" fill="#3d8bfd" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="side right">
      <GettingStarted />

      <div className="panel">
        <h3>
          Needs attention
          <span className="hint" style={{ float: "right", fontWeight: 500, letterSpacing: 0, textTransform: "none" }}>
            {attention.urgent.length} critical/high
          </span>
        </h3>
        {attention.list.length === 0 && <div className="section-note">No slope is currently in a high or critical band.</div>}
        {attention.list.map(({ s, a }) => {
          const esc = a.category !== "critical" && a.category !== "high" ? a.trajectory.find((t) => t.horizonH <= 12 && (t.category === "high" || t.category === "critical")) : undefined;
          return (
            <div className="attn-row" key={s.id} onClick={() => open(s.id)} title="Open Slope Command Center">
              <span className="bar" style={{ background: RISK_COLORS[a.category] }} />
              <div style={{ minWidth: 0 }}>
                <div className="id">{s.id}</div>
                <div className="meta">
                  <span>{s.district}</span>
                  <span>· ~{fmtInt(s.populationNearby)} people</span>
                  {a.trend === "up" && <span className="flag rising">rising</span>}
                  {esc && <span className="flag rising">{esc.category} at +{esc.horizonH} h</span>}
                  {a.confidence < 0.5 && <span className="flag verify">verify · conf {Math.round(a.confidence * 100)}%</span>}
                  {isStale(s.freshness.geometry, gameTime, 365) && <span className="flag stale">old geometry</span>}
                </div>
              </div>
              <div className="score" style={{ color: RISK_COLORS[a.category] }}>
                {a.score}
                <small>{a.category}</small>
              </div>
            </div>
          );
        })}
        <div className="row-hint">Ranked by risk score; flags show why verification or action is urgent. Click to open.</div>
      </div>

      {weather && (
        <div className="panel">
          <h3>Weather (synthetic)</h3>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
            <span className="stat-big" style={{ fontSize: 20 }}>{weather.rainfallLast24hMm.value} mm</span>
            <span style={{ color: "var(--text-2)", fontSize: 11 }}>last 24 h · {weather.rainfallRateMmHr.value} mm/hr now</span>
          </div>
          {weather.stormActive && (
            <div className="badge critical" style={{ marginBottom: 8 }}>
              {weather.stormName} — heavy band in ~{weather.stormEtaHours} h
            </div>
          )}
          <Collapsible title="72-hour outlook" className="flat" storageKey="right.forecast" defaultOpen summary="3-hour totals">
            <div style={{ height: 110 }}>
              <ResponsiveContainer>
                <BarChart data={forecastBars}>
                  <XAxis dataKey="h" tick={{ fontSize: 9, fill: "#6d7a8c" }} interval={3} />
                  <YAxis tick={{ fontSize: 9, fill: "#6d7a8c" }} width={26} />
                  <Tooltip contentStyle={{ background: "#0c1017", border: "1px solid #232c3a", fontSize: 11 }} />
                  <Bar dataKey="mm" fill="#3d8bfd" name="mm / 3h" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="section-note" style={{ marginTop: 2 }}>Next 72 h, 3-hour totals · source: mock_forecast</div>
          </Collapsible>
        </div>
      )}

      <div className="panel">
        <Collapsible title={`Active incidents (${incidents.length})`} className="flat" storageKey="right.incidents" defaultOpen summary="synthetic feed">
          {incidents.slice(0, 8).map((inc) => (
            <div key={inc.id} className="alert-row" onClick={() => inc.slopeId && open(inc.slopeId)} title={inc.slopeId ? "Open the affected slope" : undefined}>
              <span style={{ fontSize: 13 }}>{inc.kind === "flooding" ? "🌊" : inc.kind === "road-blockage" ? "🚧" : "⛰"}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 11.5 }}>
                  {inc.kind.replace("-", " ")} · sev {inc.severity}
                </div>
                <div style={{ color: "var(--text-2)", fontSize: 10.5 }}>
                  {inc.slopeId} — {timeAgo(inc.startedAt, gameTime)}
                </div>
              </div>
              <span className="count" style={{ fontSize: 10, color: inc.status === "active" ? "var(--risk-high)" : "var(--risk-moderate)" }}>
                {inc.status}
              </span>
            </div>
          ))}
        </Collapsible>
      </div>
    </div>
  );
}

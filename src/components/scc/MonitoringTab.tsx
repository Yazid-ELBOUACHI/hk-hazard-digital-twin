import { useEffect, useState } from "react";
import { registry } from "@/core/registry";
import { useStore } from "@/state/store";
import type { SensorKind, SensorReading, Slope } from "@/core/types";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, BarChart, Bar, CartesianGrid } from "recharts";

const CHART_KINDS: { kind: SensorKind; label: string; color: string; type: "line" | "bar" }[] = [
  { kind: "rainfall", label: "Rainfall (mm/hr)", color: "#3d8bfd", type: "bar" },
  { kind: "displacement-total", label: "Displacement — total (mm)", color: "#e04a3a", type: "line" },
  { kind: "displacement-horizontal", label: "Displacement — horizontal (mm)", color: "#f28c28", type: "line" },
  { kind: "displacement-vertical", label: "Displacement — vertical (mm)", color: "#e8c33a", type: "line" },
  { kind: "pore-pressure", label: "Pore pressure (kPa)", color: "#38b6d8", type: "line" },
  { kind: "groundwater", label: "Groundwater (% vs normal)", color: "#4d9fff", type: "line" },
  { kind: "gnss-movement", label: "GNSS movement (mm)", color: "#b48ce8", type: "line" },
  { kind: "soil-moisture", label: "Soil moisture (%)", color: "#43d19a", type: "line" },
];

export default function MonitoringTab({ slope }: { slope: Slope }) {
  const gameTime = useStore((s) => s.gameTime);
  const speed = useStore((s) => s.speed);
  const setSpeed = useStore((s) => s.setSpeed);
  const [series, setSeries] = useState<Map<SensorKind, SensorReading>>(new Map());
  const [windowH, setWindowH] = useState(24);

  const kindsOnSlope = new Set(slope.sensors.filter((s) => s.online).map((s) => s.kind));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const m = new Map<SensorKind, SensorReading>();
      for (const c of CHART_KINDS) {
        if (!kindsOnSlope.has(c.kind)) continue;
        m.set(c.kind, await registry.sensors.getSeries(slope.id, c.kind, gameTime, windowH));
      }
      if (!cancelled) setSeries(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [slope.id, windowH, Math.floor(gameTime / 300_000)]);

  const charts = CHART_KINDS.filter((c) => kindsOnSlope.has(c.kind));

  return (
    <div>
      <div className="card" style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <h3 style={{ margin: 0 }}>Live Synthetic Streams</h3>
        <span style={{ fontSize: 11, color: "var(--text-2)" }}>
          {slope.sensors.filter((s) => s.online).length} sensors online · {slope.sensors.filter((s) => !s.online).length} offline ·{" "}
          {slope.sensors.filter((s) => s.anomalous).length} anomalous
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--text-2)" }}>Window</span>
          {[6, 24, 72].map((h) => (
            <button key={h} className={`chip ${windowH === h ? "on" : ""}`} onClick={() => setWindowH(h)}>
              {h} h
            </button>
          ))}
          <span style={{ fontSize: 11, color: "var(--text-2)", marginLeft: 10 }}>Clock</span>
          {[0, 60, 600, 3600].map((v) => (
            <button key={v} className={`chip ${speed === v ? "on" : ""}`} onClick={() => setSpeed(v)}>
              {v === 0 ? "⏸" : `${v / 60}×`}
            </button>
          ))}
        </div>
      </div>

      {charts.length === 0 && (
        <div className="card" style={{ color: "var(--text-2)" }}>
          This slope has no online sensors, so its risk score relies on rainfall and static attributes only. The “Add monitoring sensors” intervention in the Scenario Lab shows what instrumentation would change.
        </div>
      )}

      <div className="grid2">
        {charts.map((c) => {
          const r = series.get(c.kind);
          const data = (r?.series ?? []).map((p) => ({ t: p.t.slice(11, 16), v: p.value }));
          return (
            <div className="card" key={c.kind}>
              <h3>
                {c.label}
                {slope.sensors.some((sm) => sm.kind === c.kind && sm.anomalous) && (
                  <span className="badge stale" style={{ marginLeft: 8, verticalAlign: "middle" }} title="Sensor flagged anomalous: drift or genuine movement signal">
                    anomalous
                  </span>
                )}
                <span className="hint" style={{ color: c.color, fontFamily: "var(--mono)" }}>
                  {r?.latest.value ?? "—"} {r?.latest.unit}
                </span>
              </h3>
              <div style={{ height: 130 }}>
                <ResponsiveContainer>
                  {c.type === "bar" ? (
                    <BarChart data={data}>
                      <CartesianGrid stroke="#1b2330" vertical={false} />
                      <XAxis dataKey="t" tick={{ fontSize: 9, fill: "#6d7a8c" }} interval={Math.ceil(data.length / 6)} />
                      <YAxis tick={{ fontSize: 9, fill: "#6d7a8c" }} width={34} />
                      <Tooltip contentStyle={{ background: "#0c1017", border: "1px solid #232c3a", fontSize: 11 }} />
                      <Bar dataKey="v" fill={c.color} />
                    </BarChart>
                  ) : (
                    <LineChart data={data}>
                      <CartesianGrid stroke="#1b2330" vertical={false} />
                      <XAxis dataKey="t" tick={{ fontSize: 9, fill: "#6d7a8c" }} interval={Math.ceil(data.length / 6)} />
                      <YAxis tick={{ fontSize: 9, fill: "#6d7a8c" }} width={34} domain={["auto", "auto"]} />
                      <Tooltip contentStyle={{ background: "#0c1017", border: "1px solid #232c3a", fontSize: 11 }} />
                      <Line dataKey="v" stroke={c.color} dot={false} strokeWidth={1.8} isAnimationActive={false} />
                    </LineChart>
                  )}
                </ResponsiveContainer>
              </div>
              <div style={{ fontSize: 9.5, color: "var(--text-2)", marginTop: 4 }}>
                source: {r?.latest.source ?? "—"} · quality {r ? Math.round(r.latest.quality * 100) : "—"}% · synthetic
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

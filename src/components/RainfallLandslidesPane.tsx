// Reports → Rainfall & landslides. REAL DATA: the GEO raingauge record (1984 → present) against the
// CEDD landslide incident database (1983 → 2024). This is the empirical rainfall–landslide relation
// behind Hong Kong's rain-induced landslide models — nothing on this page is synthetic.

import { useEffect, useMemo, useState } from "react";
import { loadRainfallHistory, type RainfallHistory } from "@/live/rainfallHistory";
import { fmtInt } from "@/core/format";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const TOOLTIP = { background: "#0c1017", border: "1px solid #232c3a", fontSize: 11 } as const;
const INCIDENT_RECORD_END = "2024-12-31"; // incident database release currently ends here

const BINS = [
  { label: "< 25", lo: 0, hi: 25 },
  { label: "25–50", lo: 25, hi: 50 },
  { label: "50–100", lo: 50, hi: 100 },
  { label: "100–150", lo: 100, hi: 150 },
  { label: "150–200", lo: 150, hi: 200 },
  { label: "200–300", lo: 200, hi: 300 },
  { label: "≥ 300", lo: 300, hi: Infinity },
];

export default function RainfallLandslidesPane() {
  const [h, setH] = useState<RainfallHistory | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    loadRainfallHistory().then(setH).catch((e) => setErr(String(e?.message ?? e)));
  }, []);

  const derived = useMemo(() => {
    if (!h) return null;
    const lastIncidentDay = h.dayOfDate(INCIDENT_RECORD_END);
    const incidentsOn = (d: number) => (d < h.days ? h.dayIncidents[d] : 0) + (d + 1 < h.days ? h.dayIncidents[d + 1] : 0); // failures are often logged the next day

    // annual: wettest day, days ≥ 100 mm, incidents
    const annual = Array.from({ length: h.years }, (_, i) => ({ year: h.epochYear + i, maxDay: 0, heavyDays: 0, incidents: 0, hasIncidentData: h.epochYear + i <= 2024 }));
    for (let d = 0; d < h.days; d++) {
      const a = annual[h.yearOfDay(d) - h.epochYear];
      if (!a) continue;
      const mm = h.dayMaxMm[d];
      if (mm > a.maxDay) a.maxDay = mm;
      if (mm >= 100) a.heavyDays++;
      a.incidents += h.dayIncidents[d];
    }

    // rainfall bins vs incident rate (only days inside the incident record)
    const bins = BINS.map((b) => ({ ...b, days: 0, incidents: 0, daysWith: 0 }));
    let totalIncidents = 0, totalDays = 0;
    for (let d = 0; d <= lastIncidentDay; d++) {
      if (!h.dayGauges[d]) continue;
      const mm = h.dayMaxMm[d];
      const b = bins.find((x) => mm >= x.lo && mm < x.hi)!;
      const n = incidentsOn(d);
      b.days++;
      b.incidents += n;
      if (n > 0) b.daysWith++;
      totalDays++;
      totalIncidents += h.dayIncidents[d];
    }
    const binRows = bins.map((b) => ({
      label: b.label,
      days: b.days,
      perDay: b.days ? +(b.incidents / b.days).toFixed(2) : 0,
      pctWith: b.days ? Math.round((b.daysWith / b.days) * 100) : 0,
      shareOfIncidents: totalIncidents ? Math.round((b.incidents / (totalIncidents * 2 || 1)) * 100) : 0, // ×2: two-day window double counts
    }));
    const heavyShare = (() => {
      let heavy = 0;
      for (let d = 0; d <= lastIncidentDay; d++) if (h.dayMaxMm[d] >= 100) heavy += h.dayIncidents[d];
      return totalIncidents ? Math.round((heavy / totalIncidents) * 100) : 0;
    })();
    const heavyDayShare = totalDays ? +((bins.slice(3).reduce((s, b) => s + b.days, 0) / totalDays) * 100).toFixed(1) : 0;

    const storms = h.storms.slice(0, 15).map((s) => ({
      date: h.dateOfDay(s.d),
      maxMm: s.maxX10 / 10,
      gauge: h.gauges[s.gauge]?.name ?? "—",
      meanMm: s.meanX10 / 10,
      incidents: s.d <= lastIncidentDay ? incidentsOn(s.d) : null,
    }));
    return { annual, binRows, storms, totalIncidents, heavyShare, heavyDayShare };
  }, [h]);

  if (err) return <div className="card" style={{ color: "#ff8577" }}>Rainfall record unavailable: {err}</div>;
  if (!h || !derived) return <div className="card muted">Loading the GEO raingauge record (1984 → present)…</div>;

  return (
    <div style={{ maxWidth: 1100 }}>
      <h1>
        Rainfall &amp; landslides <span className="badge real" style={{ verticalAlign: "middle", marginLeft: 8 }}>REAL DATA</span>
      </h1>
      <div className="sub">
        {h.gauges.length} GEO raingauges, daily totals 1984-01-01 → {h.lastDate} (CEDD/GEO via CSDI), against {fmtInt(derived.totalIncidents)} dated landslide incidents in the CEDD
        incident database (1983 → 2024). The empirical relation Hong Kong's rain-induced landslide models are built on.
      </div>

      <div className="tiles" style={{ gridTemplateColumns: "repeat(4, 1fr)", maxWidth: 1100 }}>
        <div className="tile">
          <div className="tile-l">Incidents on days ≥ 100 mm</div>
          <div className="tile-v" style={{ color: "var(--risk-high)" }}>
            {derived.heavyShare}%<span className="unit">of all dated incidents</span>
          </div>
        </div>
        <div className="tile">
          <div className="tile-l">Such days are</div>
          <div className="tile-v">
            {derived.heavyDayShare}%<span className="unit">of all days</span>
          </div>
        </div>
        <div className="tile">
          <div className="tile-l">Wettest day on record</div>
          <div className="tile-v" style={{ color: "var(--accent)" }}>
            {derived.storms[0]?.maxMm}<span className="unit">mm · {derived.storms[0]?.date}</span>
          </div>
        </div>
        <div className="tile">
          <div className="tile-l">Gauges reporting</div>
          <div className="tile-v">
            {h.gauges.filter((g) => g.to >= +h.lastDate.slice(0, 4)).length}<span className="unit">of {h.gauges.length} active</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>
          Landslide incidents per day, by territory-maximum daily rainfall
          <span className="hint">days 1984 → 2024 · incidents on the day and the day after</span>
        </h3>
        <div style={{ height: 220 }}>
          <ResponsiveContainer>
            <ComposedChart data={derived.binRows}>
              <CartesianGrid stroke="#1b2330" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#aab6c5" }} label={{ value: "max daily rainfall at any gauge (mm)", position: "insideBottom", offset: -2, fontSize: 10, fill: "#6d7a8c" }} />
              <YAxis yAxisId="l" tick={{ fontSize: 10, fill: "#6d7a8c" }} label={{ value: "incidents / day", angle: -90, position: "insideLeft", fontSize: 10, fill: "#6d7a8c" }} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10, fill: "#6d7a8c" }} unit="%" />
              <Tooltip contentStyle={TOOLTIP} formatter={(v: any, n: any) => [v, n]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="l" dataKey="perDay" name="incidents per day" fill="#e04a3a" />
              <Bar yAxisId="r" dataKey="pctWith" name="% of days with ≥ 1 incident" fill="#3d8bfd" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="row-hint">
          Each bar is a class of days: {derived.binRows.map((b) => `${b.label} mm → ${fmtInt(b.days)} days`).join(" · ")}. The step-up above ~100 mm is the reason a 24-hour rainfall threshold sits at the
          heart of Hong Kong's landslip warning.
        </div>
      </div>

      <div className="card">
        <h3>
          Wettest day of each year vs reported landslides
          <span className="hint">annual · incident record ends 2024</span>
        </h3>
        <div style={{ height: 240 }}>
          <ResponsiveContainer>
            <ComposedChart data={derived.annual}>
              <CartesianGrid stroke="#1b2330" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 10, fill: "#6d7a8c" }} interval={4} />
              <YAxis yAxisId="l" tick={{ fontSize: 10, fill: "#6d7a8c" }} unit=" mm" width={52} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10, fill: "#6d7a8c" }} width={40} />
              <Tooltip contentStyle={TOOLTIP} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="l" dataKey="maxDay" name="wettest day (mm, territory max)" fill="#3d8bfd" />
              <Line yAxisId="r" dataKey="incidents" name="landslide incidents" stroke="#e04a3a" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="row-hint">2025–{h.lastDate.slice(0, 4)} show rainfall only: the incident database has not been released for those years yet.</div>
      </div>

      <div className="card">
        <h3>
          Top storm days on record <span className="hint">by territory-maximum daily total</span>
        </h3>
        <table className="data">
          <thead>
            <tr>
              <th>#</th>
              <th>Date</th>
              <th>Max daily (mm)</th>
              <th>Gauge</th>
              <th>Territory mean (mm)</th>
              <th>Incidents (day + next)</th>
            </tr>
          </thead>
          <tbody>
            {derived.storms.map((s, i) => (
              <tr key={s.date}>
                <td className="muted">{i + 1}</td>
                <td style={{ fontFamily: "var(--mono)" }}>{s.date}</td>
                <td style={{ color: "var(--accent)", fontWeight: 600 }}>{s.maxMm}</td>
                <td>{s.gauge}</td>
                <td>{s.meanMm}</td>
                <td>{s.incidents === null ? <span className="muted">no record yet</span> : s.incidents}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row-hint">
          Sources: GEO Raingauge Data (cedd_rcd_1636517963140_47030) and Location of Landslide Incidents (cedd_rcd_1640249280153_17521), both via CSDI. Baked into the bundle by{" "}
          <code>npm run bake:live</code>; see Data Sources for the bake date.
        </div>
      </div>
    </div>
  );
}

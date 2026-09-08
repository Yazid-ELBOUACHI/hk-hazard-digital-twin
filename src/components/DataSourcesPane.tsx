// Data Sources — every dataset behind the twin, rendered from the registry in src/core/dataSources.ts,
// with the live status each loader reports at runtime. Nothing here is hand-written per component:
// change the registry and this page follows.

import { useEffect, useState } from "react";
import { useStore } from "@/state/store";
import { CALCULATIONS, CSDI_PORTAL, DATA_SOURCES, type CalcGroup, type Connection, type DataSource, type Realness, type SourceGroup, type SourceStatus } from "@/core/dataSources";

const GROUPS: SourceGroup[] = ["Slopes & landslides", "Rainfall & weather", "Exposure & people", "Geography & basemap", "Synthetic twin state"];
const CALC_GROUPS: CalcGroup[] = ["Hazard & risk — the PoLA chain", "Rainfall", "Slope baseline & monitoring signals", "Exposure & consequence", "Scenario engine & 3D playback", "Planning, KPIs & reports"];

const CONN: Record<Connection, { label: string; hint: string }> = {
  "live-api": { label: "Live API", hint: "The browser queries the publisher's API directly (CSDI ArcGIS REST, CORS-open)" },
  "live-proxy": { label: "Live · via server", hint: "The browser asks our server, which polls the publisher and keeps the rolling state" },
  baked: { label: "Baked", hint: "Downloaded by scripts/build-live-data.mjs and shipped inside the bundle as a compact chunk" },
  tiles: { label: "Tiles", hint: "Streamed map tiles" },
  synthetic: { label: "Synthetic", hint: "Generated in the browser, deterministic and reproducible" },
};

const REAL: Record<Realness, { label: string; cls: string; hint: string }> = {
  real: { label: "Real", cls: "real", hint: "Published government data, unchanged" },
  derived: { label: "Derived from real", cls: "fresh", hint: "Computed from published data (e.g. counts on a grid)" },
  synthetic: { label: "Synthetic", cls: "synth", hint: "Invented for the demonstration — never an official value" },
};

function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

function refLinks(ref?: string) {
  if (!ref) return null;
  return ref.split(" · ").map((r, i) => {
    const isCsdi = /_rcd_\d+_\d+$/.test(r);
    const href = isCsdi ? `${CSDI_PORTAL}/geoportal/rest/metadata/item/${r}/html` : r.startsWith("http") ? r : `https://${r}`;
    return (
      <span key={r}>
        {i > 0 && " · "}
        <a href={href} target="_blank" rel="noreferrer" style={{ color: "inherit" }} title={isCsdi ? "CSDI dataset metadata" : href}>
          {r}
        </a>
      </span>
    );
  });
}

function Status({ src, st, now }: { src: DataSource; st?: SourceStatus; now: number }) {
  if (st) {
    return (
      <div className="ds-status">
        <span className={st.ok ? "ok" : "err"}>{st.ok ? "✓ loaded" : "✕ failed"}</span>
        {st.count !== undefined && <span> · {st.count.toLocaleString("en-US")}</span>}
        {st.note && <div className="muted">{st.note}</div>}
        <div className="muted">{ago(st.at, now)}</div>
      </div>
    );
  }
  const idle: Record<Connection, string> = {
    "live-api": "not loaded yet — toggle the layer",
    "live-proxy": "waiting for first poll",
    baked: "in bundle — loads on first use",
    tiles: "streaming",
    synthetic: "—",
  };
  return <div className="ds-status muted">{idle[src.connection]}</div>;
}

export default function DataSourcesPane() {
  const status = useStore((s) => s.sourceStatus);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const real = DATA_SOURCES.filter((d) => d.realness !== "synthetic").length;
  const loaded = DATA_SOURCES.filter((d) => status[d.id]?.ok).length;

  return (
    <div style={{ maxWidth: 1180 }}>
      <h1>Data Sources</h1>
      <div className="sub">
        Every dataset the twin touches — what it is, how it reaches the running app, whether it is real, and how fresh it is. {real} of {DATA_SOURCES.length} sources are real
        government open data; {loaded} have reported a successful load in this session. Generated from <code>src/core/dataSources.ts</code>.
      </div>

      <div className="ds-legend">
        {(Object.keys(CONN) as Connection[]).map((c) => (
          <span key={c} title={CONN[c].hint}>
            <span className={`conn ${c}`}>{CONN[c].label}</span> {CONN[c].hint}
          </span>
        ))}
      </div>

      {GROUPS.map((g) => {
        const rows = DATA_SOURCES.filter((d) => d.group === g);
        if (!rows.length) return null;
        return (
          <div className="ds-group card" key={g}>
            <h3>{g}</h3>
            <div style={{ overflowX: "auto" }}>
              <table className="data ds">
                <thead>
                  <tr>
                    <th>Dataset</th>
                    <th>What it is · what the twin does with it</th>
                    <th>Connection</th>
                    <th>Real?</th>
                    <th>Publisher updates</th>
                    <th>Freshness in the twin</th>
                    <th>Status now</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.id} id={d.id}>
                      <td className="name">
                        <b>{d.name}</b>
                        <span className="prov">{d.provider}</span>
                        {d.records && <span className="prov">{d.records}</span>}
                        {d.ref && <span className="ref">{refLinks(d.ref)}</span>}
                      </td>
                      <td className="what">
                        <div>{d.what}</div>
                        <div className="use">{d.usedFor}</div>
                      </td>
                      <td>
                        <span className={`conn ${d.connection}`} title={CONN[d.connection].hint}>{CONN[d.connection].label}</span>
                      </td>
                      <td>
                        <span className={`badge ${REAL[d.realness].cls}`} title={REAL[d.realness].hint}>{REAL[d.realness].label}</span>
                      </td>
                      <td className="small">{d.sourceCadence}</td>
                      <td className="small">{d.freshness}</td>
                      <td>
                        <Status src={d} st={status[d.id]} now={now} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <div className="row-hint">
        Real values carry <code>isSynthetic: false</code> provenance through the same pipeline as synthetic ones. Baked datasets are refreshed with{" "}
        <code>npm run bake:live</code>; the bake date is shown in the Freshness column.
      </div>

      <h1 style={{ marginTop: 28 }}>How it is calculated</h1>
      <div className="sub">
        Every number the twin derives, with its inputs, arithmetic and coefficients. The slope risk follows the PoLA chain of Prof. Limin Zhang's group at HKUST —
        Risk = P(H|R) · P(M|H,R) · P(L|H,M) · V · E — with the published Hong Kong correlations and QRA factors; terms the open data cannot supply are marked synthetic.
        Generated from <code>CALCULATIONS</code> in <code>src/core/dataSources.ts</code>.
      </div>

      {CALC_GROUPS.map((g) => {
        const rows = CALCULATIONS.filter((c) => c.group === g);
        if (!rows.length) return null;
        return (
          <div className="ds-group card" key={g}>
            <h3>{g}</h3>
            <div style={{ overflowX: "auto" }}>
              <table className="data ds">
                <thead>
                  <tr>
                    <th style={{ width: "17%" }}>Quantity</th>
                    <th style={{ width: "18%" }}>Inputs</th>
                    <th style={{ width: "43%" }}>How it is calculated</th>
                    <th style={{ width: "10%" }}>Result</th>
                    <th style={{ width: "12%" }}>Reference · code</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} id={c.id}>
                      <td className="name">
                        <b>{c.name}</b>
                        <span className="prov">{c.output}</span>
                      </td>
                      <td className="what">
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                          {c.inputs.map((x, i) => (
                            <li key={i}>{x}</li>
                          ))}
                        </ul>
                      </td>
                      <td className="what">
                        {c.how.map((x, i) => (
                          <div key={i} style={{ marginBottom: 4 }}>{x}</div>
                        ))}
                      </td>
                      <td>
                        <span className={`badge ${REAL[c.realness].cls}`} title={REAL[c.realness].hint}>{REAL[c.realness].label}</span>
                      </td>
                      <td className="small">
                        {c.reference && <div>{c.reference}</div>}
                        <div className="muted" style={{ fontFamily: "var(--mono)", fontSize: 10 }}>{c.code}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

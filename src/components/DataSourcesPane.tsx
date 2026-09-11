// Data Sources — every dataset behind the twin, rendered from the registry in src/core/dataSources.ts,
// with the live status each loader reports at runtime. Nothing here is hand-written per component:
// change the registry and this page follows.

import { useEffect, useState } from "react";
import { useStore } from "@/state/store";
import { CALCULATION_GUIDE, matchesDataSearch } from "@/core/calculationGuide";
import { openCalculation } from "./ui/Term";
import CalculationMath from "./ui/CalculationMath";
import { CALCULATION_FORMULAS, formulaSearchFields } from "@/core/calculationFormulas";

function ExplanationLink({ id, name }: { id: string; name: string }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const url = new URL(window.location.href);
  url.hash = id;
  return <span className="explanation-link">
    <a href={`#${id}`} onClick={e => { e.preventDefault(); openCalculation(id); }} aria-label={`Direct link to ${name}`}>Direct link</a>
    <button type="button" className="chip" aria-label={`Copy link to ${name}`} onClick={async () => {
      try { await navigator.clipboard.writeText(url.href); setState("copied"); }
      catch { setState("manual"); }
    }}>Copy link</button>
    <span role="status">{state === "copied" ? "Link copied" : state === "manual" ? "Copy this address:" : ""}</span>
    {state === "manual" && <input aria-label={`Link to ${name}`} readOnly value={url.href} onFocus={e => e.currentTarget.select()} />}
  </span>;
}
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
    const csdiId = r.match(/\b[a-z]+_rcd_\d+_\d+\b/)?.[0];
    const href = csdiId ? `${CSDI_PORTAL}/geoportal/rest/metadata/item/${csdiId}/html`
      : /^https?:\/\//.test(r) ? r : /^[a-z\d.-]+\.[a-z]{2,}(?:\/|$)/i.test(r) ? `https://${r}` : null;
    return (
      <span key={r}>
        {i > 0 && " · "}
        {href ? <a href={href} target="_blank" rel="noreferrer" style={{ color: "inherit" }} title={csdiId ? "CSDI dataset metadata" : href}>
          {r}
        </a> : r}
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
  const [query, setQuery] = useState("");
  const [expandTechnical, setExpandTechnical] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const reveal = () => setQuery("");
    window.addEventListener("reveal-calculation", reveal);
    return () => window.removeEventListener("reveal-calculation", reveal);
  }, []);

  const sources = DATA_SOURCES.filter(d => matchesDataSearch(query, [
    ...Object.values(d), CONN[d.connection].label, CONN[d.connection].hint,
    REAL[d.realness].label, REAL[d.realness].hint, status[d.id]?.note,
    status[d.id] ? (status[d.id].ok ? "loaded" : "failed") : "",
  ]));
  const calculations = CALCULATIONS.filter(c => matchesDataSearch(query, [
    ...Object.values(c), ...Object.values(CALCULATION_GUIDE[c.id] ?? {}), REAL[c.realness].label,
    ...formulaSearchFields(CALCULATION_FORMULAS[c.id]),
  ]));

  const real = DATA_SOURCES.filter((d) => d.realness !== "synthetic").length;
  const loaded = DATA_SOURCES.filter((d) => status[d.id]?.ok).length;

  return (
    <div>
      <h1>Data Sources</h1>
      <div className="sub">
        Every dataset the twin touches — what it is, how it reaches the running app, whether it is real, and how fresh it is. {real} of {DATA_SOURCES.length} sources are real
        or derived from published data; {loaded} have reported a successful load in this session.
      </div>

      <div className="ds-quick-guide card">
        <h3>Quick explanations</h3>
        <p>Click an underlined metric anywhere in the platform to open its explanation. Here, search a name or ordinary words,
          read the explanation first, then open the equations if needed. “Copy link” shares that exact entry.</p>
        <nav aria-label="Common calculation questions" className="ds-quick-links">
          {[
            ["calc-chain", "How is risk calculated?"], ["calc-score", "What does the score mean?"],
            ["calc-occurrence", "Chance of failure"], ["calc-residents", "How are people counted?"],
            ["calc-signals", "Are the sensors real?"], ["calc-scenario-prob", "What does a scenario mean?"],
            ["calc-uncertainty", "How uncertain is it?"], ["calc-voi", "Why collect more data?"],
          ].map(([id, label]) => <button type="button" className="chip" key={id} onClick={() => openCalculation(id)}>{label}</button>)}
        </nav>
      </div>

      <div className="ds-search card" role="search" aria-label="Data sources and calculations">
        <label htmlFor="data-source-search">Search datasets and calculations</label>
        <div className="ds-search-controls">
          <input id="data-source-search" type="search" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Try rainfall, soil pressure, census, PLL or CEDD" aria-describedby="data-source-search-count" />
          {query && <button type="button" className="chip" onClick={() => setQuery("")}>Clear search</button>}
        </div>
        <div id="data-source-search-count" className="row-hint" role="status" aria-live="polite">
          {sources.length} of {DATA_SOURCES.length} datasets · {calculations.length} of {CALCULATIONS.length} calculations.
          {" "}Search includes explanations, publishers, inputs, formulas and references. All search words must match.
        </div>
      </div>
      {sources.length === 0 && calculations.length === 0 && (
        <p className="card">No matches for “{query}”. Try a shorter term, a publisher name or a plain-language topic such as rain or movement.</p>
      )}

      <div className="ds-legend">
        {(Object.keys(CONN) as Connection[]).map((c) => (
          <span key={c} title={CONN[c].hint}>
            <span className={`conn ${c}`}>{CONN[c].label}</span> {CONN[c].hint}
          </span>
        ))}
      </div>

      {GROUPS.map((g) => {
        const rows = sources.filter((d) => d.group === g);
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
                        <ExplanationLink id={d.id} name={d.name} />
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
        “Real” means published observations or records. “Derived from real” means calculated values that may also use assumptions.
        “Synthetic” means generated for the demonstration. “Baked” means a downloaded snapshot; its date appears in the Freshness column.
      </div>

      <h1 style={{ marginTop: 28 }}>How it is calculated</h1>
      <div className="sub">
        Start with what each number means and how to read it. Open “Technical details” for the inputs, equations, assumptions and references.
        The model combines the chance of a landslide, its possible size, how far debris could travel and the people or facilities exposed.
        Published data and relationships are combined with prototype assumptions; a derived result is not itself an official measurement.
      </div>
      <details className="card calc-reading-guide">
        <summary>Help reading the formulas and engineering terms</summary>
        <p>P means probability; P(H | R) means the chance of a landslide (H) given rainfall (R). The vertical bar means “given”.
          M is landslide size, L is debris reaching a location, V is vulnerability (how severely people are affected), and E is exposure (people or assets potentially in harm’s way).</p>
        <p>Σ means add the terms; × or · means multiply; clamp(x, a, b) limits x between a and b.
          log10 uses a scale where each step is a tenfold change; ln and exp are the natural logarithm and its inverse.
          logit(p) = ln(p / (1 − p)) converts probability to log-odds; sigmoid converts it back to a value between 0 and 1.
          Coefficients are the numerical weights used by the model.</p>
        <p>1e-4 = 0.0001 = 0.01% for a probability. mm is millimetres of rain or movement; mm/h is a rate;
          m³ is cubic metres of material. Antecedent rain fell before the storm, pore pressure is water pressure inside soil,
          and runout is the distance debris travels. QRA means quantitative risk assessment.</p>
      </details>
      <label className="calc-expand"><input type="checkbox" checked={expandTechnical} onChange={e => setExpandTechnical(e.target.checked)} /> Show all technical details</label>

      {CALC_GROUPS.map((g) => {
        const rows = calculations.filter((c) => c.group === g);
        if (!rows.length) return null;
        return (
          <div className="ds-group card" key={g}>
            <h3>{g}</h3>
            {rows.map(c => (
              <article key={c.id} id={c.id} className="calc-entry" aria-labelledby={`${c.id}-title`}>
                <div className="calc-entry-heading">
                  <h4 id={`${c.id}-title`}>{c.name}</h4>
                  <span className={`badge ${REAL[c.realness].cls}`} title={REAL[c.realness].hint}>{REAL[c.realness].label}</span>
                  <ExplanationLink id={c.id} name={c.name} />
                </div>
                <p>{CALCULATION_GUIDE[c.id]?.summary}</p>
                <p className="calc-interpretation"><strong>How to read it: </strong>{CALCULATION_GUIDE[c.id]?.interpretation}</p>
                <CalculationMath key={`${c.id}-${expandTechnical}-${query.trim() !== ""}`} calculation={c} initiallyOpen={expandTechnical || query.trim() !== ""} searching={query.trim() !== ""} />
              </article>
            ))}
          </div>
        );
      })}
    </div>
  );
}

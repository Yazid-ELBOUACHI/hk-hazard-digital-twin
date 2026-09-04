// HUD elements on top of the 3D map: search, loading state, storm banner,
// an interactive legend (click a class to isolate it) and a collapsible, grouped layer panel.

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, LayerState } from "@/state/store";
import { RISK_COLORS, RiskCategory } from "@/core/types";

const LAYER_GROUPS: { title: string; items: { key: keyof LayerState; label: string; hint: string }[] }[] = [
  {
    title: "Hazard",
    items: [
      { key: "slopeRisk", label: "Slope risk", hint: "Slope polygons coloured by current risk band" },
      { key: "uncertainty", label: "Uncertainty", hint: "Purple tint where model confidence is low" },
      { key: "rainfall", label: "Rainfall", hint: "Regional rainfall intensity heatmap" },
      { key: "floodZones", label: "Flood zones", hint: "Indicative ponding areas around drainage assets" },
    ],
  },
  {
    title: "Exposure",
    items: [
      { key: "roads", label: "Roads", hint: "Road and emergency-route segments" },
      { key: "buildings", label: "Buildings", hint: "Buildings, hospitals (pink), schools (blue), rail" },
      { key: "drainage", label: "Drainage", hint: "Drainage and utility assets" },
    ],
  },
  {
    title: "Evidence",
    items: [
      { key: "sensors", label: "Sensors", hint: "Slopes with instrumentation" },
      { key: "mitigations", label: "Mitigation", hint: "Slopes with registered stabilisation works" },
      { key: "historicalLandslides", label: "Historical", hint: "Slopes with a past failure on record" },
      { key: "incidents", label: "Incidents", hint: "Active incidents (size = severity)" },
    ],
  },
];

const LEGEND: { c: RiskCategory; label: string }[] = [
  { c: "critical", label: "critical" },
  { c: "high", label: "high" },
  { c: "elevated", label: "elevated" },
  { c: "moderate", label: "moderate" },
  { c: "low", label: "low" },
  { c: "no-data", label: "insufficient data" },
];

export default function MapOverlays() {
  const layers = useStore((s) => s.layers);
  const toggleLayer = useStore((s) => s.toggleLayer);
  const slopes = useStore((s) => s.slopes);
  const assessments = useStore((s) => s.assessments);
  const selectSlope = useStore((s) => s.selectSlope);
  const flyToSlope = useStore((s) => s.flyToSlope);
  const stormMode = useStore((s) => s.stormMode);
  const stormHorizonH = useStore((s) => s.stormHorizonH);
  const setStormHorizon = useStore((s) => s.setStormHorizon);
  const weather = useStore((s) => s.weather);
  const role = useStore((s) => s.role);
  const mapLoaded = useStore((s) => s.mapLoaded);
  const riskFilter = useStore((s) => s.riskFilter);
  const toggleRiskCategory = useStore((s) => s.toggleRiskCategory);
  const resetRiskFilter = useStore((s) => s.resetRiskFilter);
  const commandCenterOpen = useStore((s) => s.commandCenterOpen);
  const sendViewCmd = useStore((s) => s.sendViewCmd);
  const basemap = useStore((s) => s.basemap);
  const setBasemap = useStore((s) => s.setBasemap);

  const [q, setQ] = useState("");
  const [layersOpen, setLayersOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    if (q.length < 2) return [];
    const ql = q.toLowerCase();
    return slopes.filter((s) => s.id.toLowerCase().includes(ql) || s.district.toLowerCase().includes(ql) || s.name.toLowerCase().includes(ql)).slice(0, 8);
  }, [q, slopes]);

  // counts per risk class for the legend (current assessment; projections are shown without counts)
  const counts = useMemo(() => {
    const c: Record<RiskCategory, number> = { low: 0, moderate: 0, elevated: 0, high: 0, critical: 0, "no-data": 0 };
    for (const s of slopes) c[assessments.get(s.id)?.category ?? "no-data"]++;
    return c;
  }, [slopes, assessments]);

  const filtered = Object.values(riskFilter).some((v) => !v);
  const layersOn = Object.values(layers).filter(Boolean).length;

  // legend rows for whichever non-risk layers are currently on
  const symbolRows: { label: string; color: string; shape: "dot" | "dot-lg" | "ring" | "line" | "area"; hint: string }[] = [];
  if (layers.buildings) {
    symbolRows.push(
      { label: "Hospital", color: "#e56db1", shape: "dot-lg", hint: "Critical asset — hover a dot for its name" },
      { label: "School", color: "#7db4ff", shape: "dot", hint: "Critical asset" },
      { label: "Rail segment", color: "#9a86e8", shape: "dot", hint: "Rail asset" },
      { label: "Building", color: "#8fa2ba", shape: "dot", hint: "Residential block" }
    );
  }
  if (layers.roads) symbolRows.push({ label: "Road / emergency route", color: "#5b7ea8", shape: "line", hint: "Road network segments" });
  if (layers.incidents) symbolRows.push({ label: "Active incident (size = severity)", color: "#ff6b5b", shape: "ring", hint: "Ongoing landslide, rockfall or flooding" });
  if (layers.sensors) symbolRows.push({ label: "Instrumented slope", color: "#ffd76b", shape: "dot", hint: "Slope with sensors" });
  if (layers.mitigations) symbolRows.push({ label: "Mitigated slope", color: "#43d19a", shape: "dot", hint: "Registered stabilisation works" });
  if (layers.historicalLandslides) symbolRows.push({ label: "Past failure", color: "#e04a3a", shape: "ring", hint: "Historical landslide on record" });
  if (layers.drainage) symbolRows.push({ label: "Drainage / utility", color: "#38b6d8", shape: "dot", hint: "Drainage culvert or utility asset" });
  if (layers.floodZones) symbolRows.push({ label: "Indicative flood zone", color: "#3d8bfd", shape: "area", hint: "Ponding area around drainage assets" });

  // refresh projection colors while storm mode is on
  useEffect(() => {
    if (!stormMode) return;
    void useStore.getState().refreshDerived(true);
  }, [stormMode, stormHorizonH]);

  // "/" focuses search (when not typing elsewhere)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      {!mapLoaded && (
        <div className="map-loading">
          <span className="spinner" /> Loading terrain and risk overlays…
        </div>
      )}

      {role !== "public" && (
        <div className="map-search">
          <input
            ref={searchRef}
            placeholder="Search slope ID or district…  ( / )"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setQ(""); (e.target as HTMLInputElement).blur(); }
              if (e.key === "Enter" && results[0]) { setQ(""); selectSlope(results[0].id); flyToSlope(results[0].id); }
            }}
          />
          {results.length > 0 && (
            <div className="results">
              {results.map((s) => (
                <div
                  key={s.id}
                  onClick={() => {
                    setQ("");
                    selectSlope(s.id);
                    flyToSlope(s.id);
                  }}
                >
                  <span style={{ fontFamily: "var(--mono)", fontWeight: 600 }}>{s.id}</span>
                  <span style={{ color: "var(--text-2)", marginLeft: 8 }}>{s.district}</span>
                  <span className={`badge ${assessments.get(s.id)?.category ?? "no-data"}`} style={{ float: "right", fontSize: 9 }}>
                    {assessments.get(s.id)?.score ?? "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {stormMode && mapLoaded && (
        <div className="storm-banner">
          <b>⛈ {weather?.stormName ?? "Storm scenario"}</b>
          <span>Heavy band in ~{weather?.stormEtaHours ?? 8} h — map shows projected risk at</span>
          <input type="range" min={0} max={24} step={1} value={stormHorizonH} onChange={(e) => setStormHorizon(+e.target.value)} />
          <b style={{ fontFamily: "var(--mono)" }}>+{stormHorizonH} h</b>
        </div>
      )}

      {!commandCenterOpen && (
        <div className="map-legend">
          <h4>Risk level {stormMode ? `(projected +${stormHorizonH} h)` : ""}</h4>
          {LEGEND.map(({ c, label }) => (
            <div
              className={`legend-row clickable ${riskFilter[c] ? "" : "off"}`}
              key={c}
              onClick={() => toggleRiskCategory(c)}
              title={filtered ? (riskFilter[c] ? "Hide this class" : "Show this class") : "Show only this class"}
            >
              <div className="legend-swatch" style={{ background: RISK_COLORS[c] }} />
              {label}
              {!stormMode && <span className="cnt">{counts[c]}</span>}
            </div>
          ))}
          {layers.uncertainty && (
            <>
              <h4 style={{ marginTop: 8 }}>Uncertainty</h4>
              <div className="legend-row">
                <div className="legend-swatch" style={{ background: "rgba(186,85,255,0.75)" }} /> low confidence
              </div>
            </>
          )}
          {symbolRows.length > 0 && (
            <>
              <h4 style={{ marginTop: 8 }}>Map symbols</h4>
              {symbolRows.map((r) => (
                <div className="legend-row" key={r.label} title={r.hint}>
                  <span className={`sym ${r.shape}`} style={{ color: r.color }} />
                  {r.label}
                </div>
              ))}
            </>
          )}
          <div className="legend-foot">
            {filtered ? (
              <>
                <span>Filtered view</span>
                <button onClick={resetRiskFilter}>show all</button>
              </>
            ) : (
              <span>Click a class to isolate it</span>
            )}
          </div>
        </div>
      )}

      <div className="cam-controls" title="Zoom, rotate and tilt the 3D view. Scroll to zoom; right-drag (or Ctrl+drag) to rotate.">
        <button onClick={() => sendViewCmd("zoom", 1)} title="Zoom in">+</button>
        <button onClick={() => sendViewCmd("zoom", -1)} title="Zoom out">−</button>
        <span className="sep" />
        <button onClick={() => sendViewCmd("rotate", -30)} title="Rotate left 30°">↺</button>
        <button onClick={() => sendViewCmd("north")} title="Reset to north">N</button>
        <button onClick={() => sendViewCmd("rotate", 30)} title="Rotate right 30°">↻</button>
        <span className="sep" />
        <button onClick={() => sendViewCmd("tilt", 15)} title="Tilt more (bird's eye → oblique)">⤒</button>
        <button onClick={() => sendViewCmd("tilt", -15)} title="Tilt less (flatter view)">⤓</button>
        <span className="sep" />
        <button onClick={() => sendViewCmd("home")} title="Reset view to all of Hong Kong">⌂</button>
        <span className="sep" />
        <button
          className={basemap === "satellite" ? "on" : ""}
          onClick={() => setBasemap(basemap === "light" ? "satellite" : basemap === "satellite" ? "dark" : "light")}
          title={basemap === "light" ? "Basemap: light — click for satellite" : basemap === "satellite" ? "Basemap: satellite — click for dark" : "Basemap: dark — click for light"}
        >
          {basemap === "light" ? "◑" : basemap === "satellite" ? "🛰" : "◐"}
        </button>
      </div>

      {role !== "public" && (
        <div className="layer-panel">
          {layersOpen && (
            <div className="layer-sheet">
              <div className="layer-group">
                <h5>Basemap</h5>
                <div className="chips">
                  <button className={`chip ${basemap === "light" ? "on" : ""}`} onClick={() => setBasemap("light")} title="Light vector map with 3D buildings (OpenFreeMap Positron)">
                    ◑ Light
                  </button>
                  <button className={`chip ${basemap === "dark" ? "on" : ""}`} onClick={() => setBasemap("dark")} title="Dark vector map with 3D buildings (OpenFreeMap)">
                    ◐ Dark
                  </button>
                  <button className={`chip ${basemap === "satellite" ? "on" : ""}`} onClick={() => setBasemap("satellite")} title="Satellite imagery (Esri World Imagery)">
                    🛰 Satellite
                  </button>
                </div>
              </div>
              {LAYER_GROUPS.map((g) => (
                <div className="layer-group" key={g.title}>
                  <h5>{g.title}</h5>
                  <div className="chips">
                    {g.items.map((l) => (
                      <button key={l.key} className={`chip ${layers[l.key] ? "on" : ""}`} onClick={() => toggleLayer(l.key)} title={l.hint}>
                        {l.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div className="foot">
                <span>{layersOn} of {Object.keys(layers).length} layers shown</span>
                <button onClick={() => setLayersOpen(false)}>close</button>
              </div>
            </div>
          )}
          <button className="layer-toggle" onClick={() => setLayersOpen((v) => !v)} title="Choose which map layers to show">
            ◧ Layers <span className="n">{layersOn}</span>
          </button>
        </div>
      )}
    </>
  );
}

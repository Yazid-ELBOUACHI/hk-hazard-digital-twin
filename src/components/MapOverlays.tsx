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
      { key: "rain3d", label: "Rain in 3D", hint: "Rain falling over the terrain whenever the top-bar intensity is above zero — HKO live when available, plus the storm scenario. The drops are synthetic; the intensity is real." },
      { key: "floodZones", label: "Flood zones", hint: "Indicative ponding areas around drainage assets" },
    ],
  },
  {
    title: "Exposure",
    items: [
      { key: "roads", label: "Roads", hint: "REAL DATA — LandsD road centrelines by class; loads per viewport from zoom 13" },
      { key: "buildings", label: "Buildings & facilities", hint: "REAL DATA — HA hospitals, EDB schools & kindergartens, FSD fire stations, police stations, DH clinics, and LandsD building blocks within 150 m of each slope" },
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
  {
    title: "Live HK data · CSDI / HKO",
    items: [
      { key: "csdiSlopes", label: "Registered slopes", hint: "REAL DATA — CEDD Catalogue of Slopes (61,000+ registered man-made slopes). Zoom in to load the polygons around your view." },
      { key: "csdiLpm", label: "LPM works", hint: "REAL DATA — CEDD LPMitP programme: 386 substandard government slopes and 113 hillside catchments under upgrading contracts, with contract and dates" },
      { key: "csdiLandslides", label: "Landslide history", hint: "REAL DATA — CEDD landslide incident records (~11,000 points with dates and locations)" },
      { key: "csdiEntli", label: "Natural terrain landslides", hint: "REAL DATA — ENTLI: 113,000 natural terrain landslide crowns 1924–2023 as a density grid; zoom to 13+ for individual crowns and runout trails" },
      { key: "csdiBlackspots", label: "Flood blackspots", hint: "REAL DATA — DSD flooding blackspots currently on record, with causes and mitigation status" },
      { key: "liveRain", label: "Rain gauges (live)", hint: "REAL DATA — HKO automatic weather stations: rainfall in the past hour, refreshed every 5 minutes" },
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
  const map3d = useStore((s) => s.map3d);
  const sim3dActive = useStore((s) => s.sim3dActive);
  const sim3dImpact = useStore((s) => s.sim3dImpact);
  const setSim3d = useStore((s) => s.setSim3d);
  const simResult = useStore((s) => s.simResult);
  const animPlaying = useStore((s) => s.animPlaying);
  const animTimeSec = useStore((s) => s.animTimeSec);
  const setAnim = useStore((s) => s.setAnim);

  // the Scenario tab's playback clock unmounts with the command centre, so the 3D HUD keeps its own — at half the
  // tab's pace (2 sim s per real s): the cinematic view needs the 60 s to unfold over half a minute, not 15 s
  useEffect(() => {
    if (!sim3dActive || !animPlaying) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      if (now - last < 50) {
        raf = requestAnimationFrame(loop);
        return;
      }
      const st = useStore.getState();
      const next = st.animTimeSec + ((now - last) / 1000) * st.animSpeed * 2;
      last = now;
      if (next >= 60) st.setAnim({ timeSec: 60, playing: false });
      else {
        st.setAnim({ timeSec: next });
        raf = requestAnimationFrame(loop);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sim3dActive, animPlaying]);

  // cinematic mode: the side panels, legend, search and banners step aside while the playback runs (styles.ux.css)
  useEffect(() => {
    document.body.classList.toggle("sim3d-mode", sim3dActive);
    return () => document.body.classList.remove("sim3d-mode");
  }, [sim3dActive]);
  const setMap3d = useStore((s) => s.setMap3d);

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
      { label: "Hospital (HA)", color: "#e56db1", shape: "dot-lg", hint: "Hospital Authority hospital — hover for its name" },
      { label: "Fire station (FSD)", color: "#ff6b3d", shape: "dot", hint: "Fire Services Department station" },
      { label: "Police station", color: "#b9a9f5", shape: "dot", hint: "Police district / division station" },
      { label: "School (EDB)", color: "#7db4ff", shape: "dot", hint: "Government, aided, DSS, private, international, ESF and special schools" },
      { label: "Kindergarten (EDB)", color: "#9ec5ff", shape: "dot", hint: "Registered kindergarten" },
      { label: "Clinic (DH)", color: "#66d4cf", shape: "dot", hint: "Department of Health clinic / health centre" },
      { label: "Building block (LandsD)", color: "#8fa2ba", shape: "dot", hint: "LandsD building block within 150 m of a registered slope, with height" }
    );
  }
  if (layers.roads) symbolRows.push({ label: "Road centreline (LandsD) · zoom 13+", color: "#5b7ea8", shape: "line", hint: "Expressway / trunk / primary roads drawn wider and warmer" });
  if (layers.incidents) symbolRows.push({ label: "Active incident (size = severity)", color: "#ff6b5b", shape: "ring", hint: "Ongoing landslide, rockfall or flooding" });
  if (layers.sensors) symbolRows.push({ label: "Instrumented slope", color: "#ffd76b", shape: "dot", hint: "Slope with sensors" });
  if (layers.mitigations) symbolRows.push({ label: "Mitigated slope", color: "#43d19a", shape: "dot", hint: "Registered stabilisation works" });
  if (layers.historicalLandslides) symbolRows.push({ label: "Past failure", color: "#e04a3a", shape: "ring", hint: "Historical landslide on record" });
  if (layers.drainage) symbolRows.push({ label: "Drainage / utility", color: "#38b6d8", shape: "dot", hint: "Drainage culvert or utility asset" });
  if (layers.floodZones) symbolRows.push({ label: "Indicative flood zone", color: "#3d8bfd", shape: "area", hint: "Ponding area around drainage assets" });
  if (layers.csdiSlopes) symbolRows.push({ label: "Registered slope (CEDD, live)", color: "#18b8a6", shape: "area", hint: "Real Catalogue of Slopes polygon — zoom in to load" });
  if (layers.csdiLandslides) symbolRows.push({ label: "Past landslide (CEDD, live)", color: "#ff9d42", shape: "dot", hint: "Real landslide incident record" });
  if (layers.csdiBlackspots) symbolRows.push({ label: "Flood blackspot (DSD, live)", color: "#63b3ff", shape: "ring", hint: "Real DSD flooding blackspot" });
  if (layers.csdiLpm) symbolRows.push({ label: "LPM works: slope / catchment (CEDD, live)", color: "#e8862e", shape: "area", hint: "Real LPMitP upgrading works — amber slopes, gold hillside catchments" });
  if (layers.csdiEntli) {
    symbolRows.push({ label: "Landslide density, 250 m cells (ENTLI)", color: "#df5a2b", shape: "area", hint: "Natural terrain landslide crowns per cell — darker is denser; zoom to 13+ for individual crowns and trails" });
    symbolRows.push({ label: "Crown / trail: recent · relict", color: "#b08968", shape: "dot", hint: "Rust = dated recent landslide, tan = relict (pre-1963 baseline)" });
  }
  if (layers.liveRain) symbolRows.push({ label: "Rain gauge, past hour (HKO, live)", color: "#3d8bfd", shape: "dot-lg", hint: "Circle grows with the past-hour rainfall — hover for the reading" });

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
            aria-label="Search slopes by ID, name or district"
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
              onClick={() => {
                if (!filtered && counts[c] === 0) return; // isolating an empty class would blank the map
                toggleRiskCategory(c);
              }}
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

      {sim3dActive && (
        <div className="sim3d-hud">
          <div className="sim3d-title">
            3D playback <span className="tag">illustrative</span>
            {simResult && (
              <span className="sim3d-sub">
                {simResult.params.rainfallMm} mm / {simResult.params.rainfallDurationH} h · runout {simResult.runoutDistanceM} m
                {sim3dImpact ? ` · ${sim3dImpact.phase} · front ${sim3dImpact.frontM} m` : ""}
              </span>
            )}
          </div>
          <div className="sim3d-tally">
            <span><b>{sim3dImpact?.buildings ?? 0}</b> buildings hit</span>
            <span><b>{sim3dImpact?.roads ?? 0}</b> road segments</span>
            <span><b>{sim3dImpact?.people ?? 0}</b> people</span>
            <span><b>{sim3dImpact?.vehicles ?? 0}</b> vehicles</span>
          </div>
          <div className="sim3d-controls">
            <button onClick={() => setAnim({ playing: !animPlaying })} title={animPlaying ? "Pause" : "Play"}>{animPlaying ? "⏸" : "▶"}</button>
            <button onClick={() => setAnim({ timeSec: 0, playing: true })} title="Restart">⟲</button>
            <input type="range" min={0} max={60} step={0.5} value={animTimeSec} onChange={(e) => setAnim({ timeSec: +e.target.value, playing: false })} />
            <span className="t">{animTimeSec.toFixed(0)} s</span>
            <button onClick={() => setSim3d(false)} title="Back to the Command Center">Exit</button>
          </div>
          <div className="sim3d-note">Runout is the scenario engine's result, not a physical simulation. People and vehicles are synthetic placements on real LandsD road centrelines.</div>
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
        <button className={`mode ${map3d ? "on" : ""}`} onClick={() => setMap3d(!map3d)} title={map3d ? "3D view: terrain and buildings. Click for a flat 2D map." : "2D view. Click for 3D terrain and buildings."}>
          {map3d ? "3D" : "2D"}
        </button>
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

import { useEffect, useState } from "react";
import { LATEST_RELEASE, latestSeen } from "@/core/changelog";
import { useStore } from "./state/store";
import TopBar from "./components/TopBar";
import KpiPanel from "./components/KpiPanel";
import RightPanel from "./components/RightPanel";
import MapView from "./components/MapView";
import MapOverlays from "./components/MapOverlays";
import SlopeCommandCenter from "./components/scc/SlopeCommandCenter";
import EmergencyPanel from "./components/EmergencyPanel";
import PlanningView from "./components/PlanningView";
import ReportsView from "./components/ReportsView";
import AskTwinView from "./components/AskTwinView";
import { installSliderFill } from "./ui/sliders";
import { openCalculation } from "./components/ui/Term";
import { CALCULATIONS, DATA_SOURCES } from "./core/dataSources";

export default function App() {
  const ready = useStore((s) => s.ready);
  const view = useStore((s) => s.view);
  const role = useStore((s) => s.role);
  const commandCenterOpen = useStore((s) => s.commandCenterOpen);
  const sim3dActive = useStore((s) => s.sim3dActive);
  const stormMode = useStore((s) => s.stormMode);
  const setStormMode = useStore((s) => s.setStormMode);
  const setView = useStore((s) => s.setView);
  const setReportsTab = useStore((s) => s.setReportsTab);
  const [whatsNewUnseen, setWhatsNewUnseen] = useState(() => !latestSeen());

  useEffect(() => {
    void useStore.getState().init();
  }, []);

  // simulation clock: tick once per real second
  useEffect(() => {
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      useStore.getState().tick((now - last) / 1000);
      last = now;
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // iOS-style filled range sliders
  useEffect(() => installSliderFill(), []);

  // Shared explanation links work on first load and when following a new fragment.
  useEffect(() => {
    if (!ready) return;
    const followExplanation = () => {
      const id = window.location.hash.slice(1);
      if ([...CALCULATIONS, ...DATA_SOURCES].some(entry => entry.id === id)) openCalculation(id);
    };
    followExplanation();
    window.addEventListener("hashchange", followExplanation);
    return () => window.removeEventListener("hashchange", followExplanation);
  }, [ready]);

  if (!ready) {
    return (
      <div className="loading-screen">
        Loading Hong Kong open data — CEDD slope inventory &amp; works programme, landslide records, census, HKO live rainfall…
      </div>
    );
  }

  const mapVisible = view === "overview" || view === "emergency";
  const inspecting = commandCenterOpen && role !== "public";

  return (
    <div className="app">
      <div className="synth-banner">
        <div className="provenance-intro">
          <span className="pill">Prototype</span>
          <span className="provenance-title">Data provenance</span>
        </div>
        <div className="provenance-item real-source">
          <span className="source-dot" />
          <b>Observed</b>
          <span>CEDD slopes · incidents · HKO rain · census</span>
        </div>
        <div className="provenance-item synthetic-source">
          <span className="source-dot" />
          <b>Modelled</b>
          <span>risk · sensors · scenarios · forecast</span>
        </div>
        <div className="subheader-actions">
        <span className="credit" title="Basemap and imagery credits">
          Map: <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> ·{" "}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OSM</a> · Esri · Mapzen ·{" "}
          <a href="https://github.com/KhronosGroup/glTF-Sample-Assets" target="_blank" rel="noreferrer">Cesium</a>
        </span>
        <button
          className="banner-link"
          onClick={() => {
            setReportsTab("sources");
            setView("reports");
          }}
          title="Search what each metric means, how it is calculated, and where its data comes from"
        >
          Data & explanations →
        </button>
        <button
          className={`banner-link ${whatsNewUnseen ? "glow" : ""}`}
          onClick={() => {
            setReportsTab("whatsnew");
            setView("reports");
            setWhatsNewUnseen(false);
          }}
          title={`Latest: ${LATEST_RELEASE.title} (${LATEST_RELEASE.date})`}
        >
          {whatsNewUnseen && <span className="new-dot" />}What's new →
        </button>
        </div>
      </div>
      <TopBar />
      {view === "emergency" && (
        <div className="em-header response-explanation">
          <strong>Response planning · demonstration</strong>
          <span>Decide which slopes to inspect first and explore where teams could be sent. Selecting this view does not declare an emergency or dispatch anyone.</span>
        </div>
      )}
      {stormMode && <div className="em-header storm-context" role="status">
        <strong>Simulated storm is active</strong>
        <span>Rainfall inputs include a fictional storm. Map colours show projected risk at the selected forecast hour.</span>
        <button type="button" className="chip" onClick={() => setStormMode(false)}>Stop simulated storm</button>
      </div>}
      <div className="main">
        {(
          <>
            {view === "overview" && role !== "public" && !inspecting && !sim3dActive && <KpiPanel />}
            <div className="map-wrap" style={mapVisible ? undefined : { display: "none" }}>
              <MapView />
              <MapOverlays />
            </div>
            {view === "overview" && !inspecting && !sim3dActive && <RightPanel />}
            {view === "emergency" && !inspecting && !sim3dActive && <EmergencyPanel />}
            {mapVisible && inspecting && <SlopeCommandCenter />}
          </>
        )}
        {view === "planning" && <PlanningView />}
        {view === "reports" && <ReportsView />}
        {view === "ask" && <AskTwinView />}
      </div>
    </div>
  );
}

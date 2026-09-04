import { useEffect } from "react";
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

export default function App() {
  const ready = useStore((s) => s.ready);
  const view = useStore((s) => s.view);
  const role = useStore((s) => s.role);
  const commandCenterOpen = useStore((s) => s.commandCenterOpen);

  useEffect(() => {
    void useStore.getState().init();
  }, []);

  // simulation clock: tick once per real second
  useEffect(() => {
    const id = setInterval(() => useStore.getState().tick(1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!ready) {
    return (
      <div className="loading-screen">
        Generating synthetic Hong Kong dataset — 5,000 slopes, assets, sensors…
      </div>
    );
  }

  const mapVisible = view === "overview" || view === "emergency";

  return (
    <div className="app">
      <div className="synth-banner">
        Synthetic data prototype — all slopes, sensors, risks &amp; simulations are generated. Not real Hong Kong government data.
      </div>
      <TopBar />
      {view === "emergency" && (
        <div className="em-header">
          <span style={{ animation: "pulse-storm 1.5s infinite", borderRadius: 4, padding: "1px 8px", background: "#7c1d1d" }}>●</span>
          Emergency Operations Mode — Landslide &amp; Flood Response
        </div>
      )}
      <div className="main">
        {mapVisible && (
          <>
            {view === "overview" && role !== "public" && <KpiPanel />}
            <div className="map-wrap">
              <MapView />
              <MapOverlays />
            </div>
            {view === "overview" && <RightPanel />}
            {view === "emergency" && <EmergencyPanel />}
            {commandCenterOpen && role !== "public" && <SlopeCommandCenter />}
          </>
        )}
        {view === "planning" && <PlanningView />}
        {view === "reports" && <ReportsView />}
        {view === "ask" && <AskTwinView />}
      </div>
    </div>
  );
}

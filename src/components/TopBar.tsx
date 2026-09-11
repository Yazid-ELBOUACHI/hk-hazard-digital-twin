import { useStore, ViewId } from "@/state/store";
import { fmtClock } from "@/core/format";
import type { Role } from "@/core/types";
import { useState } from "react";

const VIEWS: { id: ViewId; label: string; roles: Role[]; hint: string }[] = [
  { id: "overview", label: "Overview", roles: ["public", "engineer", "emergency", "admin"], hint: "City-wide risk map and indicators" },
  { id: "emergency", label: "Response planning", roles: ["engineer", "emergency", "admin"], hint: "Explore which slopes need attention and where demonstration teams could be sent" },
  { id: "planning", label: "Planning", roles: ["engineer", "emergency", "admin"], hint: "Where to spend a fixed mitigation budget" },
  { id: "reports", label: "Reports", roles: ["engineer", "emergency", "admin"], hint: "Situation report and model validation" },
  { id: "ask", label: "Ask the Twin", roles: ["engineer", "emergency", "admin"], hint: "Plain-language questions over the twin state" },
];

const SPEEDS = [
  { v: 0, label: "⏸", hint: "Pause the simulation clock" },
  { v: 1, label: "1×", hint: "Real time: 1 second per second (Hong Kong time)" },
  { v: 10, label: "10×", hint: "10 simulated seconds per real second" },
  { v: 60, label: "60×", hint: "1 simulated minute per real second" },
];

export default function TopBar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const gameTime = useStore((s) => s.gameTime);
  const speed = useStore((s) => s.speed);
  const setSpeed = useStore((s) => s.setSpeed);
  const role = useStore((s) => s.role);
  const setRole = useStore((s) => s.setRole);
  const stormMode = useStore((s) => s.stormMode);
  const setStormMode = useStore((s) => s.setStormMode);
  const weather = useStore((s) => s.weather);
  const [stormHelp, setStormHelp] = useState(false);

  return (
    <div className="topbar">
      <div className="brand">
        <a className="brand-mark hkust-mark" href="https://hkust.edu.hk" target="_blank" rel="noreferrer" aria-label="Hong Kong University of Science and Technology">
          <img src="/brand/hkust-emblem.svg" alt="HKUST" width="26" height="38" />
        </a>
        <div>
          <div className="brand-title">Hong Kong Landslide &amp; Flood Digital Twin</div>
          <div className="brand-sub">HKUST Research · Hazard Intelligence · Prototype</div>
        </div>
      </div>

      <div className="nav">
        {VIEWS.filter((v) => v.roles.includes(role)).map((v) => (
          <button key={v.id} className={view === v.id ? "active" : ""} onClick={() => setView(v.id)} title={v.hint}>
            {v.label}
          </button>
        ))}
      </div>

      <div className="spacer" />

      {role !== "public" && (
        <div className="storm-control">
          <button type="button" className={`storm-toggle ${stormMode ? "active" : ""}`}
            aria-expanded={stormHelp} aria-controls="storm-explanation" onClick={() => setStormHelp(!stormHelp)}>
            {stormMode ? "Simulated storm: ON" : "Simulate a storm"}
          </button>
          {stormHelp && <section id="storm-explanation" className="storm-explanation" aria-label="About the storm simulation" onKeyDown={e => { if (e.key === "Escape") setStormHelp(false); }}>
            <h3>What if a heavy storm arrives?</h3>
            <p>Add a fictional city-wide rainstorm to the rainfall inputs and explore how the modelled slope risks change.</p>
            <p>On the map, move the forecast-hours slider to compare projected risk over the next 24 hours. Rain and risk panels also include the simulated storm as the platform clock advances.</p>
            <p>This is a what-if exercise, not an official weather warning or a forecast that this storm will happen.</p>
            <button type="button" className="chip" onClick={() => { setStormMode(!stormMode); if (!stormMode) setView("overview"); setStormHelp(false); }}>
              {stormMode ? "Stop simulated storm" : "Start simulated storm"}
            </button>
            <button type="button" className="chip" onClick={() => setStormHelp(false)}>Close explanation</button>
          </section>}
        </div>
      )}

      <div
        className="clockbox"
        title={
          weather?.live
            ? `Rainfall intensity: LIVE from HKO (${weather.live.stations} stations, observation ${weather.live.obsTime.slice(11, 16)} HKT). Clock and playback speed are simulated.`
            : "Simulation clock (synthetic). Rainfall intensity now, simulated time, playback speed."
        }
      >
        <span>
          🌧 {weather ? `${weather.rainfallRateMmHr.value} mm/hr` : "—"}
          {weather?.live && <span className="live-dot" title="Live HKO rainfall">●</span>}
        </span>
        <span className="time">{fmtClock(gameTime)}{speed !== 1 && <small className="clock-mode">{speed === 0 ? "Paused" : "Simulated"}</small>}</span>
        <div className="speed-btns">
          {SPEEDS.map((s) => (
            <button key={s.v} className={speed === s.v ? "active" : ""} onClick={() => setSpeed(s.v)} title={s.hint} aria-label={s.hint} aria-pressed={speed === s.v}>
              {s.v === 0 ? (
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <rect x="2" y="1" width="3" height="10" rx="0.8" fill="currentColor" />
                  <rect x="7" y="1" width="3" height="10" rx="0.8" fill="currentColor" />
                </svg>
              ) : s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="role-wrap" title="Role-based interface: each role sees the views and detail it needs">
        <span className="lbl">Role</span>
        <select className="role-select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="public">Public</option>
          <option value="engineer">Engineer</option>
          <option value="emergency">Emergency Manager</option>
          <option value="admin">Admin / Researcher</option>
        </select>
      </div>
    </div>
  );
}

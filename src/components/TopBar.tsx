import { useStore, ViewId } from "@/state/store";
import { fmtClock } from "@/core/format";
import type { Role } from "@/core/types";

const VIEWS: { id: ViewId; label: string; roles: Role[]; hint: string }[] = [
  { id: "overview", label: "Overview", roles: ["public", "engineer", "emergency", "admin"], hint: "City-wide risk map and indicators" },
  { id: "emergency", label: "Emergency", roles: ["engineer", "emergency", "admin"], hint: "Operations view: threats, deployments, incidents" },
  { id: "planning", label: "Planning", roles: ["engineer", "emergency", "admin"], hint: "Where to spend a fixed mitigation budget" },
  { id: "reports", label: "Reports", roles: ["engineer", "emergency", "admin"], hint: "Situation report and model validation" },
  { id: "ask", label: "Ask the Twin", roles: ["engineer", "emergency", "admin"], hint: "Plain-language questions over the twin state" },
];

const SPEEDS = [
  { v: 0, label: "⏸", hint: "Pause the simulation clock" },
  { v: 60, label: "1×", hint: "1 real second = 1 simulated minute" },
  { v: 600, label: "10×", hint: "1 real second = 10 simulated minutes" },
  { v: 3600, label: "60×", hint: "1 real second = 1 simulated hour" },
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

  return (
    <div className="topbar">
      <div className="brand">
        <div className="brand-mark">HK</div>
        <div>
          <div className="brand-title">Hong Kong Landslide &amp; Flood Digital Twin</div>
          <div className="brand-sub">Simulation-Enabled Decision Support · Prototype</div>
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
        <button
          className={`storm-toggle ${stormMode ? "active" : ""}`}
          onClick={() => setStormMode(!stormMode)}
          title={stormMode ? "Storm scenario active — the map shows projected risk. Click to end it." : "Inject a synthetic city-wide rainstorm and preview projected risk"}
        >
          {stormMode ? "◉ Storm Watch Active" : "Storm Watch"}
        </button>
      )}

      <div className="clockbox" title="Simulation clock (synthetic). Rainfall intensity now, simulated time, playback speed.">
        <span>🌧 {weather ? `${weather.rainfallRateMmHr.value} mm/hr` : "—"}</span>
        <span className="time">{fmtClock(gameTime)}</span>
        <div className="speed-btns">
          {SPEEDS.map((s) => (
            <button key={s.v} className={speed === s.v ? "active" : ""} onClick={() => setSpeed(s.v)} title={s.hint}>
              {s.label}
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

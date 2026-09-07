// Scenario Lab. Guided flow: pick a preset (or tune the two primary drivers), run a baseline,
// then add interventions and compare. Fine-grained parameters are one click away, not in the face.

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/state/store";
import { registry } from "@/core/registry";
import { fmtInt } from "@/core/format";
import type { InterventionOption, InterventionType, RiskAssessment, ScenarioParams, SimulationResult, Slope } from "@/core/types";
import { SIM_DISCLAIMER } from "@/core/types";
import SlopeDiagram from "./SlopeDiagram";
import Collapsible from "../ui/Collapsible";

const MODES = [
  { id: "instant" as const, label: "Instant", sub: "precomputed library · <1 s", hint: "Interpolates a precomputed scenario library. Fastest, least specific." },
  { id: "fast" as const, label: "Fast", sub: "reduced-order model · ~2 s", hint: "Reduced-order model. Good default for what-if exploration." },
  { id: "hifi" as const, label: "High-fidelity", sub: "staged solver · ~10 s", hint: "Staged solver run. Use for the final comparison you will act on." },
];

type NumKey = Exclude<keyof ScenarioParams, "interventions">;

/** Enter the 3D playback: the clock only starts once the cinematic camera move has landed. */
function startWatch3d() {
  const st = useStore.getState();
  st.setSim3d(true);
  st.setAnim({ timeSec: 0, playing: false });
  setTimeout(() => useStore.getState().sim3dActive && useStore.getState().setAnim({ playing: true }), 3200);
}

export default function ScenarioTab({ slope, assessment }: { slope: Slope; assessment: RiskAssessment }) {
  const params = useStore((s) => s.scenarioParams);
  const setParams = useStore((s) => s.setScenarioParams);
  const resetParams = useStore((s) => s.resetScenarioParams);
  const simMode = useStore((s) => s.simMode);
  const setSimMode = useStore((s) => s.setSimMode);
  const runScenario = useStore((s) => s.runScenario);
  const job = useStore((s) => s.activeJob);
  const result = useStore((s) => s.simResult);
  const comparisons = useStore((s) => s.comparisonResults);
  const clearComparison = useStore((s) => s.clearComparison);
  const kpi = useStore((s) => s.kpi);

  const [catalog, setCatalog] = useState<InterventionOption[]>([]);
  const [selectedIv, setSelectedIv] = useState<InterventionType[]>([]);
  const [preset, setPreset] = useState<string>("custom");

  useEffect(() => {
    void registry.interventions.getCatalog().then(setCatalog);
  }, []);

  const running = !!job && (job.status === "running" || job.status === "queued");

  const PRESETS: { id: string; label: string; hint: string; patch: Partial<ScenarioParams> }[] = [
    { id: "forecast", label: `Forecast next 24 h (${kpi?.forecastRainfallMm ?? 120} mm)`, hint: "Use the synthetic 24-hour forecast as the rainfall event", patch: { rainfallMm: kpi?.forecastRainfallMm ?? 120, rainfallDurationH: 24 } },
    { id: "black", label: "Black rainstorm (250 mm / 6 h)", hint: "Short, very intense event", patch: { rainfallMm: 250, rainfallDurationH: 6, soilSaturationPct: 85 } },
    { id: "extreme", label: "Extreme (500 mm / 24 h)", hint: "Stress test at the top of the range", patch: { rainfallMm: 500, rainfallDurationH: 24, soilSaturationPct: 95, groundwaterDeltaPct: 30 } },
  ];

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    setParams(p.patch);
    setPreset(p.id);
  };

  const P = (label: string, key: NumKey, min: number, max: number, step: number, unit: string, hint?: string) => (
    <div className="param-row" key={key} title={hint}>
      <label>{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={params[key]}
        onChange={(e) => {
          setParams({ [key]: +e.target.value } as Partial<ScenarioParams>);
          setPreset("custom");
        }}
      />
      <span className="val">
        {Math.round(params[key] * 10) / 10} {unit}
      </span>
    </div>
  );

  const runAndWatch = async () => {
    await runScenario(selectedIv);
    // the job finishes asynchronously; wait for it, then hand the result to the 3D playback
    for (let i = 0; i < 600; i++) {
      const j = useStore.getState().activeJob;
      if (j && (j.status === "done" || j.status === "failed")) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const st = useStore.getState();
    if (st.simResult?.failureLikely) startWatch3d();
  };

  const step = !result ? 1 : comparisons.length > 1 ? 3 : 2;

  return (
    <div>
      <div className="disclaimer">{SIM_DISCLAIMER}</div>

      <div className="steps">
        <div className={`step-pill ${step > 1 ? "done" : "now"}`}><span className="n">{step > 1 ? "✓" : "1"}</span> Set the storm (preset or sliders)</div>
        <div className={`step-pill ${step > 2 ? "done" : step === 2 ? "now" : ""}`}><span className="n">{step > 2 ? "✓" : "2"}</span> Run the baseline</div>
        <div className={`step-pill ${step === 3 ? "now" : ""}`}><span className="n">3</span> Add interventions &amp; compare</div>
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Storm scenario</h3>
          <div className="preset-row">
            {PRESETS.map((p) => (
              <button key={p.id} className={`chip ${preset === p.id ? "on" : ""}`} onClick={() => applyPreset(p)} title={p.hint}>
                {p.label}
              </button>
            ))}
            <button
              className="chip"
              onClick={() => {
                resetParams();
                setPreset("custom");
              }}
              title="Reset every parameter to the current-conditions default"
            >
              ↺ Reset
            </button>
          </div>
          {P("Rainfall (event total)", "rainfallMm", 20, 500, 5, "mm", "Total rainfall over the event")}
          {P("Rainfall duration", "rainfallDurationH", 1, 72, 1, "h", "Shorter duration = higher intensity")}

          <Collapsible
            title="Ground conditions"
            className="flat"
            storageKey="scc.scenario.ground"
            summary={`saturation ${params.soilSaturationPct}% · groundwater ${params.groundwaterDeltaPct > 0 ? "+" : ""}${params.groundwaterDeltaPct}% · strength ×${params.soilStrengthFactor}`}
          >
            {P("Groundwater level", "groundwaterDeltaPct", -30, 50, 5, "%", "Change vs current groundwater table")}
            {P("Soil saturation", "soilSaturationPct", 20, 100, 5, "%", "Antecedent saturation at event start")}
            {P("Pore pressure", "porePressureDeltaPct", -30, 80, 5, "%", "Change vs current pore-pressure proxy")}
            {P("Soil strength factor", "soilStrengthFactor", 0.5, 1.5, 0.05, "×", "Multiplier on cohesion / friction (uncertainty sweep)")}
            {P("Existing displacement", "existingDisplacementMm", 0, 150, 5, "mm", "Pre-existing cumulative movement")}
          </Collapsible>

          <Collapsible
            title="Defences"
            className="flat"
            storageKey="scc.scenario.defences"
            summary={`drainage ${params.drainageEfficiencyPct}% · vegetation ${params.vegetationPct}% · wall ${params.retainingWallCondition} · barrier ${params.barrierCondition}`}
          >
            {P("Drainage efficiency", "drainageEfficiencyPct", 10, 100, 5, "%", "How well surface drainage removes water")}
            {P("Vegetation cover", "vegetationPct", 0, 100, 5, "%", "Root reinforcement and interception")}
            {P("Retaining wall condition", "retainingWallCondition", 0.2, 1, 0.05, "", "1.0 = as new")}
            {P("Barrier condition", "barrierCondition", 0.2, 1, 0.05, "", "1.0 = as new")}
          </Collapsible>

          <h3 style={{ marginTop: 12 }}>Computational mode</h3>
          <div className="mode-btns">
            {MODES.map((m) => (
              <button key={m.id} className={simMode === m.id ? "active" : ""} onClick={() => setSimMode(m.id)} title={m.hint}>
                {m.label}
                <span className="sub">{m.sub}</span>
              </button>
            ))}
          </div>

          <button
            className="btn primary"
            style={{ width: "100%", padding: "12px 0", fontSize: 13.5 }}
            disabled={running}
            title="Run this storm on the slope, then play the result as a debris flow on the 3D map — real terrain and roads, synthetic people and vehicles"
            onClick={() => void runAndWatch()}
          >
            {running ? `Running — ${job?.stage}…` : "🎬 Run scenario & watch it in 3D"}
          </button>
          <button className="btn sm" style={{ width: "100%", marginTop: 6 }} disabled={running} onClick={() => void runScenario(selectedIv)} title="Run the numbers without the 3D playback">
            {result ? "↻ Re-run baseline (numbers only)" : "Run baseline (numbers only)"}
          </button>
          {running && (
            <div className="progress-outer">
              <div style={{ width: `${Math.round((job?.progress ?? 0) * 100)}%` }} />
            </div>
          )}

          <h3 style={{ marginTop: 16 }}>Virtual interventions</h3>
          <div className="chips" style={{ marginBottom: 8 }}>
            {catalog.map((c) => (
              <button
                key={c.type}
                className={`chip ${selectedIv.includes(c.type) ? "on" : ""}`}
                title={`${c.description} · ~HK$${c.costHKDm} M`}
                onClick={() => setSelectedIv((prev) => (prev.includes(c.type) ? prev.filter((x) => x !== c.type) : [...prev, c.type]))}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              className="btn sm"
              disabled={running || !result || selectedIv.length === 0}
              title={!result ? "Run a baseline first" : selectedIv.length === 0 ? "Select at least one intervention" : "Run the same storm with the selected interventions and add it to the comparison"}
              onClick={() => void runScenario(selectedIv, true)}
            >
              + Add comparison run
            </button>
            {comparisons.length > 1 && (
              <button className="btn sm" onClick={clearComparison}>
                Clear comparison
              </button>
            )}
            <span className="row-hint" style={{ marginTop: 0 }}>
              {!result ? "Run a baseline first, then pick interventions to compare." : selectedIv.length === 0 ? "Pick interventions above, then add a comparison run." : `${selectedIv.length} selected`}
            </span>
          </div>
        </div>

        <div>
          <ResultPanel slope={slope} assessment={assessment} />
        </div>
      </div>

      {comparisons.length > 1 && <ComparisonTable comparisons={comparisons} catalog={catalog} />}
    </div>
  );
}

function ResultPanel({ slope, assessment }: { slope: Slope; assessment: RiskAssessment }) {
  const result = useStore((s) => s.simResult);
  const animPlaying = useStore((s) => s.animPlaying);
  const animTimeSec = useStore((s) => s.animTimeSec);
  const animSpeed = useStore((s) => s.animSpeed);
  const setAnim = useStore((s) => s.setAnim);
  const rafRef = useRef<number>(0);

  // animation clock
  useEffect(() => {
    if (!animPlaying || !result) return;
    let last = performance.now();
    const loop = (now: number) => {
      // Updating Zustand and rebuilding map GeoJSON at display refresh rate
      // competes with camera rendering. 20 Hz is sufficient for the model frames.
      if (now - last < 50) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      const dt = ((now - last) / 1000) * animSpeed;
      last = now;
      const st = useStore.getState();
      const next = st.animTimeSec + dt * 4; // 1 real sec = 4 sim sec at 1×
      if (next >= 60) {
        st.setAnim({ timeSec: 60, playing: false });
      } else {
        st.setAnim({ timeSec: next });
        rafRef.current = requestAnimationFrame(loop);
      }
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [animPlaying, animSpeed, result]);

  if (!result) {
    return (
      <div className="card" style={{ color: "var(--text-1)", fontSize: 12.5, lineHeight: 1.7 }}>
        <h3>Result</h3>
        <p style={{ margin: "0 0 8px" }}>
          Nothing has been simulated for <b style={{ fontFamily: "var(--mono)" }}>{slope.id}</b> yet. Current risk is{" "}
          <span className={`badge ${assessment.category}`}>{assessment.category}</span> {assessment.score}/100.
        </p>
        <p style={{ margin: 0 }} className="muted">
          Choose a storm preset on the left and run the baseline. You will get a failure probability, runout and exposure, plus an animated failure
          sequence here and on the 3D terrain map.
        </p>
      </div>
    );
  }

  const frame = result.frames.reduce((best, f) => (f.tSec <= animTimeSec ? f : best), result.frames[0]);
  const bad = result.failureLikely;

  return (
    <>
      <div className={`result-banner ${bad ? "fail" : "ok"}`}>
        <div className="headline" style={{ color: bad ? "#ff8577" : "var(--risk-low)" }}>
          {bad ? "FAILURE LIKELY" : "FAILURE UNLIKELY"} — {Math.round(result.failureProbability * 100)}%
        </div>
        <div style={{ fontSize: 11, color: "var(--text-1)", marginTop: 3 }}>
          {result.mode === "instant" ? "Instant estimate (scenario library)" : result.mode === "fast" ? "Fast reduced-order simulation" : "High-fidelity staged simulation"} · confidence{" "}
          {Math.round(result.confidence * 100)}% · {result.initiationZone} · {result.params.rainfallMm} mm / {result.params.rainfallDurationH} h
        </div>
      </div>

      <div className="result-tiles">
        <div className="tile">
          <div className="tile-l">Runout</div>
          <div className="tile-v">{result.runoutDistanceM}<span className="unit">m</span></div>
        </div>
        <div className="tile">
          <div className="tile-l">People exposed</div>
          <div className="tile-v" style={{ color: result.peopleExposed > 0 ? "var(--risk-elevated)" : undefined }}>{fmtInt(result.peopleExposed)}</div>
        </div>
        <div className="tile">
          <div className="tile-l">Road impact</div>
          <div className="tile-v" style={{ fontSize: 15, color: result.roadImpact === "likely" ? "#ff8577" : result.roadImpact === "possible" ? "var(--risk-moderate)" : "var(--risk-low)" }}>{result.roadImpact}</div>
        </div>
        <div className="tile">
          <div className="tile-l">Time to failure</div>
          <div className="tile-v">{result.timeToFailureH !== null ? <>~{result.timeToFailureH}<span className="unit">h</span></> : <span className="unit" style={{ fontSize: 14 }}>n/a</span>}</div>
        </div>
      </div>

      <div className="card">
        <h3>
          Hazard propagation <span className="hint" style={{ color: "var(--text-2)" }}>also animating on the 3D map →</span>
        </h3>
        <div className="anim-canvas-wrap">
          <SlopeDiagram
            slope={slope}
            state={{
              saturation: frame.saturation,
              deformationMm: frame.deformationMm,
              debrisFrac: frame.debrisFrontM / Math.max(1, result.runoutDistanceM),
              phase: `t=${frame.tSec}s · ${frame.phase.toUpperCase()}`,
              raining: frame.phase === "rainfall" || frame.phase === "saturation",
              failed: ["initiation", "runout", "impact", "settled"].includes(frame.phase) && result.failureLikely,
            }}
          />
        </div>
        <div style={{ fontSize: 11, color: "#ffd76b", padding: "6px 2px 0", fontFamily: "var(--mono)" }}>{frame.note}</div>
        <div className="anim-controls">
          <button className="btn sm" onClick={() => setAnim({ playing: !animPlaying })}>{animPlaying ? "⏸ Pause" : "▶ Play"}</button>
          <button className="btn sm" onClick={() => setAnim({ timeSec: 0, playing: true })}>⟲ Restart</button>
          <input type="range" min={0} max={60} step={0.5} value={animTimeSec} onChange={(e) => setAnim({ timeSec: +e.target.value, playing: false })} />
          <span className="anim-phase">{animTimeSec.toFixed(0)} s / 60 s</span>
          <select className="role-select" value={animSpeed} onChange={(e) => setAnim({ speed: +e.target.value })}>
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={4}>4×</option>
          </select>
        </div>
        {result.failureLikely ? (
          <button
            className="btn primary"
            style={{ width: "100%", marginTop: 10, padding: "10px 0" }}
            title="Play this result as a debris flow on the 3D map: real terrain and road centrelines, synthetic people and vehicles, buildings lighting up as the front reaches them"
            onClick={startWatch3d}
          >
            🎬 Watch it in 3D on the map
          </button>
        ) : (
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            Failure is unlikely in this scenario, so there is no runout to play back in 3D.
          </div>
        )}
      </div>

      <Collapsible title="All predicted outputs" storageKey="scc.scenario.outputs" summary={`${fmtInt(result.displacedVolumeM3)} m³ · ${fmtInt(result.affectedAreaM2)} m² · ${result.buildingsExposed} buildings`}>
        <div className="kv">
          <span className="k">Failure probability</span><span className="v">{Math.round(result.failureProbability * 100)}%</span>
          <span className="k">Failure time estimate</span><span className="v">{result.timeToFailureH !== null ? `~${result.timeToFailureH} h` : "n/a"}</span>
          <span className="k">Displaced volume</span><span className="v">{fmtInt(result.displacedVolumeM3)} m³</span>
          <span className="k">Runout distance</span><span className="v">{result.runoutDistanceM} m</span>
          <span className="k">Max velocity</span><span className="v">{result.maxVelocityMs} m/s</span>
          <span className="k">Affected area</span><span className="v">{fmtInt(result.affectedAreaM2)} m²</span>
          <span className="k">Road impact</span><span className="v">{result.roadImpact}</span>
          <span className="k">Buildings exposed</span><span className="v">{result.buildingsExposed}</span>
          <span className="k">People exposed</span><span className="v">{fmtInt(result.peopleExposed)}</span>
          <span className="k">Barrier overtopped</span><span className="v">{result.barrierOvertopped ? "YES" : "no"}</span>
          <span className="k">Downstream flooding</span><span className="v">{result.downstreamFlooding}</span>
        </div>
      </Collapsible>
    </>
  );
}

function ComparisonTable({ comparisons, catalog }: { comparisons: SimulationResult[]; catalog: InterventionOption[] }) {
  const label = (r: SimulationResult, i: number) => {
    if (r.params.interventions.length === 0) return i === 0 ? "Baseline (no intervention)" : `Run ${i + 1}`;
    return r.params.interventions.map((t) => catalog.find((c) => c.type === t)?.label ?? t).join(" + ");
  };
  const cost = (r: SimulationResult) => r.params.interventions.reduce((s, t) => s + (catalog.find((c) => c.type === t)?.costHKDm ?? 0), 0);
  const base = comparisons[0];
  const best = comparisons.slice(1).reduce<SimulationResult | null>((b, r) => (!b || r.failureProbability < b.failureProbability ? r : b), null);

  return (
    <div className="card">
      <h3>
        Intervention comparison
        {best && (
          <span className="hint" style={{ color: "var(--risk-low)" }}>
            best: {label(best, 1)} · −{Math.round((base.failureProbability - best.failureProbability) * 100)} pts for HK${cost(best).toFixed(1)} M
          </span>
        )}
      </h3>
      <div style={{ overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th>Scenario</th>
              <th>Failure prob.</th>
              <th>Runout</th>
              <th>People exposed</th>
              <th>Buildings</th>
              <th>Road impact</th>
              <th>Risk reduction</th>
              <th>Indicative cost</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {comparisons.map((r, i) => {
              const dRisk = i === 0 ? 0 : Math.round((base.failureProbability - r.failureProbability) * 100);
              return (
                <tr key={r.jobId} style={best && r.jobId === best.jobId ? { background: "rgba(47,179,107,0.07)" } : undefined}>
                  <td>{label(r, i)}</td>
                  <td style={{ color: r.failureProbability > 0.5 ? "#ff8577" : "var(--risk-low)" }}>{Math.round(r.failureProbability * 100)}%</td>
                  <td>{r.runoutDistanceM} m</td>
                  <td>{fmtInt(r.peopleExposed)}</td>
                  <td>{r.buildingsExposed}</td>
                  <td>{r.roadImpact}</td>
                  <td style={{ color: dRisk > 0 ? "var(--risk-low)" : undefined }}>{i === 0 ? "baseline" : `−${dRisk} pts`}</td>
                  <td>{i === 0 ? "—" : `HK$${cost(r).toFixed(1)} M`}</td>
                  <td>{Math.round(r.confidence * 100)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

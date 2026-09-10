// MockSimulationProvider — synthetic reduced-order landslide model + precomputed scenario
// library. Job-based API mirrors a real HPC/GPU queue so EDDASimulationProvider /
// GPUAcceleratedSimulationProvider can drop in later.
// DEMONSTRATION MODEL — NOT FOR ENGINEERING DECISIONS.

import type { SimulationProvider } from "@/core/interfaces";
import {
  ScenarioParams,
  SimulationFrame,
  SimulationJob,
  SimulationMode,
  SimulationResult,
  Slope,
  SIM_DISCLAIMER,
} from "@/core/types";
import { getDataset } from "./generate";
import { offsetM } from "./geo";
import { clamp, rngFor } from "./random";
import { mitigationFactor, occurrence, returnPeriodYears } from "@/core/pola";

export { returnPeriodYears };

export const DEFAULT_PARAMS: ScenarioParams = {
  rainfallMm: 143,
  rainfallDurationH: 24,
  groundwaterDeltaPct: 0,
  soilSaturationPct: 65,
  porePressureDeltaPct: 0,
  soilStrengthFactor: 1,
  drainageEfficiencyPct: 85,
  vegetationPct: 60,
  existingDisplacementMm: 8,
  retainingWallCondition: 0.85,
  barrierCondition: 0.85,
  seismicPga: 0,
  antecedentRain3dMm: 60,
  peakHourlyMm: 40,
  entrainmentFactor: 0.4,
  warningLeadTimeMin: 0,
  interventions: [],
};

/** Max rolling 24-h total implied by the event (uniform intensity beyond 24 h). */
export function rolling24hMm(p: Pick<ScenarioParams, "rainfallMm" | "rainfallDurationH">): number {
  return Math.round(p.rainfallDurationH <= 24 ? p.rainfallMm : (p.rainfallMm * 24) / p.rainfallDurationH);
}

/** Scenario library grid (mirrors a precomputed result store). */
export const LIBRARY_RAINFALL = [50, 100, 150, 200, 250, 300, 350, 400];
export const LIBRARY_GW = [-10, 0, 20];
export const LIBRARY_SAT = [50, 70, 90];
export const LIBRARY_DRAIN = [40, 70, 90];

const INTERVENTION_EFFECTS: Record<string, { prob: number; runout: number }> = {
  "soil-nails": { prob: 0.45, runout: 0.85 },
  "drainage-improvement": { prob: 0.7, runout: 0.95 },
  "retaining-wall-new": { prob: 0.4, runout: 0.6 },
  "retaining-wall-upgrade": { prob: 0.65, runout: 0.75 },
  "debris-barrier-new": { prob: 0.95, runout: 0.45 },
  "barrier-strengthening": { prob: 0.98, runout: 0.7 },
  "monitoring-sensors": { prob: 1.0, runout: 1.0 },
};

function coreModel(slope: Slope, p: ScenarioParams): Omit<SimulationResult, "jobId" | "mode" | "frames" | "runoutPath" | "computedAt" | "isSynthetic" | "disclaimer" | "params" | "slopeId"> {
  const rng = rngFor("sim", slope.id, p.rainfallMm, p.soilSaturationPct, p.drainageEfficiencyPct, p.groundwaterDeltaPct, p.seismicPga ?? 0);
  const rainF = clamp(p.rainfallMm / 320, 0, 1.3);
  // antecedent rain pre-wets the slope: the same storm on a slope that has had 300 mm in 3 days is a different storm
  const satF = clamp(p.soilSaturationPct / 100 + ((p.antecedentRain3dMm ?? 0) / 900) * 0.25, 0, 1);
  // peak hour: past ~70 mm/h surface runoff, not infiltration, does the work — channelised initiation (EDDA's 2nd mechanism)
  const peakF = clamp((p.peakHourlyMm ?? 0) / 150, 0, 1.6);
  const runoffInit = (p.peakHourlyMm ?? 0) > 70;
  // earthquake trigger: shaking on an already-wet slope is far worse than on a dry one (pseudo-static logic)
  const pgaF = clamp((p.seismicPga ?? 0) / 0.4, 0, 1.25);
  const quakeDrive = pgaF * (0.16 + 0.22 * satF);
  const ent = clamp(p.entrainmentFactor ?? 0.4, 0, 1);
  const gwF = clamp(0.5 + p.groundwaterDeltaPct / 60, 0, 1.2);
  const poreF = clamp(0.5 + p.porePressureDeltaPct / 80, 0, 1.3);
  const drainProtect = (p.drainageEfficiencyPct / 100) * 0.22;
  const vegProtect = (p.vegetationPct / 100) * 0.06;
  const dispF = clamp(p.existingDisplacementMm / 120, 0, 0.4);

  let prob = clamp(
    slope.susceptibility * 0.42 +
      rainF * 0.34 +
      satF * 0.16 +
      gwF * 0.1 +
      poreF * 0.08 +
      dispF +
      quakeDrive +
      (runoffInit ? 0.06 * peakF : 0) -
      drainProtect -
      vegProtect -
      (p.soilStrengthFactor - 1) * 0.5,
    0.01,
    0.99
  );

  let runoutFactor = 1;
  for (const iv of p.interventions) {
    const eff = INTERVENTION_EFFECTS[iv];
    if (eff) {
      prob *= eff.prob;
      runoutFactor *= eff.runout;
    }
  }
  prob = clamp(prob, 0.01, 0.99);

  const failureLikely = prob > 0.5;
  const depthM = 1 + prob * 3.5;
  const sourceVolumeM3 = Math.round(slope.areaM2 * depthM * (0.25 + prob * 0.5));
  const wallHolds = p.retainingWallCondition > 0.6 && p.interventions.includes("retaining-wall-upgrade") === false ? p.retainingWallCondition : Math.max(p.retainingWallCondition, 0.8);
  // mobility: shaking liquefies the mass, a runoff-driven start is faster, and an erodible path feeds the flow as it goes
  const baseRunout = slope.heightM * (1.4 + prob * 2.6) * (0.8 + rng() * 0.4) * (1 + pgaF * 0.35) * (1 + ent * 0.45) * (runoffInit ? 1.15 : 1);
  const barrierFactor = p.barrierCondition > 0.5 ? 1 - p.barrierCondition * 0.3 : 1;
  const runoutDistanceM = Math.round(clamp(baseRunout * runoutFactor * barrierFactor * (2 - wallHolds), 10, 900));
  const displacedVolumeM3 = Math.round(sourceVolumeM3 * (1 + ent * clamp(runoutDistanceM / 300, 0, 1.5))); // entrained along the path
  const maxVelocityMs = +((2 + prob * 16 * (runoutDistanceM / 400)) * (runoffInit ? 1 + 0.25 * peakF : 1)).toFixed(1);
  const affectedAreaM2 = Math.round(runoutDistanceM * Math.sqrt(slope.areaM2) * 0.6);

  const barrierCapacity = 6000 * p.barrierCondition;
  const hasBarrier = slope.mitigations.some((m) => m.type === "debris-barrier") || p.interventions.some((i) => i.includes("barrier"));
  const barrierOvertopped = hasBarrier && displacedVolumeM3 * prob > barrierCapacity;

  const roadNearby = slope.nearbyAssetIds.some((id) => id.startsWith("RD-"));
  const reach = clamp(runoutDistanceM / 260, 0, 1);
  const roadImpact: "unlikely" | "possible" | "likely" =
    !roadNearby || prob < 0.3 ? "unlikely" : prob * reach > 0.45 ? "likely" : "possible";
  const buildingsExposed = failureLikely ? Math.round(slope.nearbyAssetIds.filter((id) => !id.startsWith("RD-")).length * (2 + prob * 12) * reach) : 0;
  // warning lead time: people who have left before the front arrives are not exposed (up to 85 % after ~45 min)
  const evacuated = clamp((p.warningLeadTimeMin ?? 0) / 45, 0, 0.85);
  const peopleExposed = Math.round(slope.populationNearby * prob * reach * 0.8 * (1 - evacuated));
  const drainageBlocked = p.drainageEfficiencyPct < 55 || displacedVolumeM3 > 20000;
  const downstreamFlooding: "unlikely" | "possible" | "likely" =
    prob < 0.35 ? "unlikely" : drainageBlocked && prob > 0.6 ? "likely" : "possible";

  const seismic = (p.seismicPga ?? 0) >= 0.05;
  const timeToFailureH = failureLikely ? (seismic ? 0.1 : +(2 + (1 - prob) * 26).toFixed(1)) : null; // a quake triggers at once

  // The same storm through the PoLA occurrence model (src/core/pola.ts): per-storm P(H | R) from the max rolling 24-h
  // rainfall of the event and the slope's real features, reduced by the chosen interventions. Not the conditional
  // stress-test probability above — that one asks "how bad if it goes", this one "how likely it goes".
  let pola = occurrence({
    r24Mm: rolling24hMm(p),
    slopeType: slope.slopeType,
    heightM: slope.heightM,
    angleDeg: slope.slopeAngleDeg,
    entliPerKm2: slope.entliPerKm2,
    pastFailures: slope.realIncidents.length,
    susceptibility: slope.susceptibility,
    mitigation: mitigationFactor(slope.mitigations),
    antecedent3dMm: p.antecedentRain3dMm,
  }).p;
  for (const iv of p.interventions) pola *= INTERVENTION_EFFECTS[iv]?.prob ?? 1;

  return {
    failureProbability: +prob.toFixed(2),
    polaFailureProbability: pola,
    failureLikely,
    initiationZone:
      (runoffInit ? `Runoff-driven channelised initiation at ${p.peakHourlyMm} mm/h peak` : prob > 0.7 ? "Upper-middle slope face (tension crack zone)" : "Mid-slope surface layer") +
      (seismic ? ` — seismically triggered at ${p.seismicPga} g` : "") +
      (evacuated > 0 ? ` — ${Math.round(evacuated * 100)} % evacuated with ${p.warningLeadTimeMin} min warning` : ""),
    timeToFailureH,
    displacedVolumeM3,
    runoutDistanceM,
    maxVelocityMs,
    affectedAreaM2,
    roadImpact,
    buildingsExposed,
    peopleExposed,
    barrierOvertopped,
    downstreamFlooding,
    confidence: +(0.55 + rng() * 0.25 + (p.interventions.length ? -0.05 : 0)).toFixed(2),
  };
}

function makeFrames(slope: Slope, res: ReturnType<typeof coreModel>, p: ScenarioParams): SimulationFrame[] {
  const frames: SimulationFrame[] = [];
  const totalSec = 60;
  const failing = res.failureLikely;
  const seismic = (p.seismicPga ?? 0) >= 0.05;
  // an earthquake cuts the slow build-up short: shaking hits at t=20 and the mass is moving within seconds
  const tInit = seismic ? 20 : 26, tRun = seismic ? 23 : 30, tImpact = seismic ? 41 : 48, tSettled = seismic ? 50 : 56;
  for (let t = 0; t <= totalSec; t += 2) {
    let phase: SimulationFrame["phase"] = "rainfall";
    if (t >= 8) phase = "saturation";
    if (t >= 18) phase = "deformation";
    if (failing && t >= tInit) phase = "initiation";
    if (failing && t >= tRun) phase = "runout";
    if (failing && t >= tImpact) phase = "impact";
    if (failing && t >= tSettled) phase = "settled";
    if (!failing && t >= 30) phase = "settled";

    const saturation = clamp(0.3 + (t / 20) * (p.soilSaturationPct / 100), 0, 0.98);
    const deformationMm = phase === "rainfall" ? 0 : clamp((t - 8) * (failing ? 4.5 : 0.8) * res.failureProbability, 0, 300);
    const runProgress = failing ? clamp((t - tRun) / 18, 0, 1) : 0;
    // ease-out debris front
    const front = res.runoutDistanceM * (1 - Math.pow(1 - runProgress, 2.2));
    const velocity = failing && runProgress > 0 && runProgress < 1 ? res.maxVelocityMs * Math.sin(runProgress * Math.PI) : 0;

    const noteMap: Record<string, string> = {
      rainfall: "Rainfall infiltrating slope surface",
      saturation: "Soil saturation rising; pore pressures building",
      deformation: failing ? "Shear zone deforming; displacement accelerating" : "Minor deformation; slope remains stable",
      initiation: seismic ? `Ground shaking (${p.seismicPga} g) — the saturated mass lets go at the crest` : "Failure initiation — tension cracks open at crest",
      runout: seismic ? "Shaking liquefied the debris — mass travelling fast downslope" : "Debris mass mobilized, travelling downslope",
      impact: res.barrierOvertopped ? "Barrier overtopped — debris reaching infrastructure" : "Debris arrested near toe / barrier",
      settled: failing ? "Debris deposit settled; secondary hazards possible" : "Event ended without failure",
    };

    frames.push({
      tSec: t,
      phase,
      saturation,
      deformationMm: +deformationMm.toFixed(1),
      debrisFrontM: Math.round(front),
      velocityMs: +velocity.toFixed(1),
      affectedPolygon: null,
      note: noteMap[phase],
    });
  }
  return frames;
}

function makeRunoutPath(slope: Slope, runoutM: number): [number, number][] {
  const theta = ((90 - slope.aspectDeg) * Math.PI) / 180;
  const rng = rngFor("path", slope.id);
  const pts: [number, number][] = [slope.centroid];
  const steps = 12;
  let wobble = 0;
  for (let i = 1; i <= steps; i++) {
    wobble += (rng() - 0.5) * 0.25;
    const d = (runoutM / steps) * i;
    pts.push(offsetM(slope.centroid, Math.cos(theta + wobble) * d, Math.sin(theta + wobble) * d));
  }
  return pts;
}

export class MockSimulationProvider implements SimulationProvider {
  private jobs = new Map<string, SimulationJob>();
  private nextId = 1;

  runningCount(): number {
    return [...this.jobs.values()].filter((j) => j.status === "running" || j.status === "queued").length;
  }

  private compute(slopeId: string, params: ScenarioParams, mode: SimulationMode, jobId: string): SimulationResult {
    const slope = getDataset().slopes.find((s) => s.id === slopeId);
    if (!slope) throw new Error(`Unknown slope ${slopeId}`);
    let effectiveParams = params;
    if (mode === "instant") {
      // Library lookup: snap secondary axes to nearest grid node, interpolate rainfall axis.
      effectiveParams = {
        ...params,
        groundwaterDeltaPct: nearest(LIBRARY_GW, params.groundwaterDeltaPct),
        soilSaturationPct: nearest(LIBRARY_SAT, params.soilSaturationPct),
        drainageEfficiencyPct: nearest(LIBRARY_DRAIN, params.drainageEfficiencyPct),
      };
      const [lo, hi, w] = bracket(LIBRARY_RAINFALL, params.rainfallMm);
      const rLo = coreModel(slope, { ...effectiveParams, rainfallMm: lo });
      const rHi = coreModel(slope, { ...effectiveParams, rainfallMm: hi });
      const blend = lerpResults(rLo, rHi, w);
      return this.assemble(slope, blend, effectiveParams, mode, jobId, `Interpolated from library nodes ${lo} mm and ${hi} mm`);
    }
    const res = coreModel(slope, effectiveParams);
    return this.assemble(slope, res, effectiveParams, mode, jobId);
  }

  private assemble(
    slope: Slope,
    res: ReturnType<typeof coreModel>,
    params: ScenarioParams,
    mode: SimulationMode,
    jobId: string,
    note?: string
  ): SimulationResult {
    return {
      jobId,
      slopeId: slope.id,
      mode,
      params,
      ...res,
      initiationZone: note ? `${res.initiationZone} — ${note}` : res.initiationZone,
      frames: makeFrames(slope, res, params),
      runoutPath: makeRunoutPath(slope, res.runoutDistanceM),
      disclaimer: SIM_DISCLAIMER,
      computedAt: new Date().toISOString(),
      isSynthetic: true,
    };
  }

  async submit(slopeId: string, params: ScenarioParams, mode: SimulationMode): Promise<SimulationJob> {
    const id = `JOB-${this.nextId++}`;
    const job: SimulationJob = { id, slopeId, mode, status: "queued", progress: 0, stage: "Queued" };
    this.jobs.set(id, job);

    const durationMs = mode === "instant" ? 0 : mode === "fast" ? 2200 : 9500;
    const stages =
      mode === "hifi"
        ? ["Meshing terrain", "Assembling material model", "Solving rainfall infiltration", "Solving slope stability", "Simulating runout", "Post-processing frames"]
        : ["Evaluating reduced-order model", "Generating runout", "Post-processing"];

    if (mode === "instant") {
      job.status = "done";
      job.progress = 1;
      job.stage = "Retrieved from precomputed scenario library";
      job.result = this.compute(slopeId, params, mode, id);
      return { ...job };
    }

    job.status = "running";
    const started = performance.now();
    const timer = setInterval(() => {
      const p = Math.min(1, (performance.now() - started) / durationMs);
      job.progress = p;
      job.stage = stages[Math.min(stages.length - 1, Math.floor(p * stages.length))];
      if (p >= 1) {
        clearInterval(timer);
        try {
          job.result = this.compute(slopeId, params, mode, id);
          job.status = "done";
          job.stage = "Complete";
        } catch (e) {
          job.status = "failed";
          job.stage = String(e);
        }
      }
    }, 150);
    return { ...job };
  }

  async getJob(jobId: string): Promise<SimulationJob | undefined> {
    const j = this.jobs.get(jobId);
    return j ? { ...j, result: j.result } : undefined;
  }
}

function nearest(grid: number[], v: number): number {
  return grid.reduce((best, g) => (Math.abs(g - v) < Math.abs(best - v) ? g : best), grid[0]);
}
function bracket(grid: number[], v: number): [number, number, number] {
  if (v <= grid[0]) return [grid[0], grid[0], 0];
  if (v >= grid[grid.length - 1]) return [grid[grid.length - 1], grid[grid.length - 1], 0];
  for (let i = 0; i < grid.length - 1; i++) {
    if (v >= grid[i] && v <= grid[i + 1]) return [grid[i], grid[i + 1], (v - grid[i]) / (grid[i + 1] - grid[i])];
  }
  return [grid[0], grid[0], 0];
}
function lerpResults<T extends Record<string, any>>(a: T, b: T, w: number): T {
  const out: any = { ...a };
  for (const k of Object.keys(a)) {
    const va = a[k], vb = b[k];
    if (typeof va === "number" && typeof vb === "number") out[k] = +(va + (vb - va) * w).toFixed(3);
  }
  out.failureLikely = out.failureProbability > 0.5;
  return out;
}

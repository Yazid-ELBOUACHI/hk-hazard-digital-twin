// Environmental & sensor signal synthesis, with a REAL live-rainfall baseline when HKO data is present.
//
// Rainfall = baseline + storm overlay.
//   • baseline: the latest HKO past-hour observation at the slope's nearest automatic weather station
//     (REAL, polled every 5 min; see src/live/hko.ts). Without live data the deterministic synthetic
//     bursty baseline below is used instead.
//   • storm overlay: the synthetic city-wide "Storm Watch" band, a pure function of game time.
// Everything else (pore pressure, displacement, GNSS, soil moisture) remains synthetic, derived from
// the rainfall above plus per-slope noise, so time scrubbing is exact and reproducible.

import type { Slope } from "@/core/types";
import type { LiveRain, LiveStation } from "@/live/hko";
import { GAME_EPOCH } from "./generate";
import { clamp, smoothNoise, smoothNoiseSeed, keySeed, rngFor } from "./random";

// ---- Storm overlay (city-wide scenario control) ----
let stormActiveSince: number | null = null;
export function setStormOverlay(activeSince: number | null) {
  stormActiveSince = activeSince;
  rain24Cache.clear();
}
export function getStormOverlay(): number | null {
  return stormActiveSince;
}
/** Hours until storm peak arrival (positive = incoming). */
export function stormEtaHours(gameTime: number): number | null {
  if (stormActiveSince === null) return null;
  const eta = 8 - (gameTime - stormActiveSince) / 3600_000;
  return eta;
}

// ---- Live HKO rainfall (REAL) ----
let live: LiveRain | null = null;
let liveVersion = 0;
let liveMeanRate = 0; // territory mean past-hour intensity, mm/hr
let liveMean24: number | null = null; // territory mean 24-h total (null while unknown)
const nearestStation = new Map<string, LiveStation | null>(); // slope id -> station

export function setLiveRain(r: LiveRain | null) {
  live = r && r.stations.length ? r : null;
  liveVersion++;
  nearestStation.clear();
  rain24Cache.clear();
  if (!live) { liveMeanRate = 0; liveMean24 = null; return; }
  liveMeanRate = live.stations.reduce((s, st) => s + st.mmHr, 0) / live.stations.length;
  const with24 = live.stations.filter((st) => st.mm24 !== null);
  liveMean24 = with24.length ? with24.reduce((s, st) => s + (st.mm24 ?? 0), 0) / with24.length : null;
}
export function getLiveRain(): LiveRain | null {
  return live;
}
/** Does the current rainfall baseline come from HKO (true) or from synthesis (false)? */
export function rainIsLive(): boolean {
  return live !== null;
}
export function liveRain24Known(): boolean {
  return liveMean24 !== null;
}

function stationFor(slope: Slope): LiveStation | null {
  if (!live) return null;
  let hit = nearestStation.get(slope.id);
  if (hit !== undefined) return hit;
  const [lon, lat] = slope.centroid;
  const kx = Math.cos((lat * Math.PI) / 180);
  let best: LiveStation | null = null;
  let bestD = Infinity;
  for (const st of live.stations) {
    const d = ((st.lon - lon) * kx) ** 2 + (st.lat - lat) ** 2;
    if (d < bestD) { bestD = d; best = st; }
  }
  hit = best;
  nearestStation.set(slope.id, hit);
  return hit;
}

/** Nearest live station for a slope (for provenance labels), or null without live data. */
export function liveStationFor(slope: Slope): LiveStation | null {
  return stationFor(slope);
}

function hoursSinceEpoch(gameTime: number): number {
  return (gameTime - GAME_EPOCH) / 3600_000;
}

/** Synthetic city baseline intensity mm/hr (bursty unsettled weather) — used only without live data. */
function syntheticBaselineRateAt(gameTime: number): number {
  const h = hoursSinceEpoch(gameTime);
  const n = smoothNoise("rain-base", h / 2.5);
  let rate = Math.pow(n, 2.2) * 14; // 0..14 mm/hr
  rate += Math.pow(smoothNoise("rain-burst", h / 0.8), 6) * 10;
  return rate;
}

/** Storm Watch overlay intensity mm/hr at a game time (0 when no storm is active). */
export function stormRateAt(gameTime: number): number {
  if (stormActiveSince === null) return 0;
  const h = hoursSinceEpoch(gameTime);
  const sinceH = (gameTime - stormActiveSince) / 3600_000;
  const rampStart = 8; // storm arrives 8h after activation
  if (sinceH <= rampStart - 2) return 0;
  const x = sinceH - (rampStart - 2);
  const ramp = x < 6 ? x / 6 : x < 14 ? 1 : Math.max(0, 1 - (x - 14) / 8);
  return ramp * (38 + smoothNoise("storm-var", h) * 22);
}

/** City rainfall intensity mm/hr at a game time (live or synthetic baseline + storm overlay). */
export function rainRateAt(gameTime: number): number {
  return (live ? liveMeanRate : syntheticBaselineRateAt(gameTime)) + stormRateAt(gameTime);
}

/** Storm overlay accumulated over the trailing 24 h. */
function storm24At(gameTime: number): number {
  if (stormActiveSince === null) return 0;
  const key = `${stormActiveSince}|${gameTime}`;
  const hit = stormTotals.get(key);
  if (hit !== undefined) return hit;
  let sum = 0;
  for (let i = 0; i < 24; i++) sum += stormRateAt(gameTime - i * 3600_000);
  if (stormTotals.size > 512) stormTotals.clear();
  stormTotals.set(key, sum);
  return sum;
}

// These totals are identical for every slope at a given time. Compute once per
// timestamp, not 24 noise samples per slope on every assessment/history pass.
const stormTotals = new Map<string, number>();
const baselineTotals = new Map<number, number>();
function syntheticBaseline24At(gameTime: number): number {
  const hit = baselineTotals.get(gameTime);
  if (hit !== undefined) return hit;
  let sum = 0;
  for (let i = 0; i < 24; i++) sum += syntheticBaselineRateAt(gameTime - i * 3600_000);
  if (baselineTotals.size > 512) baselineTotals.clear();
  baselineTotals.set(gameTime, sum);
  return sum;
}

/** Accumulated city rainfall over the trailing 24 h. Memoized per minute + storm + live version. */
const rain24Cache = new Map<string, number>();
export function rain24At(gameTime: number): number {
  const key = `${Math.round(gameTime / 60_000)}|${stormActiveSince ?? "-"}|${liveVersion}`;
  const hit = rain24Cache.get(key);
  if (hit !== undefined) return hit;
  const base = live && liveMean24 !== null ? liveMean24 : syntheticBaseline24At(gameTime);
  const sum = base + storm24At(gameTime);
  if (rain24Cache.size > 4000) rain24Cache.clear();
  rain24Cache.set(key, sum);
  return sum;
}

/** Forecast series for next `hours` (the "model" knows the deterministic future + storm ramp). */
export function forecastSeries(gameTime: number, hours = 72): { t: string; mmHr: number }[] {
  const out: { t: string; mmHr: number }[] = [];
  for (let i = 1; i <= hours; i++) {
    const t = gameTime + i * 3600_000;
    out.push({ t: new Date(t).toISOString(), mmHr: +rainRateAt(t).toFixed(1) });
  }
  return out;
}

/** Projected trailing-24h rainfall at gameTime + plusHours. */
export function projectedRain24(gameTime: number, plusHours: number): number {
  return rain24At(gameTime + plusHours * 3600_000);
}

/** Spatial rainfall variation 0.6..1.4 by location (stable pattern) — applies to the synthetic parts only. */
export function regionalRainFactor(lon: number, lat: number): number {
  const n = smoothNoise("rain-region", lon * 18 + lat * 31);
  return 0.6 + n * 0.8;
}

// ---- Per-slope dynamic features ----

export interface SlopeFeatures {
  rain24Mm: number;
  rainRateMmHr: number;
  poreRatio: number; // 0..1 (ru-like proxy)
  groundwaterDeltaPct: number; // vs seasonal normal
  soilMoisture: number; // 0..1
  dispTotalMm: number; // cumulative on current episode
  dispRateMmHr: number;
  gnssMm: number;
}

// Per-slope noise seeds and the (static) regional rain factor, computed once — featuresFor() runs
// ~10k times per risk refresh and must not build strings or hash keys.
interface SlopeSeeds { pore: number; sm: number; disp: number; gnss: number; rf: number }
const slopeSeeds = new Map<string, SlopeSeeds>();
function seedsFor(slope: Slope): SlopeSeeds {
  let s = slopeSeeds.get(slope.id);
  if (!s) {
    s = {
      pore: keySeed(`pore-${slope.id}`),
      sm: keySeed(`sm-${slope.id}`),
      disp: keySeed(`disp-${slope.id}`),
      gnss: keySeed(`gnss-${slope.id}`),
      rf: regionalRainFactor(slope.centroid[0], slope.centroid[1]),
    };
    slopeSeeds.set(slope.id, s);
  }
  return s;
}

/** Rainfall at a slope: nearest HKO station (real) when live, else synthetic baseline; storm overlay on top. */
export function slopeRain(slope: Slope, gameTime: number): { rain24: number; rainRate: number } {
  const rf = seedsFor(slope).rf;
  const st = stationFor(slope);
  if (st) {
    const base24 = st.mm24 ?? syntheticBaseline24At(gameTime) * rf;
    return { rain24: base24 + storm24At(gameTime) * rf, rainRate: st.mmHr + stormRateAt(gameTime) * rf };
  }
  return { rain24: rain24At(gameTime) * rf, rainRate: rainRateAt(gameTime) * rf };
}

export function featuresFor(slope: Slope, gameTime: number): SlopeFeatures {
  const { rain24, rainRate } = slopeRain(slope, gameTime);
  const seeds = seedsFor(slope);
  const h = hoursSinceEpoch(gameTime);
  const permF = slope.soil.permeability === "high" ? 0.7 : slope.soil.permeability === "low" ? 1.25 : 1;
  const drainF = 1.15 - slope.drainage.condition * 0.45;

  const wet = clamp(rain24 / 220, 0, 1.4);
  const pore = clamp(
    slope.soil.saturationBase * 0.55 + wet * 0.5 * permF * drainF + (smoothNoiseSeed(seeds.pore, h / 4) - 0.5) * 0.12,
    0.02,
    0.99
  );
  const soilMoisture = clamp(slope.soil.saturationBase + wet * 0.45 + (smoothNoiseSeed(seeds.sm, h / 5) - 0.5) * 0.1, 0.05, 1);
  const groundwater = Math.round((pore - slope.soil.saturationBase * 0.6) * 60);

  // displacement accelerates when pore ratio is high on susceptible slopes
  const creepBase = slope.susceptibility * 0.35;
  const activation = Math.max(0, pore - 0.55) * slope.susceptibility * 9;
  const dispRate = clamp(creepBase * 0.12 + activation * (0.4 + smoothNoiseSeed(seeds.disp, h / 2) * 0.6), 0, 12);
  const episodeH = Math.min(h + 36, 96);
  const dispTotal = clamp(creepBase * episodeH * 0.08 + activation * episodeH * 0.25, 0, 400);
  const gnss = dispTotal * 0.8 + (smoothNoiseSeed(seeds.gnss, h / 3) - 0.5) * 3;

  return {
    rain24Mm: rain24,
    rainRateMmHr: rainRate,
    poreRatio: pore,
    groundwaterDeltaPct: groundwater,
    soilMoisture,
    dispTotalMm: dispTotal,
    dispRateMmHr: dispRate,
    gnssMm: gnss,
  };
}

/** Per-sensor time series value for charting. */
export function sensorValueAt(slope: Slope, kind: string, gameTime: number): number {
  const f = featuresFor(slope, gameTime);
  const jitter = (key: string) => (rngFor(key, Math.floor(gameTime / 600_000))() - 0.5);
  switch (kind) {
    case "rainfall":
      // live rainfall is a real gauge reading — no synthetic jitter on top of it
      return +(live ? f.rainRateMmHr : f.rainRateMmHr + jitter(`j-${slope.id}-r`) * 0.6).toFixed(1);
    case "displacement-total":
      return +(f.dispTotalMm + jitter(`j-${slope.id}-d`) * 0.8).toFixed(1);
    case "displacement-horizontal":
      return +(f.dispTotalMm * 0.72 + jitter(`j-${slope.id}-dh`) * 0.7).toFixed(1);
    case "displacement-vertical":
      return +(f.dispTotalMm * 0.4 + jitter(`j-${slope.id}-dv`) * 0.5).toFixed(1);
    case "pore-pressure":
      return +(f.poreRatio * 110 + jitter(`j-${slope.id}-p`) * 3).toFixed(1); // kPa
    case "groundwater":
      return +(f.groundwaterDeltaPct + jitter(`j-${slope.id}-g`) * 1.5).toFixed(1); // % vs normal
    case "gnss-movement":
      return +(f.gnssMm + jitter(`j-${slope.id}-gn`) * 1.2).toFixed(1);
    case "soil-moisture":
      return +(f.soilMoisture * 100 + jitter(`j-${slope.id}-sm`) * 2).toFixed(1); // %
    default:
      return 0;
  }
}

export const SENSOR_UNITS: Record<string, string> = {
  rainfall: "mm/hr",
  "displacement-total": "mm",
  "displacement-horizontal": "mm",
  "displacement-vertical": "mm",
  "pore-pressure": "kPa",
  groundwater: "% vs normal",
  "gnss-movement": "mm",
  "soil-moisture": "%",
};

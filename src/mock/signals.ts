// Deterministic synthetic environmental & sensor signal synthesis.
// Everything is a pure function of (entity, gameTime) plus the storm overlay state,
// so time scrubbing is exact and reproducible. This module is the mock stand-in for
// a real feature store fed by HKO rainfall + IoT sensor streams.

import type { Slope } from "@/core/types";
import { GAME_EPOCH } from "./generate";
import { clamp, smoothNoise, rngFor } from "./random";

// ---- Storm overlay (city-wide scenario control) ----
let stormActiveSince: number | null = null;
export function setStormOverlay(activeSince: number | null) {
  stormActiveSince = activeSince;
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

function hoursSinceEpoch(gameTime: number): number {
  return (gameTime - GAME_EPOCH) / 3600_000;
}

/** City rainfall intensity mm/hr at a game time (baseline unsettled weather + storm ramp). */
export function rainRateAt(gameTime: number): number {
  const h = hoursSinceEpoch(gameTime);
  const n = smoothNoise("rain-base", h / 2.5);
  let rate = Math.pow(n, 2.2) * 14; // bursty baseline 0..14 mm/hr
  rate += Math.pow(smoothNoise("rain-burst", h / 0.8), 6) * 10;
  if (stormActiveSince !== null) {
    const sinceH = (gameTime - stormActiveSince) / 3600_000;
    const rampStart = 8; // storm arrives 8h after activation
    if (sinceH > rampStart - 2) {
      const x = sinceH - (rampStart - 2);
      const ramp = x < 6 ? x / 6 : x < 14 ? 1 : Math.max(0, 1 - (x - 14) / 8);
      rate += ramp * (38 + smoothNoise("storm-var", h) * 22);
    }
  }
  return rate;
}

/** Accumulated rainfall over the trailing 24 h (hourly sampling). Memoized per minute+storm state. */
const rain24Cache = new Map<string, number>();
export function rain24At(gameTime: number): number {
  const key = `${Math.round(gameTime / 60_000)}|${stormActiveSince ?? "-"}`;
  const hit = rain24Cache.get(key);
  if (hit !== undefined) return hit;
  let sum = 0;
  for (let i = 0; i < 24; i++) sum += rainRateAt(gameTime - i * 3600_000);
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

/** Spatial rainfall variation 0.6..1.4 by location (stable pattern). */
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

export function featuresFor(slope: Slope, gameTime: number): SlopeFeatures {
  const rf = regionalRainFactor(slope.centroid[0], slope.centroid[1]);
  const rain24 = rain24At(gameTime) * rf;
  const rainRate = rainRateAt(gameTime) * rf;
  const h = hoursSinceEpoch(gameTime);
  const permF = slope.soil.permeability === "high" ? 0.7 : slope.soil.permeability === "low" ? 1.25 : 1;
  const drainF = 1.15 - slope.drainage.condition * 0.45;

  const wet = clamp(rain24 / 220, 0, 1.4);
  const pore = clamp(
    slope.soil.saturationBase * 0.55 + wet * 0.5 * permF * drainF + (smoothNoise(`pore-${slope.id}`, h / 4) - 0.5) * 0.12,
    0.02,
    0.99
  );
  const soilMoisture = clamp(slope.soil.saturationBase + wet * 0.45 + (smoothNoise(`sm-${slope.id}`, h / 5) - 0.5) * 0.1, 0.05, 1);
  const groundwater = Math.round((pore - slope.soil.saturationBase * 0.6) * 60);

  // displacement accelerates when pore ratio is high on susceptible slopes
  const creepBase = slope.susceptibility * 0.35;
  const activation = Math.max(0, pore - 0.55) * slope.susceptibility * 9;
  const dispRate = clamp(creepBase * 0.12 + activation * (0.4 + smoothNoise(`disp-${slope.id}`, h / 2) * 0.6), 0, 12);
  const episodeH = Math.min(h + 36, 96);
  const dispTotal = clamp(creepBase * episodeH * 0.08 + activation * episodeH * 0.25, 0, 400);
  const gnss = dispTotal * 0.8 + (smoothNoise(`gnss-${slope.id}`, h / 3) - 0.5) * 3;

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
      return +(f.rainRateMmHr + jitter(`j-${slope.id}-r`) * 0.6).toFixed(1);
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

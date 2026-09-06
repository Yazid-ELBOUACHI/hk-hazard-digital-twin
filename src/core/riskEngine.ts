// HeuristicRiskEngine — prototype risk scoring, explainability, trajectory & uncertainty.
// Feature values are injected (dependency inversion): today they come from synthetic signal
// synthesis; in production from a feature store fed by real sensors/rainfall.
// DEMONSTRATION MODEL — NOT FOR ENGINEERING DECISIONS.

import type { RiskEngine } from "./interfaces";
import { yieldForMap } from "./schedule";
import {
  KpiSnapshot,
  RiskAssessment,
  RiskCategory,
  RiskDriver,
  Slope,
  TrajectoryPoint,
  Trend,
  scoreToCategory,
} from "./types";

export interface DynamicFeatures {
  rain24Mm: number;
  rainRateMmHr: number;
  poreRatio: number;
  dispTotalMm: number;
  dispRateMmHr: number;
  groundwaterDeltaPct: number;
  soilMoisture: number;
}

export type FeatureSource = (slope: Slope, gameTime: number) => DynamicFeatures;
export type RainProjector = (gameTime: number, plusHours: number) => number; // projected trailing-24h mm

export interface RiskContext {
  activeIncidentSlopeIds: Set<string>;
  simulationsRunning: () => number;
  forecast24Mm: (gameTime: number) => number;
}

const HORIZONS = [0, 1, 3, 6, 12, 24] as const;

export class HeuristicRiskEngine implements RiskEngine {
  constructor(
    private features: FeatureSource,
    private projectRain24: RainProjector,
    private ctx: RiskContext
  ) {}

  private rawScore(slope: Slope, f: DynamicFeatures): { score: number; parts: Record<string, number> } {
    const geometryF = Math.min(1, ((slope.slopeAngleDeg - 20) / 42) * 0.7 + (slope.heightM / 180) * 0.3);
    const soilF = Math.min(1, (30 - slope.soil.cohesionKPa) / 30) * 0.6 + (slope.soil.permeability === "low" ? 0.4 : 0.15);
    const histF = slope.history.some((e) => e.kind === "incident") ? 1 : 0.25;
    const mitAvg = slope.mitigations.length
      ? slope.mitigations.reduce((s, m) => s + m.condition, 0) / slope.mitigations.length
      : 0;
    const mitF = Math.min(1, (slope.mitigations.length / 3) * (0.4 + 0.6 * mitAvg));
    const rainF = Math.min(1.25, f.rain24Mm / 240);
    const poreF = f.poreRatio;
    const dispF = Math.min(1, f.dispRateMmHr / 3 + f.dispTotalMm / 300);

    const parts = {
      rainfall: 0.26 * rainF,
      "pore pressure": 0.2 * poreF,
      displacement: 0.17 * dispF,
      "slope geometry": 0.14 * geometryF * slope.susceptibility,
      "soil properties": 0.09 * soilF * slope.susceptibility,
      "historical failures": 0.06 * histF,
      "mitigation condition": 0.08 * (1 - mitF),
    };
    const base = 0.34 * slope.susceptibility;
    const dyn = Object.values(parts).reduce((a, b) => a + b, 0);
    // Calibration: the linear sum puts the median slope in "elevated" on any wet day. A convex
    // squash keeps the ordering but makes the inventory read realistically — most registered
    // slopes low/moderate, a tail of elevated/high, critical only under exceptional conditions.
    const raw = Math.max(0, Math.min(1.2, base + dyn));
    return { score: Math.max(0, Math.min(100, Math.pow(raw, 1.45) * 100)), parts };
  }

  private confidenceOf(slope: Slope, gameTime: number): {
    confidence: number;
    sensorCoverage: number;
    geometryConfidence: number;
    parameterUncertainty: number;
    freshnessPenalty: number;
  } {
    const online = slope.sensors.filter((s) => s.online).length;
    const sensorCoverage = Math.min(1, online / 5);
    const geomAgeDays = (gameTime - Date.parse(slope.freshness.geometry)) / 86400_000;
    const geometryConfidence = Math.max(0.2, 1 - geomAgeDays / 720);
    const inspAgeDays = (gameTime - Date.parse(slope.freshness.inspection)) / 86400_000;
    const freshnessPenalty = Math.min(0.3, geomAgeDays / 3000 + inspAgeDays / 3600);
    // stable per-slope epistemic uncertainty
    let hsh = 0;
    for (let i = 0; i < slope.id.length; i++) hsh = (hsh * 31 + slope.id.charCodeAt(i)) >>> 0;
    const parameterUncertainty = 0.15 + ((hsh % 1000) / 1000) * 0.5;
    const anomalyPenalty = slope.sensors.some((s) => s.anomalous) ? 0.06 : 0;
    const confidence = Math.max(
      0.15,
      Math.min(0.97, 0.42 + 0.3 * sensorCoverage + 0.15 * geometryConfidence + 0.15 * (1 - parameterUncertainty) - freshnessPenalty - anomalyPenalty)
    );
    return { confidence, sensorCoverage, geometryConfidence, parameterUncertainty, freshnessPenalty };
  }

  private scoreAtHorizon(slope: Slope, gameTime: number, plusH: number, f0?: DynamicFeatures): number {
    const f = f0 ?? this.features(slope, gameTime);
    if (plusH === 0) return this.rawScore(slope, f).score;
    const futureRain = this.projectRain24(gameTime, plusH);
    // saturation memory: pore pressure follows rain with lag
    const fFuture: DynamicFeatures = {
      ...f,
      rain24Mm: futureRain,
      poreRatio: Math.min(0.99, f.poreRatio * 0.55 + Math.min(1.3, futureRain / 220) * 0.5),
      dispRateMmHr: f.dispRateMmHr * (1 + Math.max(0, futureRain - f.rain24Mm) / 180),
      dispTotalMm: f.dispTotalMm + f.dispRateMmHr * plusH,
    };
    return this.rawScore(slope, fFuture).score;
  }

  assess(slope: Slope, gameTime: number): RiskAssessment {
    const f = this.features(slope, gameTime);
    const { score, parts } = this.rawScore(slope, f);
    const category = scoreToCategory(score, slope.hasData);
    const unc = this.confidenceOf(slope, gameTime);

    const totalParts = Object.values(parts).reduce((a, b) => a + b, 0) || 1;
    const drivers: RiskDriver[] = Object.entries(parts)
      .map(([factor, v]) => ({ factor, sharePct: Math.round((v / totalParts) * 100) }))
      .sort((a, b) => b.sharePct - a.sharePct);

    const trajectory: TrajectoryPoint[] = HORIZONS.map((h) => {
      const s = this.scoreAtHorizon(slope, gameTime, h, f);
      return { horizonH: h, score: Math.round(s), category: scoreToCategory(s, slope.hasData) };
    });

    const past = this.scoreAtHorizon(slope, gameTime - 3 * 3600_000, 0);
    const trend: Trend = score - past > 2.5 ? "up" : past - score > 2.5 ? "down" : "stable";

    const top = drivers.slice(0, 2).map((d) => d.factor);
    const catLabel = category.toUpperCase().replace("-", " ");
    const explanation = !slope.hasData
      ? `Insufficient data: this slope has no recent instrumentation or survey coverage, so risk cannot be assessed reliably. Field inspection recommended.`
      : `Risk is ${catLabel} (score ${Math.round(score)}/100), primarily driven by ${top.join(" and ")}. ` +
        `Trailing 24-h rainfall is ${f.rain24Mm.toFixed(0)} mm and the pore-pressure proxy is at ${(f.poreRatio * 100).toFixed(0)}% of critical. ` +
        `Movement rate is ${f.dispRateMmHr.toFixed(2)} mm/hr. ` +
        (trajectory[3].category !== category
          ? `Conditions are expected to shift this slope to ${trajectory[3].category.toUpperCase()} within ~6 h. `
          : `No band change expected in the next 6 h. `) +
        `Model confidence ${(unc.confidence * 100).toFixed(0)}% (sensor coverage ${(unc.sensorCoverage * 100).toFixed(0)}%, geometry confidence ${(unc.geometryConfidence * 100).toFixed(0)}%). Synthetic demonstration output.`;

    return {
      slopeId: slope.id,
      score: Math.round(score),
      category,
      confidence: unc.confidence,
      trend,
      drivers,
      trajectory,
      freshnessPenalty: unc.freshnessPenalty,
      sensorCoverage: unc.sensorCoverage,
      geometryConfidence: unc.geometryConfidence,
      parameterUncertainty: unc.parameterUncertainty,
      explanation,
    };
  }

  assessAll(slopes: Slope[], gameTime: number): Map<string, RiskAssessment> {
    const m = new Map<string, RiskAssessment>();
    for (const s of slopes) m.set(s.id, this.assess(s, gameTime));
    return m;
  }

  /** ~4,000 slopes in slices of 250 with a yield between slices: no task longer than a few ms. */
  async assessAllAsync(slopes: Slope[], gameTime: number): Promise<Map<string, RiskAssessment>> {
    const m = new Map<string, RiskAssessment>();
    const CHUNK = 64;
    for (let i = 0; i < slopes.length; i += CHUNK) {
      await yieldForMap();
      const end = Math.min(slopes.length, i + CHUNK);
      for (let k = i; k < end; k++) m.set(slopes[k].id, this.assess(slopes[k], gameTime));

    }
    return m;
  }

  projectScore(slope: Slope, gameTime: number, plusHours: number): { score: number; category: RiskCategory } {
    const s = this.scoreAtHorizon(slope, gameTime, plusHours);
    return { score: Math.round(s), category: scoreToCategory(s, slope.hasData) };
  }

  projectUnderStorm(slope: Slope, gameTime: number, plusHours: number): RiskAssessment {
    const s = this.scoreAtHorizon(slope, gameTime, plusHours);
    const base = this.assess(slope, gameTime);
    return { ...base, score: Math.round(s), category: scoreToCategory(s, slope.hasData) };
  }

  async kpis(slopes: Slope[], assessments: Map<string, RiskAssessment>, gameTime: number): Promise<KpiSnapshot> {
    const count = (c: RiskCategory) => slopes.filter((s) => assessments.get(s.id)?.category === c).length;
    const exposedSlopes = slopes.filter((s) => {
      const c = assessments.get(s.id)?.category;
      return c === "high" || c === "critical";
    });
    const roads = new Set<string>();
    const buildings = new Set<string>();
    let population = 0;
    for (const s of exposedSlopes) {
      for (const id of s.nearbyAssetIds) {
        if (id.startsWith("RD-")) roads.add(id);
        else buildings.add(id);
      }
      population += s.populationNearby;
    }
    const sensorsAll = slopes.flatMap((s) => s.sensors);
    const rain24 = this.features(slopes[0], gameTime).rain24Mm; // representative; city KPI uses mean below
    const meanRain = Math.round(
      slopes.slice(0, 40).reduce((sum, s) => sum + this.features(s, gameTime).rain24Mm, 0) / 40
    );
    const forecast = Math.round(this.ctx.forecast24Mm(gameTime));

    const prev = await this.prevCounts(slopes, gameTime - 24 * 3600_000);
    const trendOf = (now: number, before: number): Trend => (now > before ? "up" : now < before ? "down" : "stable");

    const critical = count("critical");
    const high = count("high");
    const elevated = count("elevated");
    const moderate = count("moderate");

    return {
      criticalSlopes: critical,
      highRiskSlopes: high,
      elevatedSlopes: elevated,
      moderateSlopes: moderate,
      monitoringRequired: elevated + high + critical,
      insufficientData: count("no-data"),
      activeIncidents: this.ctx.activeIncidentSlopeIds.size,
      roadsExposed: roads.size,
      buildingsExposed: buildings.size,
      populationExposed: population,
      rainfall24hMm: meanRain || Math.round(rain24),
      forecastRainfallMm: forecast,
      sensorsAnomalous: sensorsAll.filter((s) => s.anomalous).length,
      sensorsOffline: sensorsAll.filter((s) => !s.online).length,
      simulationsRunning: this.ctx.simulationsRunning(),
      trends: {
        criticalSlopes: trendOf(critical, prev.critical),
        highRiskSlopes: trendOf(high, prev.high),
        moderateSlopes: trendOf(moderate, prev.moderate),
        rainfall24hMm: trendOf(meanRain, prev.rain),
        populationExposed: trendOf(population, prev.population),
      },
    };
  }

  // The −24 h comparison only feeds trend arrows: memoised per game-hour and computed in yielding
  // slices, so it never adds a long task to the refresh.
  private prevMemo: { key: number; value: { critical: number; high: number; moderate: number; population: number; rain: number } } | null = null;
  private async prevCounts(slopes: Slope[], gameTime: number) {
    const key = Math.round(gameTime / 3600_000) ^ (slopes.length << 12);
    if (this.prevMemo?.key === key) return this.prevMemo.value;
    const value = await this.assessPrevCounts(slopes, gameTime);
    this.prevMemo = { key, value };
    return value;
  }

  private async assessPrevCounts(slopes: Slope[], gameTime: number) {
    let critical = 0, high = 0, moderate = 0, population = 0;
    const CHUNK = 64;
    for (let i = 0; i < slopes.length; i += CHUNK) {
      await yieldForMap();
      const end = Math.min(slopes.length, i + CHUNK);
      for (let k = i; k < end; k++) {
        const s = slopes[k];
        const f = this.features(s, gameTime);
        const sc = this.rawScore(s, f).score;
        const c = scoreToCategory(sc, s.hasData);
        if (c === "critical") { critical++; population += s.populationNearby; }
        else if (c === "high") { high++; population += s.populationNearby; }
        else if (c === "moderate") moderate++;
      }

    }
    const rain = Math.round(slopes.slice(0, 40).reduce((sum, s) => sum + this.features(s, gameTime).rain24Mm, 0) / 40);
    return { critical, high, moderate, population, rain };
  }
}

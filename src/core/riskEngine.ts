// PoLA risk engine — the twin's slope risk in the form used by Prof. Limin Zhang's group at HKUST:
//
//   Risk = P(H | R) · P(M | H, R) · P(L | H, M) · V(H, M, E) · E
//
// (He, Zhang, Xiao, Wang & Luo 2023; Zhang & He, IWDTERM 2026). Every term is a pure function in src/core/pola.ts
// and is documented, with its coefficients, on the Data Sources page. This class only feeds the chain with the
// slope's real attributes (geometry, feature type, CEDD incident record, ENTLI density, census residents, LandsD
// blocks, facilities, roads) and the rainfall at the slope (HKO live + Storm Watch), then maps the result onto the
// 0–100 band, the drivers, the trajectory and the KPIs. Feature values are injected (dependency inversion): today
// monitoring evidence is synthetic; in production it comes from a feature store fed by real sensors.
// DEMONSTRATION MODEL — NOT FOR ENGINEERING DECISIONS.

import type { RiskEngine } from "./interfaces";
import { yieldForMap } from "./schedule";
import {
  Asset,
  KpiSnapshot,
  QraSummary,
  RiskAssessment,
  RiskCategory,
  RiskDriver,
  Slope,
  TrajectoryPoint,
  Trend,
  scoreToCategory,
} from "./types";
import { annualOccurrence, barrierCondition, elementsOf, magnitude, mitigationFactor, occurrence, pllRange, riskChain, scoreFromChain, uncertaintyOf, upgradeVoi, valueOfInformation, type RiskChain } from "./pola";

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
  /** Real neighbours of a slope (LandsD blocks, facilities, roads) by asset id — the elements at risk. */
  assetById?: (id: string) => Asset | undefined;
  /** HKO 2-h gridded nowcast: rainfall expected at the slope over the next `plusHours` (0 when unavailable). */
  nowcastMm?: (slope: Slope, plusHours: number) => number;
}

const HORIZONS = [0, 1, 3, 6, 12, 24] as const;
/** The max rolling 24-h rainfall is sampled over the trailing day at this step (h). */
const R24_LOOKBACK_STEP_H = 4;
const R24_LOOKBACK_STEPS = 6;

export class HeuristicRiskEngine implements RiskEngine {
  constructor(
    private features: FeatureSource,
    private projectRain24: RainProjector,
    private ctx: RiskContext
  ) {}

  // ---- inputs ----

  private r24Memo = new Map<string, number>();
  /** Maximum rolling 24-h rainfall at the slope over the trailing day (the storm's R24 so far), memoised per 10 game-minutes. */
  private maxRolling24(slope: Slope, gameTime: number, now: DynamicFeatures): number {
    const key = `${slope.id}|${Math.round(gameTime / 600_000)}`;
    const hit = this.r24Memo.get(key);
    if (hit !== undefined) return hit;
    let r = now.rain24Mm;
    for (let k = 1; k <= R24_LOOKBACK_STEPS; k++) r = Math.max(r, this.features(slope, gameTime - k * R24_LOOKBACK_STEP_H * 3600_000).rain24Mm);
    if (this.r24Memo.size > 20_000) this.r24Memo.clear();
    this.r24Memo.set(key, r);
    return r;
  }

  private elementsMemo = new Map<string, ReturnType<typeof elementsOf>>();
  private elements(slope: Slope) {
    const hit = this.elementsMemo.get(slope.id);
    if (hit) return hit;
    const assets = this.ctx.assetById ? slope.nearbyAssetIds.map((id) => this.ctx.assetById!(id)).filter((a): a is Asset => !!a) : [];
    const els = elementsOf(slope, assets);
    this.elementsMemo.set(slope.id, els);
    return els;
  }

  private annualMemo = new Map<string, number>();
  /** Climatological annual failure probability — static per slope (no monitoring evidence). */
  private pAnnual(slope: Slope): number {
    const hit = this.annualMemo.get(slope.id);
    if (hit !== undefined) return hit;
    const p = annualOccurrence({
      slopeType: slope.slopeType,
      heightM: slope.heightM,
      angleDeg: slope.slopeAngleDeg,
      entliPerKm2: slope.entliPerKm2,
      pastFailures: slope.realIncidents.length,
      susceptibility: slope.susceptibility,
      mitigation: mitigationFactor(slope.mitigations),
    });
    this.annualMemo.set(slope.id, p);
    return p;
  }

  private reachM(slope: Slope): number {
    return slope.census?.reachM ?? Math.max(40, Math.min(220, slope.heightM * 2.1));
  }

  // ---- the chain ----

  private chain(slope: Slope, r24Mm: number, f: DynamicFeatures): RiskChain {
    const occ = occurrence({
      r24Mm,
      slopeType: slope.slopeType,
      heightM: slope.heightM,
      angleDeg: slope.slopeAngleDeg,
      entliPerKm2: slope.entliPerKm2,
      pastFailures: slope.realIncidents.length,
      susceptibility: slope.susceptibility,
      mitigation: mitigationFactor(slope.mitigations),
      evidence: { poreRatio: f.poreRatio, dispRateMmHr: f.dispRateMmHr },
    });
    const mags = magnitude(r24Mm, slope.heightM);
    return riskChain(occ, mags, this.elements(slope), this.reachM(slope), barrierCondition(slope.mitigations), r24Mm, this.pAnnual(slope));
  }

  private scoreOf(chain: RiskChain): number {
    return scoreFromChain(chain.occurrence.p, chain.pllEvent).score;
  }

  private chainAt(slope: Slope, gameTime: number, plusH: number, f0?: DynamicFeatures): RiskChain {
    const f = f0 ?? this.features(slope, gameTime);
    const r24Now = this.maxRolling24(slope, gameTime, f);
    if (plusH === 0) return this.chain(slope, r24Now, f);
    // ahead: the projected trailing-24 h total (Storm Watch ramp / forecast) can only raise the storm's R24 so far;
    // the pore-pressure proxy follows the rain with lag
    // the real 2-h nowcast (nearest HKO station) rides on top of the projection while the twin's clock is near real time
    const nowcast = this.ctx.nowcastMm && Math.abs(gameTime - Date.now()) < 3 * 3600_000 ? this.ctx.nowcastMm(slope, plusH) : 0;
    const futureRain = this.projectRain24(gameTime, plusH) + nowcast;
    const fFuture: DynamicFeatures = {
      ...f,
      rain24Mm: futureRain,
      poreRatio: Math.min(0.99, f.poreRatio * 0.55 + Math.min(1.3, futureRain / 220) * 0.5),
      dispRateMmHr: f.dispRateMmHr * (1 + Math.max(0, futureRain - f.rain24Mm) / 180),
      dispTotalMm: f.dispTotalMm + f.dispRateMmHr * plusH,
    };
    return this.chain(slope, Math.max(r24Now, futureRain), fFuture);
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

  private summarise(c: RiskChain, slope: Slope, gameTime: number): QraSummary {
    const { hazardIdx, consIdx } = scoreFromChain(c.occurrence.p, c.pllEvent);
    const geometryAgeDays = (gameTime - Date.parse(slope.freshness.geometry)) / 86400_000;
    const inspectionAgeDays = (gameTime - Date.parse(slope.freshness.inspection)) / 86400_000;
    const unc = uncertaintyOf(c.occurrence.p, { pastFailures: slope.realIncidents.length, geometryAgeDays, mitigationInspected: inspectionAgeDays < 180 });
    const hasBlocks = c.elements.buildings > 0;
    const pll = pllRange(c.pllEvent, unc.sigma, hasBlocks);
    // consequence given a failure, K = Σ_j P(M_j) · C_j — the loss the precautionary decision is about
    const K = c.magnitude.reduce((s, m, i) => s + m.p * c.consequencePerClass[i], 0);
    const v = K > 0 ? valueOfInformation(c.occurrence.p, unc, K) : null;
    const vu = K > 0 ? upgradeVoi(c.pAnnual, unc, K) : null;
    const pack = (r: NonNullable<typeof v>) => ({
      decision: r.decision,
      expectedLossWaitHKDm: r.expectedLossWaitHKDm,
      actCostHKDm: r.actCostHKDm,
      evpiHKDm: r.evpiHKDm,
      enough: r.enough,
      worthIt: r.worthIt,
      best: r.best ? { id: r.best.id, label: r.best.label, costHKDm: r.best.costHKDm, hours: r.best.hours, voiHKDm: r.best.voiHKDm, ratio: r.best.ratio } : null,
      options: r.options,
    });
    return {
      pAnnual: c.pAnnual,
      pllAnnual: c.pllAnnual,
      voiUpgrade: vu ? pack(vu) : undefined,
      sigma: unc.sigma,
      pFailure5: unc.p5,
      pFailure95: unc.p95,
      pll5: pll.p5,
      pll95: pll.p95,
      uncertaintyParts: { ...unc.parts },
      voi: v ? pack(v) : undefined,
      r24Mm: Math.round(c.r24Mm),
      returnPeriodY: c.returnPeriodY,
      pFailure: c.occurrence.p,
      pFailureBaseline: c.occurrence.baseline,
      pMajor: c.pMajor,
      magnitude: c.magnitude.map((m) => ({ cls: m.cls, label: m.label, volumeM3: m.volumeM3, p: m.p })),
      consequencePerClass: c.consequencePerClass,
      pllEvent: c.pllEvent,
      irEvent: c.irEvent,
      irAnnual: c.irAnnual,
      mostExposedM: c.mostExposedM,
      elements: c.elements,
      hazardIdx,
      consIdx,
    };
  }

  // ---- public API ----

  assess(slope: Slope, gameTime: number): RiskAssessment {
    const f = this.features(slope, gameTime);
    const c = this.chainAt(slope, gameTime, 0, f);
    const score = this.scoreOf(c);
    const category = scoreToCategory(score, slope.hasData);
    const unc = this.confidenceOf(slope, gameTime);

    // drivers: the named log-odds contributions to P(H | R), by absolute size, plus the consequence side
    const parts: Record<string, number> = { ...c.occurrence.logOdds };
    const total = Object.values(parts).reduce((a, b) => a + Math.abs(b), 0) || 1;
    const drivers: RiskDriver[] = Object.entries(parts)
      .map(([factor, v]) => ({ factor: v < 0 ? `${factor} (protective)` : factor, sharePct: Math.round((Math.abs(v) / total) * 100) }))
      .filter((d) => d.sharePct > 0)
      .sort((a, b) => b.sharePct - a.sharePct);

    const trajectory: TrajectoryPoint[] = HORIZONS.map((h) => {
      const s = h === 0 ? score : this.scoreOf(this.chainAt(slope, gameTime, h, f));
      return { horizonH: h, score: Math.round(s), category: scoreToCategory(s, slope.hasData) };
    });

    const past = this.scoreOf(this.chainAt(slope, gameTime - 3 * 3600_000, 0));
    const trend: Trend = score - past > 2.5 ? "up" : past - score > 2.5 ? "down" : "stable";

    const q = this.summarise(c, slope, gameTime);
    const top = drivers.slice(0, 2).map((d) => d.factor);
    const catLabel = category.toUpperCase().replace("-", " ");
    const pct = (p: number) => (p >= 0.01 ? `${(p * 100).toFixed(1)} %` : p >= 1e-4 ? `${(p * 100).toFixed(2)} %` : `${p.toExponential(1)}`);
    const explanation = !slope.hasData
      ? `Insufficient data: this slope has no recent instrumentation or survey coverage, so risk cannot be assessed reliably. Field inspection recommended.`
      : `Risk is ${catLabel} (score ${Math.round(score)}/100). ` +
        `With a maximum rolling 24-h rainfall of ${q.r24Mm} mm (return period ~${q.returnPeriodY} y) the per-storm failure probability P(H|R) is ${pct(q.pFailure)} ` +
        `(statistical correlation for a ${slope.slopeType.replace("-", " ")}: ${pct(q.pFailureBaseline)}; log-odds mainly from ${top.join(" and ")}). ` +
        `A failure would most likely be ${q.magnitude.reduce((a, b) => (b.p > a.p ? b : a)).label}; P(≥ 50 m³) = ${pct(q.pMajor)}. ` +
        `Expected fatalities this storm (PLL) ${q.pllEvent.toExponential(1)} (5–95 %: ${q.pll5.toExponential(1)}–${q.pll95.toExponential(1)})` +
        (q.mostExposedM !== null ? `, individual risk to the nearest resident ${q.irEvent.toExponential(1)} per event (${q.irAnnual.toExponential(1)} /y)` : "") +
        `. ` +
        (trajectory[3].category !== category
          ? `Projected rainfall moves this slope to ${trajectory[3].category.toUpperCase()} within ~6 h. `
          : `No band change expected in the next 6 h. `) +
        `Model confidence ${(unc.confidence * 100).toFixed(0)}% (sensor coverage ${(unc.sensorCoverage * 100).toFixed(0)}%, geometry confidence ${(unc.geometryConfidence * 100).toFixed(0)}%). PoLA chain on real slope, rainfall and exposure data; monitoring evidence and material terms synthetic.`;

    return {
      slopeId: slope.id,
      score: Math.round(score),
      category,
      qra: q,
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

  /** ~4,000 slopes in slices with a yield between slices: no task longer than a few ms. */
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
    const s = this.scoreOf(this.chainAt(slope, gameTime, plusHours));
    return { score: Math.round(s), category: scoreToCategory(s, slope.hasData) };
  }

  projectUnderStorm(slope: Slope, gameTime: number, plusHours: number): RiskAssessment {
    const c = this.chainAt(slope, gameTime, plusHours);
    const s = this.scoreOf(c);
    const base = this.assess(slope, gameTime);
    return { ...base, score: Math.round(s), category: scoreToCategory(s, slope.hasData), qra: this.summarise(c, slope, gameTime) };
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
    let expectedLandslides = 0, expectedLandslides5 = 0, expectedLandslides95 = 0, pllEvent = 0;
    for (const a of assessments.values()) {
      expectedLandslides += a.qra?.pFailure ?? 0;
      expectedLandslides5 += a.qra?.pFailure5 ?? 0;
      expectedLandslides95 += a.qra?.pFailure95 ?? 0;
      pllEvent += a.qra?.pllEvent ?? 0;
    }
    let nowcast2hMm: number | undefined;
    if (this.ctx.nowcastMm && Math.abs(gameTime - Date.now()) < 3 * 3600_000) {
      const sample = slopes.slice(0, 40);
      nowcast2hMm = Math.round((sample.reduce((s, sl) => s + this.ctx.nowcastMm!(sl, 2), 0) / Math.max(1, sample.length)) * 10) / 10;
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
      expectedLandslides,
      expectedLandslides5,
      expectedLandslides95,
      pllEvent,
      nowcast2hMm,
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
        const sc = this.scoreOf(this.chainAt(s, gameTime, 0));
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

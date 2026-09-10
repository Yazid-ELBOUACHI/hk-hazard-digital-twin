// Domain model for the HK Landslide & Flood Digital Twin.
// ALL instance data in the prototype is synthetic; Provenance.isSynthetic marks this per value.

export interface Provenance<T> {
  value: T;
  unit?: string;
  source: string;
  timestamp: string; // ISO 8601
  quality: number; // 0..1
  confidence?: number; // 0..1
  isSynthetic: boolean;
}

export type RiskCategory = "low" | "moderate" | "elevated" | "high" | "critical" | "no-data";
export type Trend = "up" | "down" | "stable";

export type Region = "HK Island" | "Kowloon" | "NT East" | "NT West" | "Lantau";

export type SlopeType = "soil-cut" | "rock-cut" | "fill" | "natural" | "retaining-wall";

export type MitigationType =
  | "soil-nails"
  | "retaining-wall"
  | "debris-barrier"
  | "surface-drainage"
  | "shotcrete"
  | "rock-mesh"
  | "natural-terrain-stabilisation"; // CEDD "NS" feature: nails, buttresses or drains on a natural hillside

export interface Mitigation {
  type: MitigationType;
  installedYear: number; // 0 = not published
  condition: number; // 0..1 (synthetic — no open dataset publishes barrier condition)
  real?: boolean; // the measure itself is a CEDD-registered feature (Catalogue of Slopes ND / NS)
  ref?: string; // its CEDD feature number, e.g. "11NE-A/ND 3"
  note?: string; // published facts: footprint length, maintenance party
}

export type SensorKind =
  | "rainfall"
  | "displacement-total"
  | "displacement-horizontal"
  | "displacement-vertical"
  | "pore-pressure"
  | "groundwater"
  | "gnss-movement"
  | "soil-moisture";

export interface SensorMeta {
  id: string;
  kind: SensorKind;
  installedYear: number;
  online: boolean;
  anomalous: boolean;
}

export type SlopeEventKind =
  | "inspection"
  | "maintenance"
  | "uav-survey"
  | "lidar-survey"
  | "minor-movement"
  | "works"
  | "extreme-rainfall"
  | "sensor-anomaly"
  | "incident";

export interface SlopeEvent {
  date: string; // ISO
  kind: SlopeEventKind;
  label: string;
  detail?: string;
  real?: boolean; // true = from a real government record (CEDD incident database, LPMitP programme)
}

/** REAL — CEDD Landslip Prevention and Mitigation Programme (LPMitP) works entry for this slope. */
export interface WorksProgramme {
  kind: "slope" | "catchment";
  contract: string; // e.g. "GE/2025/10"
  location: string;
  startLabel: string; // "3rd Qtr of 2025" (as published)
  completionLabel: string;
  status: "pending" | "in-progress"; // derived from the published start quarter vs game time
}

/** REAL — 2021 Population Census small-TPU context used to estimate residents within reach. */
export interface CensusContext {
  stpu: string; // small tertiary planning unit group code
  densityPerKm2: number;
  share65Plus: number; // 0..1
  shareUnder15: number; // 0..1
  reachM: number; // radius of the disc used for populationNearby
}

/** REAL — CEDD landslide incident record that references this registered slope number. */
export interface RealIncident {
  date: string | null; // ISO date, null when the record is undated
  volumeM3: number | null;
  ref: string; // CEDD incident reference
}

export interface FreshnessRecord {
  sensor: string; // ISO timestamps of last update per domain
  rainfall: string;
  geometry: string;
  inspection: string;
  simulation: string;
  record: string;
}

export interface SoilParams {
  cohesionKPa: number;
  frictionAngleDeg: number;
  permeability: "low" | "medium" | "high";
  saturationBase: number; // 0..1 typical antecedent saturation
}

export interface DrainageInfo {
  type: "surface-channels" | "raking-drains" | "catchpits" | "none";
  condition: number; // 0..1 (efficiency)
  lastCleared: string;
}

export interface Slope {
  id: string;
  name: string;
  region: Region;
  district: string;
  centroid: [number, number]; // lon, lat
  polygon: [number, number][]; // ring, lon/lat
  elevationM: number;
  heightM: number;
  slopeAngleDeg: number;
  areaM2: number;
  aspectDeg: number; // downhill direction, degrees from north
  slopeType: SlopeType;
  geology: string;
  soil: SoilParams;
  drainage: DrainageInfo;
  vegetationCover: number; // 0..1
  mitigations: Mitigation[];
  nearbyAssetIds: string[];
  sensors: SensorMeta[];
  history: SlopeEvent[];
  freshness: FreshnessRecord;
  susceptibility: number; // 0..1 static baseline
  populationNearby: number; // residents within reach — census-derived when `census` is set, otherwise synthetic
  hasData: boolean; // false → GREY on the map
  isSynthetic: true; // hazard state (sensors, soil, risk) is synthetic; the fields below marked REAL are not
  // ---- REAL context joined from government open data (undefined / empty when unavailable) ----
  works?: WorksProgramme; // CEDD LPMitP upgrading works programme
  census?: CensusContext; // C&SD 2021 census small-TPU
  entliPerKm2?: number; // ENTLI natural-terrain landslide crowns within ~500 m, per km²
  realIncidents: RealIncident[]; // CEDD incidents referencing this slope number
  nearestGauge?: { id: string; name: string; distM: number }; // GEO raingauge (1984→present daily record)
}

export interface SensorReading {
  sensorId: string;
  slopeId: string;
  kind: SensorKind;
  series: { t: string; value: number }[];
  latest: Provenance<number>;
}

/** REAL — summary of the latest HKO live rainfall observation behind the weather state. */
export interface LiveRainSummary {
  obsTime: string; // HKO observation time (ISO, HKT)
  fetchedAt: string;
  stations: number;
  maxMmHr: number;
  meanMmHr: number;
  hours24: number; // hours behind the 24-h totals (24 = complete window)
  source: "server" | "direct";
}

export interface WeatherState {
  rainfallLast24hMm: Provenance<number>;
  rainfallRateMmHr: Provenance<number>;
  forecast72h: { t: string; mmHr: number }[]; // hourly forecast (synthetic)
  stormActive: boolean;
  stormName?: string;
  stormEtaHours?: number;
  temperatureC: number;
  live?: LiveRainSummary; // set when the rainfall provenance above is real HKO data
  nowcast?: NowcastSummary; // HKO 2-hour gridded rainfall nowcast (real), when the server proxy is reachable
}

export interface NowcastSummary {
  updated: string; // HKO issue time (ISO, HKT)
  steps: string[]; // ending times of the four 30-min windows
  mean2h: number; // territory mean of the 2-h accumulation, mm
  max2h: number;
  stations: number;
}

export type IncidentKind = "landslide" | "rockfall" | "debris-flow" | "road-blockage" | "flooding";

export interface Incident {
  id: string;
  slopeId?: string;
  kind: IncidentKind;
  location: [number, number];
  startedAt: string;
  status: "active" | "responding" | "resolved";
  severity: 1 | 2 | 3; // 3 = worst
  description: string;
}

export type AssetKind =
  | "road"
  | "building"
  | "hospital"
  | "school"
  | "kindergarten"
  | "clinic"
  | "fire-station"
  | "police"
  | "railway"
  | "drainage"
  | "utility"
  | "emergency-route";

export interface Asset {
  id: string;
  kind: AssetKind;
  name: string;
  location: [number, number];
  line?: [number, number][]; // for roads/railways
  populationServed: number;
  criticality: number; // 0..1
  sub?: string; // real assets: published subtype (e.g. "Aided primary", "Tower", "Trunk Road")
  real?: boolean; // location/name from government open data (LandsD, HA, EDB, FSD, HKPF, DH)
  estimated?: boolean; // populationServed / criticality are kind-based estimates, not published values
  heightM?: number; // LandsD building block height
  distM?: number; // distance from the slope it was joined to
}

export interface RiskDriver {
  factor: string;
  sharePct: number;
}

export interface TrajectoryPoint {
  horizonH: number; // 0,1,3,6,12,24
  score: number;
  category: RiskCategory;
}

/** The quantitative risk chain behind a score — PoLA (He, Zhang et al. 2023; Zhang & He, IWDTERM 2026), see src/core/pola.ts. */
export interface QraSummary {
  r24Mm: number; // maximum rolling 24-h rainfall at the slope over the trailing day
  returnPeriodY: number; // indicative return period of that rainfall
  pFailure: number; // P(H | R): per-storm failure probability
  pFailureBaseline: number; // the statistical correlation alone, for this feature type
  pMajor: number; // per-storm probability of a failure ≥ 50 m³
  magnitude: { cls: string; label: string; volumeM3: number; p: number }[]; // P(M_j | H, R)
  consequencePerClass: number[]; // expected fatalities given a landslide of each class (mobility × vulnerability × elements)
  pllEvent: number; // expected fatalities in this storm (societal risk per event)
  irEvent: number; // individual risk of the most exposed resident, this storm
  irAnnual: number; // annual individual risk (climatology over the rainfall classes) — against HK criteria 1e-4 existing, 1e-5 new
  pAnnual: number; // annual failure probability
  pllAnnual: number; // expected fatalities per year
  mostExposedM: number | null; // distance of the most exposed person
  elements: { residents: number; buildings: number; facilities: number; roads: number };
  hazardIdx: number; // 0..1 log map of pFailure
  consIdx: number; // 0..1 log map of pllEvent
  // uncertainty — the belief on P(H | R) is a normal on the log-odds (src/core/pola.ts §8)
  sigma: number; // ln-odds standard deviation
  pFailure5: number;
  pFailure95: number;
  pll5: number;
  pll95: number;
  uncertaintyParts: Record<string, number>; // what the σ is made of: correlation, material, hydrology, geometry, mitigation
  voi?: VoiSummary; // what to observe next for this storm's precaution (src/core/pola.ts §9)
  voiUpgrade?: VoiSummary; // what to investigate next for the upgrade decision (25-y horizon)
}

/** Value-of-information summary for the precautionary decision on this slope in the current storm. */
export interface VoiSummary {
  decision: "act" | "wait" | "upgrade" | "defer";
  expectedLossWaitHKDm: number;
  actCostHKDm: number;
  evpiHKDm: number;
  enough: boolean;
  worthIt: boolean; // the best observation pays for itself (VOI / (cost + λ·time) > 1)
  best: { id: string; label: string; costHKDm: number; hours: number; voiHKDm: number; ratio: number } | null;
  options: { id: string; label: string; costHKDm: number; hours: number; voiHKDm: number; ratio: number; sigmaAfter: number }[];
}

export interface RiskAssessment {
  slopeId: string;
  score: number; // 0..100
  category: RiskCategory;
  qra?: QraSummary;
  confidence: number; // 0..1
  trend: Trend;
  drivers: RiskDriver[];
  trajectory: TrajectoryPoint[];
  freshnessPenalty: number;
  sensorCoverage: number; // 0..1
  geometryConfidence: number; // 0..1
  parameterUncertainty: number; // 0..1 (higher = more uncertain)
  explanation: string;
}

// ---------- Simulation ----------

export interface ScenarioParams {
  rainfallMm: number; // event total
  rainfallDurationH: number;
  groundwaterDeltaPct: number; // -50..+50 vs current
  soilSaturationPct: number; // 0..100
  porePressureDeltaPct: number;
  soilStrengthFactor: number; // 0.5..1.5 multiplier
  drainageEfficiencyPct: number; // 0..100
  vegetationPct: number; // 0..100
  existingDisplacementMm: number;
  retainingWallCondition: number; // 0..1
  barrierCondition: number; // 0..1
  seismicPga: number; // earthquake trigger: peak ground acceleration in g (0 = none; HK design level ≈ 0.1–0.15 g)
  // after Zhang & He (IWDTERM 2026): occurrence is driven by antecedent wetness and the storm's peak hour,
  // mobility by entrainment along the path, and the human toll by how early people are warned
  antecedentRain3dMm: number; // rain in the 3 days before the event (0..900)
  peakHourlyMm: number; // peak hourly intensity within the event; >~70 mm/h flips initiation to runoff-driven channelised debris flow
  entrainmentFactor: number; // 0..1 erodibility of the runout path (EDDA erosion/deposition): the flow grows as it travels
  warningLeadTimeMin: number; // minutes between warning and impact; drives the evacuated fraction (0..120)
  interventions: InterventionType[]; // virtual modifications applied before run
}

export type SimulationMode = "instant" | "fast" | "hifi";

export interface SimulationFrame {
  tSec: number;
  phase: "rainfall" | "saturation" | "deformation" | "initiation" | "runout" | "impact" | "settled";
  saturation: number; // 0..1
  deformationMm: number;
  debrisFrontM: number; // distance from crest along runout path
  velocityMs: number;
  affectedPolygon: [number, number][] | null;
  note: string;
}

export interface SimulationResult {
  jobId: string;
  slopeId: string;
  mode: SimulationMode;
  params: ScenarioParams;
  failureProbability: number; // 0..1
  failureLikely: boolean;
  initiationZone: string;
  timeToFailureH: number | null;
  displacedVolumeM3: number;
  runoutDistanceM: number;
  maxVelocityMs: number;
  affectedAreaM2: number;
  roadImpact: "unlikely" | "possible" | "likely";
  buildingsExposed: number;
  peopleExposed: number;
  barrierOvertopped: boolean;
  downstreamFlooding: "unlikely" | "possible" | "likely";
  confidence: number;
  polaFailureProbability?: number; // per-storm P(H | R) of the same event from the PoLA occurrence model (src/core/pola.ts)
  frames: SimulationFrame[];
  runoutPath: [number, number][]; // for map animation
  disclaimer: string;
  computedAt: string;
  isSynthetic: true;
}

/** Live tally from the 3D playback of a scenario: what the animated front has reached so far. */
export interface Sim3dImpact {
  roadContext: string;
  buildingsInScene: number;
  terrainReady: boolean;
  buildings: number;
  roads: number;
  people: number;
  vehicles: number;
  barriers: number; // real CEDD defence measures (ND) the front has reached
  barriersInScene: number;
  frontM: number;
  phase: string;
}

export interface SimulationJob {
  id: string;
  slopeId: string;
  mode: SimulationMode;
  status: "queued" | "running" | "done" | "failed";
  progress: number; // 0..1
  stage: string;
  result?: SimulationResult;
}

// ---------- Interventions ----------

export type InterventionType =
  | "soil-nails"
  | "drainage-improvement"
  | "retaining-wall-new"
  | "retaining-wall-upgrade"
  | "debris-barrier-new"
  | "barrier-strengthening"
  | "monitoring-sensors";

export interface InterventionOption {
  type: InterventionType;
  label: string;
  costHKDm: number; // indicative, HK$ millions
  probReductionFactor: number; // multiplies failure probability
  runoutReductionFactor: number;
  confidence: number;
  description: string;
}

export interface PortfolioItem {
  slopeId: string;
  intervention: InterventionType;
  costHKDm: number;
  riskReduction: number; // expected score reduction
  peopleProtected: number;
}

export interface OptimizerResult {
  objective: string;
  budgetHKDm: number;
  spentHKDm: number;
  items: PortfolioItem[];
  totalRiskReduction: number;
  totalPeopleProtected: number;
  note: string;
}

// ---------- Validation ----------

export interface ValidationRecord {
  incidentId: string;
  slopeId: string;
  date: string;
  modelVersion: string;
  predicted: { failureTimeH: number; runoutM: number; displacementMm: number; areaM2: number };
  observed: { failureTimeH: number; runoutM: number; displacementMm: number; areaM2: number };
}

// ---------- KPIs ----------

export interface KpiSnapshot {
  criticalSlopes: number;
  highRiskSlopes: number;
  elevatedSlopes: number;
  moderateSlopes: number;
  monitoringRequired: number;
  insufficientData: number;
  activeIncidents: number;
  roadsExposed: number;
  buildingsExposed: number;
  populationExposed: number;
  rainfall24hMm: number;
  forecastRainfallMm: number;
  sensorsAnomalous: number;
  sensorsOffline: number;
  simulationsRunning: number;
  expectedLandslides?: number; // Σ P(H | R) over the inventory — landslides expected in the current storm
  expectedLandslides5?: number; // Σ of the 5 % bounds (conservative range)
  expectedLandslides95?: number;
  pllEvent?: number; // Σ expected fatalities over the inventory in the current storm
  nowcast2hMm?: number; // HKO gridded nowcast: territory mean rainfall expected in the next 2 h (real)
  trends: Record<string, Trend>;
}

export type Role = "public" | "engineer" | "emergency" | "admin";

export const RISK_COLORS: Record<RiskCategory, string> = {
  low: "#2fb36b",
  moderate: "#e8c33a",
  elevated: "#f28c28",
  high: "#e04a3a",
  critical: "#c81e1e",
  "no-data": "#7c8794",
};

export const RISK_ORDER: RiskCategory[] = ["low", "moderate", "elevated", "high", "critical"];

export function scoreToCategory(score: number, hasData: boolean): RiskCategory {
  if (!hasData) return "no-data";
  if (score >= 80) return "critical";
  if (score >= 62) return "high";
  if (score >= 45) return "elevated";
  if (score >= 28) return "moderate";
  return "low";
}

export const SIM_DISCLAIMER = "DEMONSTRATION MODEL — NOT FOR ENGINEERING DECISIONS";

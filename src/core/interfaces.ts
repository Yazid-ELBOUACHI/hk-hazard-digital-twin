// Service interfaces — the replaceability contract.
// Frontend components depend ONLY on these; concrete implementations are wired in registry.ts.
// Future real implementations (CEDDSlopeRepository, HKOWeatherProvider, IoTSensorProvider,
// EDDASimulationProvider, GPUAcceleratedSimulationProvider) implement the same contracts.

import type {
  Asset,
  Incident,
  InterventionOption,
  KpiSnapshot,
  RiskAssessment,
  ScenarioParams,
  SensorKind,
  SensorReading,
  SimulationJob,
  SimulationMode,
  Slope,
  ValidationRecord,
  WeatherState,
} from "./types";

export interface SlopeRepository {
  getAll(): Promise<Slope[]>;
  getById(id: string): Promise<Slope | undefined>;
  search(query: string): Promise<Slope[]>;
}

export interface SensorDataProvider {
  /** Time series for one sensor kind on a slope, ending at gameTime (ms epoch). */
  getSeries(slopeId: string, kind: SensorKind, gameTime: number, hours: number): Promise<SensorReading>;
  /** Latest values for all sensor kinds on a slope. */
  getLatestAll(slopeId: string, gameTime: number): Promise<SensorReading[]>;
}

export interface WeatherDataProvider {
  getState(gameTime: number): Promise<WeatherState>;
  /** Regional rainfall multiplier 0..1+ for spatial variation. */
  regionalFactor(lon: number, lat: number): number;
}

export interface IncidentRepository {
  getActive(gameTime: number): Promise<Incident[]>;
  getHistorical(): Promise<Incident[]>;
}

export interface AssetRepository {
  getAll(): Promise<Asset[]>;
  getByIds(ids: string[]): Promise<Asset[]>;
}

export interface InterventionRepository {
  getCatalog(): Promise<InterventionOption[]>;
}

export interface RiskEngine {
  assess(slope: Slope, gameTime: number): RiskAssessment;
  assessAll(slopes: Slope[], gameTime: number): Map<string, RiskAssessment>;
  kpis(slopes: Slope[], assessments: Map<string, RiskAssessment>, gameTime: number): Promise<KpiSnapshot>;
  /** Projected assessment under a storm forecast at +hours. */
  projectUnderStorm(slope: Slope, gameTime: number, plusHours: number): RiskAssessment;
}

export interface SimulationProvider {
  submit(slopeId: string, params: ScenarioParams, mode: SimulationMode): Promise<SimulationJob>;
  getJob(jobId: string): Promise<SimulationJob | undefined>;
  runningCount(): number;
}

export interface ValidationRepository {
  getRecords(): Promise<ValidationRecord[]>;
}

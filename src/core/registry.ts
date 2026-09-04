// Composition root. The ONLY place where concrete implementations are chosen.
// Swapping MockSlopeRepository → CEDDSlopeRepository (etc.) happens here, nowhere else.

import { HeuristicRiskEngine } from "./riskEngine";
import type {
  AssetRepository,
  IncidentRepository,
  InterventionRepository,
  RiskEngine,
  SensorDataProvider,
  SimulationProvider,
  SlopeRepository,
  ValidationRepository,
  WeatherDataProvider,
} from "./interfaces";
import {
  MockAssetRepository,
  MockIncidentRepository,
  MockInterventionRepository,
  MockSensorDataProvider,
  MockSlopeRepository,
  MockValidationRepository,
  MockWeatherDataProvider,
} from "@/mock/repositories";
import { MockSimulationProvider } from "@/mock/MockSimulationProvider";
import { featuresFor, projectedRain24, rainRateAt } from "@/mock/signals";
import { getDataset } from "@/mock/generate";

export interface ServiceRegistry {
  slopes: SlopeRepository;
  sensors: SensorDataProvider;
  weather: MockWeatherDataProvider & WeatherDataProvider; // setStorm is prototype-only control
  incidents: IncidentRepository;
  assets: AssetRepository;
  interventions: InterventionRepository;
  simulation: SimulationProvider;
  validation: ValidationRepository;
  risk: RiskEngine;
}

function buildRegistry(): ServiceRegistry {
  const simulation = new MockSimulationProvider();
  const dataset = getDataset();
  const risk = new HeuristicRiskEngine(
    (slope, t) => featuresFor(slope, t),
    (t, plusH) => projectedRain24(t, plusH),
    {
      activeIncidentSlopeIds: new Set(dataset.activeIncidents.map((i) => i.slopeId ?? i.id)),
      simulationsRunning: () => simulation.runningCount(),
      forecast24Mm: (t) => {
        let sum = 0;
        for (let i = 1; i <= 24; i++) sum += rainRateAt(t + i * 3600_000);
        return sum;
      },
    }
  );

  return {
    slopes: new MockSlopeRepository(),
    sensors: new MockSensorDataProvider(),
    weather: new MockWeatherDataProvider(),
    incidents: new MockIncidentRepository(),
    assets: new MockAssetRepository(),
    interventions: new MockInterventionRepository(),
    simulation,
    validation: new MockValidationRepository(),
    risk,
  };
}

// Built lazily on first use so the real CSDI slope inventory can be fetched first
// (store.init() awaits prepareRealSlopes() before touching the registry).
let built: ServiceRegistry | null = null;
const ensure = (): ServiceRegistry => (built ??= buildRegistry());

export const registry: ServiceRegistry = {
  get slopes() { return ensure().slopes; },
  get sensors() { return ensure().sensors; },
  get weather() { return ensure().weather; },
  get incidents() { return ensure().incidents; },
  get assets() { return ensure().assets; },
  get interventions() { return ensure().interventions; },
  get simulation() { return ensure().simulation; },
  get validation() { return ensure().validation; },
  get risk() { return ensure().risk; },
};

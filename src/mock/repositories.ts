// Mock repository/provider implementations. Replace with real integrations per
// docs/REAL_DATA_INTEGRATION.md — e.g. CEDDSlopeRepository, HKOWeatherProvider, IoTSensorProvider.

import type {
  AssetRepository,
  IncidentRepository,
  InterventionRepository,
  SensorDataProvider,
  SlopeRepository,
  ValidationRepository,
  WeatherDataProvider,
} from "@/core/interfaces";
import type {
  Asset,
  Incident,
  InterventionOption,
  SensorKind,
  SensorReading,
  Slope,
  ValidationRecord,
  WeatherState,
} from "@/core/types";
import { getDataset } from "./generate";
import {
  forecastSeries,
  getStormOverlay,
  rain24At,
  rainRateAt,
  regionalRainFactor,
  sensorValueAt,
  SENSOR_UNITS,
  setStormOverlay,
  stormEtaHours,
} from "./signals";

export class MockSlopeRepository implements SlopeRepository {
  async getAll(): Promise<Slope[]> {
    return getDataset().slopes;
  }
  async getById(id: string): Promise<Slope | undefined> {
    return getDataset().slopes.find((s) => s.id === id);
  }
  async search(query: string): Promise<Slope[]> {
    const q = query.toLowerCase();
    return getDataset()
      .slopes.filter(
        (s) => s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || s.district.toLowerCase().includes(q)
      )
      .slice(0, 20);
  }
}

export class MockSensorDataProvider implements SensorDataProvider {
  private slopeById(slopeId: string): Slope | undefined {
    return getDataset().slopes.find((s) => s.id === slopeId);
  }

  async getSeries(slopeId: string, kind: SensorKind, gameTime: number, hours: number): Promise<SensorReading> {
    const slope = this.slopeById(slopeId);
    const series: { t: string; value: number }[] = [];
    if (slope) {
      const stepMs = Math.max(600_000, (hours * 3600_000) / 48);
      for (let t = gameTime - hours * 3600_000; t <= gameTime; t += stepMs) {
        series.push({ t: new Date(t).toISOString(), value: sensorValueAt(slope, kind, t) });
      }
    }
    const latestVal = series.length ? series[series.length - 1].value : 0;
    return {
      sensorId: `${slopeId}-${kind}`,
      slopeId,
      kind,
      series,
      latest: {
        value: latestVal,
        unit: SENSOR_UNITS[kind],
        source: `mock_${kind.replace(/-/g, "_")}_sensor`,
        timestamp: new Date(gameTime).toISOString(),
        quality: 0.94,
        confidence: 0.9,
        isSynthetic: true,
      },
    };
  }

  async getLatestAll(slopeId: string, gameTime: number): Promise<SensorReading[]> {
    const slope = this.slopeById(slopeId);
    if (!slope) return [];
    const kinds = [...new Set(slope.sensors.filter((s) => s.online).map((s) => s.kind))];
    return Promise.all(kinds.map((k) => this.getSeries(slopeId, k, gameTime, 1)));
  }
}

export class MockWeatherDataProvider implements WeatherDataProvider {
  async getState(gameTime: number): Promise<WeatherState> {
    const stormSince = getStormOverlay();
    const eta = stormEtaHours(gameTime);
    const mk = (value: number, unit: string, source: string) => ({
      value,
      unit,
      source,
      timestamp: new Date(gameTime).toISOString(),
      quality: 0.95,
      isSynthetic: true as const,
    });
    return {
      rainfallLast24hMm: mk(+rain24At(gameTime).toFixed(0), "mm", "mock_rain_network"),
      rainfallRateMmHr: mk(+rainRateAt(gameTime).toFixed(1), "mm/hr", "mock_rain_network"),
      forecast72h: forecastSeries(gameTime, 72),
      stormActive: stormSince !== null,
      stormName: stormSince !== null ? "Synthetic Severe Rainstorm 'DEMO-01'" : undefined,
      stormEtaHours: eta !== null ? Math.max(0, +eta.toFixed(1)) : undefined,
      temperatureC: 27,
    };
  }
  regionalFactor(lon: number, lat: number): number {
    return regionalRainFactor(lon, lat);
  }
  setStorm(activeSince: number | null) {
    setStormOverlay(activeSince);
  }
}

export class MockIncidentRepository implements IncidentRepository {
  async getActive(_gameTime: number): Promise<Incident[]> {
    return getDataset().activeIncidents;
  }
  async getHistorical(): Promise<Incident[]> {
    return getDataset().historicalIncidents;
  }
}

export class MockAssetRepository implements AssetRepository {
  async getAll(): Promise<Asset[]> {
    return getDataset().assets;
  }
  async getByIds(ids: string[]): Promise<Asset[]> {
    const set = new Set(ids);
    return getDataset().assets.filter((a) => set.has(a.id));
  }
}

const CATALOG: InterventionOption[] = [
  { type: "soil-nails", label: "Install soil nails", costHKDm: 8.5, probReductionFactor: 0.45, runoutReductionFactor: 0.85, confidence: 0.8, description: "Grid of grouted nails through the potential slip surface." },
  { type: "drainage-improvement", label: "Improve drainage", costHKDm: 3.2, probReductionFactor: 0.7, runoutReductionFactor: 0.95, confidence: 0.85, description: "New raking drains + channel upgrade to reduce pore pressures." },
  { type: "retaining-wall-new", label: "Add retaining wall", costHKDm: 14.0, probReductionFactor: 0.4, runoutReductionFactor: 0.6, confidence: 0.75, description: "Reinforced concrete wall at slope toe." },
  { type: "retaining-wall-upgrade", label: "Upgrade retaining wall", costHKDm: 6.5, probReductionFactor: 0.65, runoutReductionFactor: 0.75, confidence: 0.78, description: "Strengthen and heighten existing toe wall." },
  { type: "debris-barrier-new", label: "Add debris barrier", costHKDm: 5.8, probReductionFactor: 0.95, runoutReductionFactor: 0.45, confidence: 0.82, description: "Flexible debris-resisting barrier across runout path." },
  { type: "barrier-strengthening", label: "Strengthen existing barrier", costHKDm: 2.4, probReductionFactor: 0.98, runoutReductionFactor: 0.7, confidence: 0.8, description: "Increase capacity of installed barrier." },
  { type: "monitoring-sensors", label: "Add monitoring sensors", costHKDm: 1.2, probReductionFactor: 1.0, runoutReductionFactor: 1.0, confidence: 0.9, description: "GNSS + piezometers; reduces uncertainty, enables early warning (does not change physical risk)." },
];

export class MockInterventionRepository implements InterventionRepository {
  async getCatalog(): Promise<InterventionOption[]> {
    return CATALOG;
  }
}

export class MockValidationRepository implements ValidationRepository {
  async getRecords(): Promise<ValidationRecord[]> {
    return getDataset().validation;
  }
}

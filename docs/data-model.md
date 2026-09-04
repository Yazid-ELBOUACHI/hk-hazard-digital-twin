# Data Model — Hong Kong Landslide & Flood Digital Twin

> All instance data in the prototype is SYNTHETIC and provenance-stamped `isSynthetic: true`.
> The schema below is designed to be materialized in PostgreSQL/PostGIS + a time-series store
> without structural change.

## 1. Provenance (universal wrapper)

Every measured or derived value can be wrapped:

```ts
interface Provenance<T> {
  value: T;
  unit?: string;
  source: string;        // e.g. "mock_displacement_sensor" → later "iot.gnss.station-118"
  timestamp: string;     // ISO 8601
  quality: number;       // 0..1
  confidence?: number;   // 0..1
  isSynthetic: boolean;  // CRITICAL: real feeds set false; UI badges keyed to this
}
```

Postgres mapping: value columns + `source`, `ts`, `quality`, `confidence`, `is_synthetic`
columns (or a JSONB `provenance` column for wide tables).

## 2. Core entities

### Slope (`slopes` table, PostGIS `geometry(Polygon, 4326)`)
- `id` — e.g. `11SW-C/0342` (pattern follows HK-style slope reference conventions but is generated)
- `centroid` lon/lat, `polygon` ring, `elevationM`, `heightM`, `slopeAngleDeg`, `areaM2`,
  `aspectDeg` (orientation)
- `slopeType`: soil-cut | rock-cut | fill | natural | retaining-wall
- `geology`: e.g. completely-decomposed-granite, CDV, colluvium… (labelled synthetic)
- `soil`: { cohesionKPa, frictionAngleDeg, permeability, saturationBase }
- `drainage`: { type, condition 0..1, lastCleared }
- `vegetationCover` 0..1
- `district`, `region` (HK Island / Kowloon / NT East / NT West / Lantau)
- `mitigations[]`: { type (soil-nails | retaining-wall | debris-barrier | drainage | shotcrete | mesh), installed, condition 0..1 }
- `nearbyAssetIds[]` — FK → assets
- `sensors[]`: { id, kind, installed, online }
- `history[]`: timeline events (inspection | maintenance | survey | incident | anomaly | works)
- `freshness`: per-domain `lastUpdated` map (sensor, rainfall, geometry, inspection, simulation, record)
- `susceptibility` 0..1 — static baseline used by the risk engine
- Derived (never stored on the slope by hand): risk score/category, confidence, trajectory

### Sensor reading (time-series store; Timescale hypertable `sensor_readings`)
`(sensor_id, slope_id, kind, ts, value, unit, quality, is_synthetic)`
Kinds: rainfall, displacement-total, displacement-horizontal, displacement-vertical,
pore-pressure, groundwater, gnss-movement, soil-moisture.
Prototype: computed on demand as deterministic f(slopeId, kind, gameTime, storm profile).

### Weather (`weather_frames`)
Regional rainfall intensity + 72 h forecast series; storm events with ramp profiles.

### Incident (`incidents`)
`{ id, slopeId?, kind (landslide | rockfall | debris-flow | road-blockage | flooding),
   startedAt, status, severity, description }`

### Asset (`assets`, PostGIS geometry)
`{ id, kind (road | building | hospital | school | railway | drainage | utility | emergency-route),
   name, geometry, populationServed?, criticality 0..1 }`
Consequence edges: `asset_dependencies (from_id, to_id, relation)` → the city consequence graph.

### Intervention (`interventions` + `intervention_catalog`)
Catalog: { type, indicative cost range, expected effect coefficients (probability reduction,
runout reduction, drainage improvement), confidence }.
Applied interventions reference a slope and feed back into simulation input assembly.

### Simulation (`simulation_jobs`, `simulation_results`, `scenario_library`)
Job: `{ id, slopeId, mode (instant | fast | hifi), params: ScenarioParams, status, progress }`
Result: failure probability, initiation zone, time-to-failure estimate, displaced volume,
runout distance, max velocity, affected area polygon, road/building impact, barrier
interaction, downstream flooding flag, timeline frames for animation, confidence,
`disclaimer: "DEMONSTRATION MODEL — NOT FOR ENGINEERING DECISIONS"`.
Scenario library: grid over rainfall {50…400 mm} × groundwater {low/normal/high} ×
saturation {3 states} × drainage {3 states}, per slope archetype; nearest-neighbor +
linear interpolation for off-grid queries.

### Validation (`prediction_records`)
Predicted vs observed pairs for historical (synthetic) incidents:
failure time, runout, displacement, affected area; error metrics per model version →
"is the model improving" trend.

## 3. Risk model outputs (derived layer)

```ts
interface RiskAssessment {
  score: number;              // 0..100
  category: 'low' | 'moderate' | 'elevated' | 'high' | 'critical' | 'no-data';
  confidence: number;         // 0..1 — INDEPENDENT of category
  trend: 'up' | 'down' | 'stable';
  drivers: { factor: string; sharePct: number }[];   // explainability
  trajectory: { horizonH: 0|1|3|6|12|24; category; score }[];
  freshnessPenalty: number;   // how much staleness degraded confidence
  explanation: string;        // generated plain language
}
```

Risk color semantics (fixed): GREEN low · YELLOW moderate · ORANGE elevated ·
RED high/critical · GREY insufficient data.

## 4. Identifier & time conventions

- All ids are strings, stable across regeneration for a given seed.
- All timestamps ISO 8601 UTC; the simulation clock supplies "now".
- Relative dates are never stored; freshness is computed at read time.

## 5. Prototype → production storage mapping

| Prototype (in-memory) | Production |
|---|---|
| `generate.ts` dataset | PostGIS tables, ingested from CEDD/LandsD sources |
| f(t) sensor synthesis | TimescaleDB hypertables fed by IoT broker |
| Scenario library object | `scenario_library` table + object store for frame payloads |
| Zustand clock | Wall clock / replay service |

# Implementation Plan

## Phase 1 — Functional foundation ✅ (this build)
- Hong Kong 3D map: real basemap + real terrain tiles, synthetic overlays, layer toggles
- Seeded synthetic dataset: ~5,000 slopes, assets, incidents, histories, sensors
- Risk visualization (green/yellow/orange/red/grey) + uncertainty layer
- City KPI dashboard with trends
- Slope selection → Slope Command Center (full workspace, not a popup)
- Synthetic live sensor streams + simulation clock

## Phase 2 — Simulation ✅ (this build)
- Scenario Lab (rainfall, groundwater, saturation, soil strength, drainage, vegetation,
  displacement, wall/barrier condition)
- Mock physics engine behind `SimulationProvider` job API
- Three computational modes (instant / fast / high-fidelity)
- Precomputed scenario library with interpolation
- Animated hazard propagation over terrain + failure cross-section animation with
  play/pause/scrub/speed
- Risk trajectories (+1h…+24h)

## Phase 3 — Decision support ✅ (this build)
- Intervention simulator + side-by-side comparison
- Uncertainty as a first-class layer; data freshness surfaces
- Consequence graph (slope → road → hospital → population)
- Emergency mode (EOC view) + resource allocation recommendations
- Automatic situation report
- City-wide storm mode with projected risk migration

## Phase 4 — Intelligence ✅ prototype-level (this build)
- "Ask the Twin" structured-data Q&A
- Intervention portfolio optimizer (budget + objective, mock logic)
- Model-vs-reality validation module with error trends

## Phase 5 — Real data ⬜ (future)
Replace mock providers one at a time per docs/REAL_DATA_INTEGRATION.md.
Order of attack (lowest risk first):
1. Terrain/basemap hardening (already real) → official DEM
2. `HKOWeatherProvider` (rainfall + forecast)
3. `CEDDSlopeRepository` (registered slope inventory) — biggest schema mapping effort
4. Historical landslide inventory → validation module
5. Asset/GIS layers (roads, buildings, drainage)
6. IoT sensor streams → TimescaleDB → `SensorDataProvider`
7. Real simulation engines behind `SimulationProvider` (surrogate → GPU → full physics)

## Engineering conventions
- No component may import `src/mock/*` directly; only `core/registry.ts` does.
- Every synthetic value is provenance-stamped; UI shows SYNTHETIC badges globally.
- One seed governs all generation (reproducible demos).
- `npm run typecheck` must pass before commit.

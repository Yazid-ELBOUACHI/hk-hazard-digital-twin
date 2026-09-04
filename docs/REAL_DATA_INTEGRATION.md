# Real Data Integration Plan

> Purpose: exact map of where each future real Hong Kong data source plugs into the system.
> **No real API URLs are asserted here.** Every real interface is marked **TO BE VERIFIED (TBV)**
> against the relevant authority (DATA.GOV.HK portal, CEDD/GEO, HKO, LandsD, DSD, BD, C&SD)
> before implementation. The prototype ships exclusively with mock sources.

## Integration contract

A real source replaces a mock by:
1. Implementing the corresponding interface in `src/core/interfaces.ts`
   (moved behind an ingestion service + HTTP API in production).
2. Stamping every value with `Provenance` (`isSynthetic: false`, real `source`, `quality`).
3. Registering in `src/core/registry.ts` (one line).
No frontend component changes.

## Integration matrix

| # | Data required | Current mock source | Expected real source | Format | Update freq | API/File/Stream | Transformation required | DB destination | Frontend consumer |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Registered slope inventory (IDs, geometry, type, features) | `MockSlopeRepository` / `generate.ts` | CEDD/GEO Slope Information System — **TBV** | likely GDB/SHP/CSV — TBV | monthly — TBV | File/API — TBV | ID normalization, geometry → WGS84, schema map → `Slope` | `slopes` (PostGIS) | MapView, SlopeCommandCenter, KPIs |
| 2 | Historical landslide inventory | `generate.ts` incident history | GEO landslide/incident inventories — **TBV** | CSV/GDB — TBV | on release — TBV | File — TBV | Geocoding QA, severity mapping | `incidents`, `prediction_records` | History timeline, Validation, Replay |
| 3 | Rainfall (real-time + gauges) | `MockWeatherDataProvider` | HKO rainfall data / raingauge network — **TBV** | JSON/CSV — TBV | 5–15 min — TBV | API — TBV | Gauge→slope spatial interpolation (e.g. IDW) | `weather_frames`, TS store | KPI, Monitoring charts, RiskEngine |
| 4 | Weather forecast (72 h) | `MockWeatherDataProvider.forecast` | HKO forecast products — **TBV** | JSON — TBV | hourly — TBV | API — TBV | Downscale to per-region series | `weather_frames` | Storm mode, trajectories |
| 5 | Terrain / DEM | AWS terrarium public tiles (real, unofficial) | LandsD digital terrain model — **TBV** | GeoTIFF/tiles — TBV | on release | File/tiles | Reproject, generate terrain-RGB tiles | Object store + tile server | MapView terrain |
| 6 | LiDAR / UAV surveys | `freshness.geometry` synthetic dates | LandsD/GEO LiDAR programmes — **TBV** | LAS/LAZ — TBV | campaign-based | File | Point-cloud → DSM/DTM diff → geometry-change metric | Object store + `surveys` | Slope detail 3D, freshness |
| 7 | Buildings | `MockAssetRepository` | LandsD/BD building GIS — **TBV** | GeoJSON/GDB — TBV | quarterly — TBV | API/File — TBV | Footprint simplification, population join | `assets` | Map layers, consequence graph |
| 8 | Roads & transport network | `MockAssetRepository` | LandsD/TD road network — **TBV** | GDB — TBV | quarterly — TBV | File — TBV | Routing topology build | `assets`, `asset_dependencies` | Exposure, resource travel time |
| 9 | Drainage network | `MockAssetRepository` | DSD drainage records — **TBV** | GDB — TBV | yearly — TBV | File — TBV | Culvert/catchpit → slope association | `assets` | Drainage layer, cascading hazards |
| 10 | Mitigation structures | `slope.mitigations` synthetic | CEDD works records — **TBV** | CSV/GDB — TBV | on works completion | File — TBV | Structure→slope linkage, condition scoring | `interventions` | Interventions, Scenario Lab |
| 11 | IoT slope sensors (displacement, pore pressure, GNSS, moisture) | `MockSensorDataProvider` f(t) synthesis | GEO smart-slope / project IoT deployments — **TBV** | MQTT/JSON — TBV | seconds–minutes | Stream — TBV | Unit normalization, QA/outlier flags, provenance stamp | TimescaleDB `sensor_readings` | Live monitoring, RiskEngine |
| 12 | Inspection records | synthetic `history[]` | CEDD/GEO inspection systems — **TBV** | CSV/API — TBV | continuous | API — TBV | Status taxonomy mapping | `slope_events` | History timeline, freshness |
| 13 | Incident reports (live) | `MockIncidentRepository` | 1823 / EMSD / GEO duty systems — **TBV** | API — TBV | real-time — TBV | API/Stream — TBV | Dedup, geocode, severity | `incidents` | Emergency mode, KPIs |
| 14 | Population / exposure | synthetic per-asset population | C&SD census small-area data — **TBV** | CSV — TBV | census cycle | File — TBV | Areal interpolation to buildings | `assets.population` | Exposure KPIs, optimizer |
| 15 | Landslide runout physics | `MockSimulationProvider` | EDDA / MPM / SPH engines (e.g. HKUST research codes) — **TBV** | model-specific | on demand | Job queue | Input assembly (terrain, rheology), result frame extraction | `simulation_results` | Scenario Lab, animation |
| 16 | Flood simulation | synthetic downstream-flooding flag | DSD/hydraulic models — **TBV** | model-specific | on demand | Job queue | Coupling: debris → drainage blockage → flood extent | `simulation_results` | Cascading hazards |
| 17 | GPU-accelerated solvers | `hifi` mode staged mock | GPU cluster deployment — **TBV** | — | on demand | Job queue | Same `SimulationProvider` contract | `simulation_jobs` | Computational modes |

## Sequencing recommendation

Start with #3/#4 (weather) — smallest schema, immediate credibility gain — then #1 (slopes),
then #2 (validation gets real), then assets (#7–#9), then sensors (#11), then physics (#15–#17).

## Non-negotiables when integrating

- Never mix synthetic and real values in one series without per-point provenance.
- Keep the mock providers permanently: they power offline demos, tests, and training mode.
- Each ingestion writes provenance rows; the UI already renders freshness/quality from them.

# Real Data Integration Plan

> Purpose: map of where each real Hong Kong data source plugs into the system.
>
> **Status 2026-09-06.** Rows marked **DONE** are integrated with verified CSDI / HKO endpoints (see
> `src/core/dataSources.ts` — the registry the in-app *Data Sources* page is generated from, and the
> place that must be updated whenever a source changes). Remaining rows are still **TBV**. The CSDI
> catalogue was surveyed live: 907 of 936 datasets are ArcGIS-REST-queryable and CORS-open; only
> rasters (LandsD DTM, land-utilization grids, historical maps) are WMS-only. Publisher data hosts
> differ: `data.weather.gov.hk` (HKO) is CORS-open on the Open Data API only; `bulkdata.csdi.gov.hk`
> (LiDAR zips) and CSDI's `file-api` are server/build-time only.
>
> Integrated: **#1** slope inventory (CEDD Catalogue of Slopes, + LPMitP works programme),
> **#2** historical landslides (CEDD incidents by slope number; ENTLI natural-terrain inventory as a
> map layer + density grid), **#3** rainfall (HKO live hourly, 36 stations, server-side 24-h
> accumulation; GEO raingauge 1984 → present baked), **#14** population (2021 census small-TPU),
> **#10** partially (LPM works programme as the real works record; mitigation *condition* still synthetic).

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
| 1 | Registered slope inventory (IDs, geometry, type, features) | **DONE** — `fetchRealSlopeShells()` in `src/live/csdi.ts` | CSDI `cedd_rcd_1636517655915_91216` (Catalogue of Slopes) + LPMitP `cedd_rcd_1636520198665_14775` | ArcGIS REST GeoJSON | continuous | API (browser-direct, CORS-open) | `outSR=4326`, 3 m simplification, slope-number normalization (`normSlopeNo`) | in-memory (`getDataset`) | MapView, SlopeCommandCenter, KPIs, Planning |
| 2 | Historical landslide inventory | **DONE** — `src/live/baked/slopeIncidents.ts` (by slope no.), `fetchLandslides()` (map), ENTLI `fetchEntliInBbox()` + `entliGrid.ts` | CSDI `cedd_rcd_1640249280153_17521` (incidents), `cedd_rcd_1636520697377_96152` (ENTLI) | ArcGIS REST | annual / periodic | API + bake (`npm run bake:live`) | HK-date from epoch ms, slope-number join, 250 m grid | in-memory | History timeline (REAL events), map layers, Reports → Rainfall & landslides |
| 3 | Rainfall (real-time + gauges) | **DONE** — `src/live/hko.ts` + `server/liveRain.js` (live), `src/live/baked/rainfall.ts` (GEO 1984 →) | HKO `hourlyRainfall.php` (36 AWS, CORS-open); CSDI `cedd_rcd_1636517963140_47030` (97 GEO gauges, daily) | JSON / ArcGIS REST | hourly (HKO); periodic (GEO, record to 2026-06-30) | server proxy polled every 5 min with rolling 24-h accumulation; bake | nearest-station assignment per slope; `***` sentinel = no record | in-memory; `server/.state/rain.json` | KPI, TopBar, RightPanel, RiskEngine (`rain24Mm`, `rainRateMmHr`), History tab, Reports |
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
| 14 | Population / exposure | **DONE** — `src/live/baked/census.ts`, `realContextFor()` in `generate.ts` | CSDI `censtatd_rcd_1635933193720_58660` (2021 Census, small TPU groups) | ArcGIS REST GeoJSON (50 m simplified) | 5-yearly | bake | point-in-polygon, density × reach disc (2.1 × height, 40–220 m), 65+ share | in-memory (`slope.census`) | Exposure KPIs, consequence cascade, optimizer |
| 15 | Landslide runout physics | `MockSimulationProvider` | EDDA / MPM / SPH engines (e.g. HKUST research codes) — **TBV** | model-specific | on demand | Job queue | Input assembly (terrain, rheology), result frame extraction | `simulation_results` | Scenario Lab, animation |
| 16 | Flood simulation | synthetic downstream-flooding flag | DSD/hydraulic models — **TBV** | model-specific | on demand | Job queue | Coupling: debris → drainage blockage → flood extent | `simulation_results` | Cascading hazards |
| 17 | GPU-accelerated solvers | `hifi` mode staged mock | GPU cluster deployment — **TBV** | — | on demand | Job queue | Same `SimulationProvider` contract | `simulation_jobs` | Computational modes |

## Verified-but-not-yet-integrated CSDI datasets (all REST-queryable, CORS-open)

| Dataset | CSDI id | Size | Would feed |
|---|---|---|---|
| LandsD Building footprints (`BaseHeight`/`TopHeight`) | `landsd_rcd_1637211194312_35158` | 342k polygons | #7 assets — bbox-query around slopes |
| DSD stormwater network (pipes / catchpits / channels / outfalls) | `dsd_rcd_1629267205232_85526` etc. | 107k / 13k / 9k / 1.1k | #9 drainage, cascade |
| Ground Investigation boreholes | `cedd_rcd_1636517845149_16420` | 330k points | subsurface twin |
| Geological Map 1:20k (10 layers) | `cedd_rcd_1636520885302_41109` | — | lithology per slope |
| Historical Landslide Catchment | `cedd_rcd_1636520561809_39343` | 3,163 | runout engine |
| Boulder | `cedd_rcd_1636520781735_27174` | 13.6k | boulder-fall hazard |
| CEDD LiDAR DTM/DSM 2010 & 2020 tile index (bulk zips) | `cedd_rcd_1629267205233_87895` | 3.3k tiles | #5/#6 terrain, DSM differencing |
| 3D Visualisation Map (Cesium 3D Tiles) | `landsd_rcd_1671677054006_62261` | 3,455 tiles | 3D city |
| TD Traffic Snapshot Images (CORS-open JPEGs) | `td_rcd_1638952287148_39267` | 995 cameras | flood-depth sensing |
| SWD care homes, HAD shelters, FSD stations | various | small | evacuation / resources |

## Sequencing recommendation

Start with #3/#4 (weather) — smallest schema, immediate credibility gain — then #1 (slopes),
then #2 (validation gets real), then assets (#7–#9), then sensors (#11), then physics (#15–#17).

## Non-negotiables when integrating

- Never mix synthetic and real values in one series without per-point provenance.
- Keep the mock providers permanently: they power offline demos, tests, and training mode.
- Each ingestion writes provenance rows; the UI already renders freshness/quality from them.

# Architecture — Hong Kong Landslide & Flood Digital Twin

> **STATUS: Prototype. ALL hazard, sensor, slope, and simulation data is SYNTHETIC.**
> Nothing in this system represents real Hong Kong government data. The basemap and
> terrain tiles are real geography; everything painted on top of them is generated.

## 1. Product principle

This is **not** "a 3D map with colored slopes." It is a *simulation-enabled decision-support
operating system* in which the 3D digital twin is the spatial interface. Every feature maps to
one of the eight verbs:

| Verb | Features |
|---|---|
| OBSERVE | 3D map, live sensor streams, KPI dashboard, data freshness |
| UNDERSTAND | Slope Command Center, risk explainability, consequence graph |
| PREDICT | Risk trajectories, storm mode, city-wide projection |
| SIMULATE | Scenario Lab, mock physics engine, animated hazard propagation |
| COMPARE | Intervention comparison, precomputed scenario library |
| DECIDE | Intervention optimizer, resource allocation, situation reports |
| ACT | Emergency mode, recommended actions |
| VALIDATE | Model-vs-reality module, prediction error tracking |

## 2. Layered architecture

The system is strictly layered. Higher layers depend only on the *interfaces* of lower layers,
never on concrete implementations.

```
┌─────────────────────────────────────────────────────────────┐
│  VISUALIZATION   React + MapLibre GL (3D terrain) + charts  │
│                  Role-based UIs, Emergency mode, Ask-Twin   │
├─────────────────────────────────────────────────────────────┤
│  DECISION        RiskEngine · InterventionOptimizer ·       │
│                  ResourceAllocator · SituationReporter      │
├─────────────────────────────────────────────────────────────┤
│  RISK            Risk scoring, trajectories, uncertainty,   │
│                  explainability (driver attribution)        │
├─────────────────────────────────────────────────────────────┤
│  PHYSICS         SimulationProvider (instant / fast / hifi) │
│                  Precomputed scenario library + interpolation│
├─────────────────────────────────────────────────────────────┤
│  DATA            Repositories & Providers (all interfaces)  │
│                  Mock* implementations today, real later    │
└─────────────────────────────────────────────────────────────┘
```

## 3. Service interfaces (the replaceability contract)

All defined in `src/core/interfaces.ts`. The frontend receives them through a
`ServiceRegistry` (`src/core/registry.ts`) — a single composition root. Swapping a mock
for a real source is a one-line change in the registry.

| Interface | Mock (today) | Future real implementation |
|---|---|---|
| `SlopeRepository` | `MockSlopeRepository` | `CEDDSlopeRepository` (registered slope DB) |
| `SensorDataProvider` | `MockSensorDataProvider` | `IoTSensorProvider` (MQTT/stream) |
| `WeatherDataProvider` | `MockWeatherDataProvider` | `HKOWeatherProvider` |
| `IncidentRepository` | `MockIncidentRepository` | Government incident feeds |
| `AssetRepository` | `MockAssetRepository` | GIS/BIM infrastructure data |
| `InterventionRepository` | `MockInterventionRepository` | Works-order / asset-management systems |
| `SimulationProvider` | `MockSimulationProvider` | `EDDASimulationProvider`, `GPUAcceleratedSimulationProvider` |
| `RiskEngine` | `HeuristicRiskEngine` | Calibrated statistical / ML model |

Rules enforced by this design:

1. **No component imports a `Mock*` class.** Components import interfaces and read from the registry.
2. **Every data value can carry provenance** (`Provenance<T>`: source, timestamp, quality,
   confidence, `isSynthetic`). When real feeds arrive, `isSynthetic: false` values flow through
   the identical pipeline and the UI's "SYNTHETIC" badges disappear per-value, not per-release.
3. **All providers are async** (return Promises) even though mocks are synchronous inside —
   so moving them behind an HTTP API layer changes nothing upstream.
4. **Simulation is a job model** (`submit → poll status → fetch result`), matching how a real
   HPC/GPU solver queue behaves. The "instant" mode resolves immediately from the precomputed
   library; "hifi" mode deliberately takes wall-clock time to exercise the async path.

## 4. Frontend runtime

- **Vite + React 18 + TypeScript**, strict mode.
- **MapLibre GL JS** for the geospatial twin: real HK basemap (raster tiles), real 3D terrain
  (public terrarium-encoded DEM tiles, no API key), draped synthetic slope polygons, hillshade,
  runout animation layers. Chosen over CesiumJS to avoid token dependencies; the map component
  is isolated behind `MapView` so the engine can be swapped.
- **Zustand** for app state: simulation clock, layer toggles, selection, role, storm mode,
  scenario state. State is serializable → future collaboration/replay support.
- **Recharts** for time-series and driver charts; bespoke SVG/canvas for the animated
  failure cross-section and trajectory ribbon.

### Simulation clock
A global clock (`clock` slice) advances game-time at selectable speed. Sensor providers are
*functions of (slopeId, gameTime, weather state)* — deterministic and seeded — so scrubbing
time backwards/forwards is exact and reproducible. Risk is recomputed reactively from the
same inputs. This is the same contract a real streaming backend would satisfy with a
time-series DB (see data-model.md §5).

## 5. Backend posture (prototype vs production)

The prototype runs fully client-side for zero-friction demos. The service layer is already
shaped like a backend:

```
Production target:
  Frontend ── HTTPS/JSON ──> API Gateway (Node/Fastify or FastAPI)
                               ├─ PostgreSQL + PostGIS   (slopes, assets, incidents, interventions)
                               ├─ TimescaleDB            (sensor time series)
                               ├─ Object store           (LiDAR, UAV, survey rasters)
                               ├─ Simulation orchestrator (job queue → surrogate | GPU | full physics)
                               └─ Feed ingestors          (HKO, CEDD, IoT brokers) → provenance-stamped rows
```

Each TypeScript interface corresponds 1:1 to a future API resource; the mock classes become
thin HTTP clients (e.g. `HttpSlopeRepository implements SlopeRepository`).

## 6. Computational modes

Users see plain-language modes; the registry maps them to providers:

| User-facing | Prototype behavior | Production target |
|---|---|---|
| INSTANT ESTIMATE | Lookup + interpolation in precomputed scenario library | Surrogate/reduced-order model |
| FAST SIMULATION | Synthetic reduced-order model, ~2 s | GPU-accelerated solver |
| HIGH-FIDELITY | Same model, staged progress, ~10 s | Full physics solver (e.g. MPM/DEM/SPH debris models) |

All three implement `SimulationProvider`; results are labeled
**"DEMONSTRATION MODEL — NOT FOR ENGINEERING DECISIONS."**

## 7. Cross-cutting concerns

- **Data freshness** is first-class: every slope aggregates per-domain freshness
  (sensors, rainfall, geometry, inspection, simulation, records); staleness drives UI badges
  and enters the uncertainty model.
- **Uncertainty ≠ risk.** Risk band and confidence are independent axes everywhere
  (map layer, KPIs, trajectories, Ask-the-Twin queries).
- **Determinism.** One seed (`src/mock/random.ts`) drives all generation; scenarios replay
  identically.
- **Roles.** PUBLIC / ENGINEER / EMERGENCY MANAGER / ADMIN-RESEARCHER gate panel visibility
  and detail level; prototype role switching is a UI control, production would use SSO claims.

## 8. Directory structure

```
docs/                      architecture, data model, plan, real-data integration matrix
src/
  core/
    types.ts               domain model + Provenance<T>
    interfaces.ts          all repository/provider/engine interfaces
    registry.ts            composition root (mock wiring today)
    riskEngine.ts          HeuristicRiskEngine (risk, drivers, trajectory, uncertainty)
    format.ts              shared formatting utilities
  mock/
    random.ts              seeded deterministic RNG
    geo.ts                 HK hill-cluster geography helpers
    generate.ts            city-scale synthetic dataset generation
    MockSlopeRepository.ts
    MockSensorDataProvider.ts
    MockWeatherDataProvider.ts
    MockIncidentRepository.ts
    MockAssetRepository.ts
    MockInterventionRepository.ts
    MockSimulationProvider.ts   (+ precomputed scenario library)
  decision/
    optimizer.ts           intervention portfolio optimizer (mock logic)
    resources.ts           emergency resource allocator (mock logic)
    sitrep.ts              situation report generator
    askTwin.ts             structured-data Q&A engine
  state/
    store.ts               zustand app state (clock, selection, layers, role, storm, …)
  components/              all React UI (MapView, KPI, SlopeCommandCenter, ScenarioLab, …)
  styles.css               command-center design system
```

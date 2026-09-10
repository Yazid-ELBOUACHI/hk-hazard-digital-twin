# Hong Kong Landslide & Flood Digital Twin — Prototype

Simulation-enabled natural-hazard decision-support platform. The 3D digital twin is the
spatial interface; the product is the decision loop: OBSERVE → UNDERSTAND → PREDICT →
SIMULATE → COMPARE → DECIDE → ACT → VALIDATE.

> ⚠️ **What is real and what is synthetic.** Real Hong Kong open data (via CSDI / HKO): the CEDD
> slope inventory and LPM works programme, CEDD landslide incident records, the ENTLI natural-terrain
> landslide inventory, the GEO raingauge record (1984 →), HKO live hourly rainfall, and the 2021 census.
> Synthetic (seeded, reproducible): every risk score, sensor stream, soil parameter, simulation, active
> incident and forecast. Simulation outputs are labeled *"DEMONSTRATION MODEL — NOT FOR ENGINEERING
> DECISIONS."* The full list — dataset, connection type, real/synthetic, freshness — is the in-app
> **Reports → Data Sources** page, generated from `src/core/dataSources.ts`.

## Run

The Scenario Lab's **Run scenario & watch it in 3D** opens a named site with source/runout
labels, a route guide and a narrated event timeline. **Recenter site**, **Source slope** and
**Runout end** recover the view during a demonstration; chapter buttons jump to rainfall,
deformation, runout or the outcome. Stable scenarios also have a 3D sequence. Playback waits
for camera arrival and local geometry (with an eight-second tile wait limit), and reports
missing context. On-map contact counts describe illustrative agents and loaded geometry;
they are not casualty estimates or a physics simulation. Pause, replay and seeking share
the same seeded scene.

```bash
npm install
npm run dev        # → http://localhost:5173 (includes the live HKO rainfall proxy)
npm run typecheck  # strict TS check
npm run build      # production build
npm run bake:live  # re-download and re-bake the census / raingauge / ENTLI / incident chunks (≈ 2 min)
```

Requires internet access (CSDI + HKO APIs, basemap/terrain tiles, fonts).

## What's inside

- **Overview** — 3D Hong Kong with a REAL slope inventory: ~4,150 registered man-made slopes
  (every CEDD Catalogue-of-Slopes feature ≥20 m overall height, plus every slope in the LPM works
  programme) fetched at boot from the CSDI API with real polygons, slope numbers, districts, heights
  and angles. Each slope is then joined to real context — LPM works entry and CEDD incident history
  (by slope number), 2021-census residents within reach and ENTLI landslide density (by location),
  nearest GEO raingauge — and enriched with synthetic hazard state (deterministic per slope number),
  colored by synthetic risk (green→red, grey = insufficient data). Rainfall intensity is **live from
  HKO** (nearest of 36 stations, polled every 5 min) with the synthetic Storm Watch band on top. Elevation/aspect are looked up from the baked DEM
  grids (`npm run terrain` → `src/mock/terrainGrid.ts`). If CSDI is unreachable the app falls
  back to fully synthetic slope placement on real hillsides. Interactive
  legend (click a class to isolate it, counts per class), grouped layer panel (hazard / exposure /
  evidence), light or dark vector basemap with 3D buildings, or satellite imagery (toggle), zoom / rotate /
  tilt / reset camera buttons, hover tooltips on every marker with a "Map symbols" legend, search (`/`), KPIs grouped by question (risk
  picture → exposure → rainfall → data health), a ranked **Needs attention** list with verify /
  rising / stale flags, a dismissible getting-started card, live simulation clock.
- **Slope Command Center** (click any slope, `Esc` closes; also available in Emergency view) —
  bottom line + rule-based **suggested next steps** first, then trajectory, driver attribution,
  cross-section, data freshness, a four-stage **consequence cascade** (trigger → named assets with
  distance → cascading effects → people), engineering detail behind a fold; live sensor charts
  (anomalous sensors flagged); Scenario Lab with storm **presets**, a 3-step guided flow and
  result tiles; history timeline; per-slope model-vs-reality.
- **Scenario Lab** — 11 condition parameters, 3 computational modes (instant = precomputed
  library w/ interpolation, fast = reduced-order, high-fidelity = staged job), animated hazard
  propagation (cross-section + runout corridor over 3D terrain) with play/pause/scrub/speed,
  virtual interventions and side-by-side comparison.
- **Storm Watch** — city-wide synthetic storm; map switches to projected risk at a chosen
  horizon (0–24 h).
- **Emergency** — EOC view: situation numbers, active threats, incidents, mock resource
  deployment recommendations (risk × exposure × uncertainty × travel time).
- **Planning** — intervention portfolio optimizer (budget + objective, mock greedy logic).
- **Reports** — auto-generated situation report; model-validation module (predicted vs
  observed, error trend across model versions); **Rainfall & Landslides** (REAL: 40 years of GEO
  raingauge daily maxima against CEDD landslide incidents — incident rate by rainfall class, annual
  series, top storm days); **Data Sources** (every dataset: what it is, connection type, real or
  synthetic, publisher cadence, freshness in the twin, live load status).
- **Ask the Twin** — chat interface (streamed answers, thinking indicator, slope chips that open
  the Command Center) over rule-based Q&A on the structured twin state.
- **Roles** — Public / Engineer / Emergency Manager / Admin switcher.
- **Live HK data · CSDI / HKO** (`src/live/csdi.ts`, `src/live/hko.ts`) — REAL layers, toggleable
  in the layer panel and labelled "LIVE DATA" in their tooltips:
  - *Registered slopes* — CEDD Catalogue of Slopes, 61,000+ man-made slope polygons; per viewport (zoom ≥ 12).
  - *LPM works* — CEDD LPMitP programme: 386 substandard government slopes and 113 hillside
    catchments under upgrading contracts (contract, start / completion quarter).
  - *Landslide history* — CEDD landslide incident records, ~11,000 points; fetched whole, cached.
  - *Natural terrain landslides* — ENTLI: a baked 250 m density grid of 113,000 landslide crowns
    far out, live crowns + runout trails per viewport at zoom ≥ 13.
  - *Flood blackspots* — DSD flooding blackspots with causes and mitigation status.
  - *Rain gauges (live)* — HKO automatic weather stations with the past-hour reading.
  CSDI's ArcGIS REST API sends permissive CORS headers, so the browser calls it directly — no key,
  no proxy (queries retry on the portal's occasional transient 404). Dataset endpoints were
  discovered through the geoportal metadata API (`/geoportal/rest/metadata/item/<dataset_id>`).
- **Baked open data** (`scripts/build-live-data.mjs` → `src/live/baked/`, `npm run bake:live`) —
  datasets too large or too static to fetch at boot are downloaded once and shipped as lazily
  imported chunks: the 2021 census (211 small-TPU polygons), the GEO raingauge record (97 gauges,
  1.1 M daily readings 1984 → present, reduced to per-gauge monthly/annual series and a territory
  daily series), CEDD incidents keyed by slope number, the ENTLI density grid, and the HKO station
  list. `src/live/baked/manifest.json` records what was baked and when; the Data Sources page shows it.
- **Real exposure assets** (`src/live/realAssets.ts`, baked by `npm run bake:live`) — the map symbols
  and the consequence cascade use government open data instead of synthetic assets: Hospital
  Authority hospitals, EDB schools and kindergartens, FSD fire stations, police stations, DH clinics
  (2,915 points), plus for every registered slope the LandsD building blocks within 150 m (with height)
  and the nearest LandsD road centreline. Road centrelines also draw live per viewport from zoom 13.
  Service population and criticality have no published source and are kind-based estimates, labelled
  "est." wherever shown. Building blocks and school/clinic markers appear from zoom 13 / 12 so the
  16k points never drown the slopes.
- **Live HKO rainfall proxy** (`server/liveRain.js`, `GET /api/live/rainfall`, session-gated; also
  served by a Vite dev middleware) — polls HKO's hourly rainfall API every 5 min and keeps a rolling
  24-hour per-station accumulation persisted to `server/.state/`. The payload's `hours24` says how
  much of the window is covered; the UI labels the 24-h total accordingly. If the server is
  unreachable the browser calls HKO directly (intensity only).

## Look and feel

The skin is Apple's current design language (iOS 26 "Liquid Glass"), implemented in
`src/styles.ios.css`, loaded last: one material — translucent, blurred glass floating over the live
3D map — carries the identity; capsule controls, a segmented navigation control, concentric large radii,
hairline highlights instead of borders, SF-style type with tabular numerals, and the system colours for
the five risk bands. Layout follows one grid: a 12 px outer margin for the toolbar and the map container,
a 12 px inner inset for everything inside the map (HUD widgets are positioned from the map edge, panels
from the page edge, so both land on the same 24 px line), panels only as tall as their content, and a
shared bottom line for legend, pills and panels. Range sliders are filled up to the thumb by
`src/ui/sliders.ts`. Map credits live in the caption under the toolbar, not on the map.

## Performance

The twin stays interactive on an integrated GPU: ~4,150 slopes, terrain and 3D buildings at 35–45 fps,
wheel-to-frame ≈ 30 ms. Rules that keep it so (see `tasks/lessons.md`):

- **Risk pass is cooperative** — `RiskEngine.assessAllAsync` evaluates slopes in slices of 250 and yields
  to the browser between them (`src/core/schedule.ts`); one pass at a time, a forced pass supersedes an
  in-flight one. Phases are timed with `performance.measure("twin:…")`.
- **Colours are feature-state, not GeoJSON** — slope geometry is uploaded once; each refresh diffs the
  assessment per slope and calls `setFeatureState` only for slopes whose band/score changed (and the
  legend filter is a `hidden` state), instead of re-uploading ~2 MB of GeoJSON twice every 10 minutes.
- **No string work in hot loops** — per-slope noise seeds and rain factors are precomputed
  (`keySeed`, `smoothNoiseSeed`); the −24 h trend comparison is memoised per game-hour.
- **3D that stays smooth** — hillshade stops at zoom 14 (invisible under buildings), extrusions are opaque
  (translucent ones cost a second pass), the basemap's flat building fills are hidden under the 3D
  extrusions, pixel ratio is pinned to 1, max zoom is 17.5 (beyond that the camera dips under the
  exaggerated terrain), and the glass blur drops while the camera moves. Measured on an integrated
  AMD GPU: 55 fps at territory zoom, 40–49 fps at building zoom with 3D buildings, wheel-to-frame
  ≈ 20–30 ms. A **2D/3D** switch in the camera pill flattens the map (no terrain, no extrusions).
- **Risk surface at territory zoom** — below zoom 12.5 registered slopes are drawn as soft coloured
  patches per ~280 m cluster (worst band, two overlapping rings, draped on the terrain) instead of
  dots; they cross-fade into the real polygons at zoom 11.5–12.5. Facility markers appear from zoom
  12, LandsD building blocks from 13, each from its own source so nothing is uploaded earlier.
- **Gzip on the wire** — the Express server uses `compression`, so the baked chunks (up to 900 KB of
  building/road neighbours) travel at roughly a quarter of their size; big baked tables are emitted as
  `JSON.parse("…")`, which V8 parses faster than object literals and which keeps `tsc` from choking on
  giant literals.
- **Boot from cache** — inventory pages and the LPM programme are fetched in parallel and kept in the
  browser's Cache Storage for 24 h, so a repeat visit boots in ~2 s; one DEM source feeds both terrain
  and hillshade; 3D buildings start at zoom 14.

## Architecture

See `docs/architecture.md`, `docs/data-model.md`, `docs/implementation-plan.md`, and
`docs/REAL_DATA_INTEGRATION.md`. Key rules: components never import mock code — all data flows
through interfaces (`src/core/interfaces.ts`) wired in one composition root
(`src/core/registry.ts`), so mock providers can be replaced by real HK data sources, IoT
streams and physics engines without touching the frontend; and **every data source is registered
in `src/core/dataSources.ts`** — any change to how data enters the twin (new layer, new feed, a
mock replaced, a re-bake) updates that registry in the same commit, because the Data Sources page
is generated from it.

## Access control

The deployed platform is behind a shared password. The check happens **on the server**:
the app bundle is never sent to a browser without a valid session cookie, so the gate
cannot be bypassed by reading the client JavaScript.

- `GET /login` — branded login page (the only route reachable without a session)
- Session = signed HMAC cookie, `httpOnly`, `sameSite=lax`, `secure` behind HTTPS, 12-hour expiry
- `GET /logout` — ends the session
- Failed logins are throttled to 10 per IP per 15 minutes
- The server **refuses to start** if `APP_PASSWORD` is unset, so it can never be deployed open

| Variable | Purpose |
| --- | --- |
| `APP_PASSWORD` | the shared access password (required) |
| `SESSION_SECRET` | HMAC key for session cookies; set it so sessions survive restarts |
| `PORT` | listen port (Render sets this automatically) |

Run the production server locally:

```bash
npm run build
APP_PASSWORD='choose-a-password' SESSION_SECRET='any-long-random-string' npm start
# → http://localhost:10000
```

## Deploy to Render

`render.yaml` is a Render Blueprint for a free Node web service (Singapore region,
health check on `/login`). `APP_PASSWORD` is marked `sync: false` so Render prompts for it
and the password never lives in git; `SESSION_SECRET` is generated by Render.

1. Render dashboard → **New → Blueprint**
2. Connect this repository and select it
3. Enter a value for `APP_PASSWORD` when prompted, then **Apply**

Subsequent pushes to the default branch redeploy automatically. On the free plan the
service sleeps after inactivity, so the first request after a pause takes ~50 s.

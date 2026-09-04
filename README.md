# Hong Kong Landslide & Flood Digital Twin — Prototype

Simulation-enabled natural-hazard decision-support platform. The 3D digital twin is the
spatial interface; the product is the decision loop: OBSERVE → UNDERSTAND → PREDICT →
SIMULATE → COMPARE → DECIDE → ACT → VALIDATE.

> ⚠️ **ALL hazard, slope, sensor, risk and simulation data is SYNTHETIC** (seeded, reproducible).
> Only the basemap and terrain elevation are real geography (OpenFreeMap light/dark vector tiles or
> Esri World Imagery, plus AWS/Mapzen terrain tiles — all key-free public services). Nothing here represents real Hong Kong
> government data. Simulation outputs are labeled *"DEMONSTRATION MODEL — NOT FOR ENGINEERING
> DECISIONS."*

## Run

```bash
npm install
npm run dev        # → http://localhost:5173
npm run typecheck  # strict TS check
npm run build      # production build
```

Requires internet access (basemap/terrain tiles + fonts).

## What's inside

- **Overview** — 3D Hong Kong with a REAL slope inventory: ~4,000 registered man-made slopes
  (every CEDD Catalogue-of-Slopes feature ≥20 m overall height) fetched at boot from the CSDI
  API with real polygons, slope numbers, districts, heights and angles, then enriched with
  synthetic hazard state (deterministic per slope number) and colored by synthetic risk
  (green→red, grey = insufficient data). Elevation/aspect are looked up from the baked DEM
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
  observed, error trend across model versions).
- **Ask the Twin** — chat interface (streamed answers, thinking indicator, slope chips that open
  the Command Center) over rule-based Q&A on the structured twin state.
- **Roles** — Public / Engineer / Emergency Manager / Admin switcher.
- **Live HK data · CSDI** (`src/live/csdi.ts`) — three REAL layers from the HK Common Spatial
  Data Infrastructure (portal.csdi.gov.hk) ArcGIS REST API, toggleable in the layer panel and
  labelled "LIVE DATA" in their tooltips:
  - *Registered slopes* — CEDD Catalogue of Slopes, 61,000+ man-made slope polygons with slope
    number, height, angle and maintenance party; loaded per viewport (zoom ≥ 12, 3,000/page).
  - *Landslide history* — CEDD landslide incident records, ~11,000 points with dates,
    feature type and slope cross-references; fetched whole via paging, cached.
  - *Flood blackspots* — DSD flooding blackspots with causes and mitigation status.
  CSDI sends permissive CORS headers, so the browser calls the API directly — no key, no proxy.
  Dataset endpoints were discovered through the geoportal metadata API
  (`/geoportal/rest/metadata/item/<dataset_id>`).

## Architecture

See `docs/architecture.md`, `docs/data-model.md`, `docs/implementation-plan.md`, and
`docs/REAL_DATA_INTEGRATION.md`. Key rule: components never import mock code — all data flows
through interfaces (`src/core/interfaces.ts`) wired in one composition root
(`src/core/registry.ts`), so mock providers can be replaced by real HK data sources, IoT
streams and physics engines without touching the frontend.

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

// Single source of truth for every dataset the twin touches. The "Data Sources" panel renders this
// list, and loaders report runtime status through reportSource().
//
// RULE (see tasks/lessons.md): whenever a data source is added, replaced, re-baked, or its connection
// or freshness changes, update this registry in the same commit. Nothing about provenance may live
// only in a component.

import manifest from "@/live/baked/manifest.json";

/** How the data reaches the running twin. */
export type Connection =
  | "live-api" // browser calls the publisher's API directly (CORS-open)
  | "live-proxy" // browser calls our server, which calls the publisher and keeps state
  | "baked" // downloaded by scripts/build-live-data.mjs and shipped inside the bundle
  | "tiles" // streamed map tiles
  | "synthetic"; // generated in the browser, deterministic

export type Realness = "real" | "derived" | "synthetic";

export type SourceGroup = "Slopes & landslides" | "Rainfall & weather" | "Exposure & people" | "Geography & basemap" | "Synthetic twin state";

export interface DataSource {
  id: string;
  name: string;
  provider: string;
  group: SourceGroup;
  what: string; // what the dataset is
  usedFor: string; // what the twin does with it
  connection: Connection;
  realness: Realness;
  sourceCadence: string; // how often the publisher updates it
  freshness: string; // how fresh it is inside the twin
  ref?: string; // dataset id or URL
  records?: string;
}

const m = manifest as {
  census?: { bakedOn: string; units: number; population: number };
  rainfall?: { bakedOn: string; gauges: number; validReadings: number; lastDate: string; linkedIncidents: number; linkedSlopes: number; incidents: number };
  entli?: { bakedOn: string; crowns: number; cells: number; cellM: number; recent: number; relict: number };
  hko?: { bakedOn: string; stations: number };
  facilities?: { bakedOn: string; hospital?: number; school?: number; kindergarten?: number; "fire-station"?: number; police?: number; clinic?: number };
  assets?: { bakedOn: string; slopes: number; withBuildings: number; withRoad: number; buildings: number; roadSegments: number };
};
const isoDate = (yyyymmdd?: string) => (yyyymmdd ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}` : "—");
const n = (v?: number) => (v ?? 0).toLocaleString("en-US");

export const CSDI_PORTAL = "https://portal.csdi.gov.hk";

export const DATA_SOURCES: DataSource[] = [
  // ---------- Slopes & landslides ----------
  {
    id: "cedd-slopes",
    name: "Registered Man-made Slopes (Catalogue of Slopes)",
    provider: "CEDD / GEO",
    group: "Slopes & landslides",
    what: "Every registered man-made slope feature in Hong Kong — cut slopes, fill slopes and retaining walls — with slope number, overall height and angle, location, maintenance party and footprint polygon. 61,000+ features.",
    usedFor: "The twin's slope inventory: all features ≥ 20 m overall height plus every slope in the LPM works programme (~4,300 real polygons, ids and registration attributes). Also the on-demand “Registered slopes” map layer (viewport, zoom ≥ 12).",
    connection: "live-api",
    realness: "real",
    sourceCadence: "Continuous (GEO Slope Information System)",
    freshness: "Fetched at boot (2 paged requests, ~2 MB, 3 m simplified); map layer refetched per viewport",
    ref: "cedd_rcd_1636517655915_91216",
    records: "61k+ features · inventory ≈ 4,300",
  },
  {
    id: "cedd-lpm",
    name: "LPMitP works programme",
    provider: "CEDD / GEO",
    group: "Slopes & landslides",
    what: "Substandard government man-made slopes (386) and natural hillside catchments (113) being upgraded or pending upgrade under current Landslip Prevention and Mitigation Programme contracts, with contract number and start / completion quarter.",
    usedFor: "Real works entry on each affected slope (Overview, History); the “Programmed by GEO” card and exclusion from the portfolio optimizer (Planning); the “LPM works” map layer. Slopes in the programme are pulled into the inventory even when < 20 m.",
    connection: "live-api",
    realness: "real",
    sourceCadence: "As contracts are let (roughly quarterly)",
    freshness: "Fetched at boot (2 requests, ~200 KB)",
    ref: "cedd_rcd_1636520198665_14775 · cedd_rcd_1636520077654_856",
    records: "386 slopes · 113 catchments",
  },
  {
    id: "cedd-incidents-map",
    name: "Landslide incidents — map layer",
    provider: "CEDD / GEO",
    group: "Slopes & landslides",
    what: "The CEDD landslide incident database: ~10,900 reported landslides from 1983 to 2024 with failure date, feature type, failure volume (m³) and, for 42 % of records, the registered slope number involved.",
    usedFor: "The “Landslide history” map layer.",
    connection: "live-api",
    realness: "real",
    sourceCadence: "Annual release",
    freshness: "Fetched when the layer is toggled on (4 pages), cached for the session",
    ref: "cedd_rcd_1640249280153_17521",
    records: `${n(m.rainfall?.incidents)} points`,
  },
  {
    id: "cedd-incidents-slope",
    name: "Landslide incidents — per-slope history",
    provider: "CEDD / GEO",
    group: "Slopes & landslides",
    what: "The same incident database, restricted to records that cite a registered slope number, keyed by that number.",
    usedFor: "Real failure events in each slope's History timeline, the “historical failures” risk driver, and daily incident counts against territory rainfall (Reports → Rainfall & landslides).",
    connection: "baked",
    realness: "real",
    sourceCadence: "Annual release",
    freshness: `Baked ${m.rainfall?.bakedOn ?? "—"} (npm run bake:live)`,
    ref: "cedd_rcd_1640249280153_17521",
    records: `${n(m.rainfall?.linkedIncidents)} incidents on ${n(m.rainfall?.linkedSlopes)} slopes`,
  },
  {
    id: "cedd-entli-live",
    name: "Natural terrain landslides (ENTLI) — crowns & trails",
    provider: "CEDD / GEO",
    group: "Slopes & landslides",
    what: "Enhanced Natural Terrain Landslide Inventory: 113,166 landslide crowns and 113,340 runout trails mapped from aerial photographs 1924–2023. 23k are dated “recent” landslides; 90k are “relict” features from the 1963 baseline photography.",
    usedFor: "The “Natural terrain landslides” map layer — real crowns and runout trails in the viewport at zoom ≥ 13. Natural terrain, so not joined to man-made slope records.",
    connection: "live-api",
    realness: "real",
    sourceCadence: "Periodic GEO update (last mapped year 2023)",
    freshness: "Fetched per viewport (2 requests, trails 3 m simplified), cached by extent",
    ref: "cedd_rcd_1636520697377_96152",
    records: "113k crowns · 113k trails",
  },
  {
    id: "cedd-entli-grid",
    name: "Natural terrain landslides (ENTLI) — density grid",
    provider: "CEDD / GEO (derived)",
    group: "Slopes & landslides",
    what: `ENTLI crown counts on a ${m.entli?.cellM ?? 250} m grid, recent and relict separately.`,
    usedFor: "Territory-wide landslide density at low zoom, and each slope's local ENTLI density (crowns within ~500 m) as one term of its susceptibility baseline.",
    connection: "baked",
    realness: "derived",
    sourceCadence: "—",
    freshness: `Baked ${m.entli?.bakedOn ?? "—"}`,
    ref: "cedd_rcd_1636520697377_96152",
    records: `${n(m.entli?.cells)} occupied cells · ${n(m.entli?.crowns)} crowns`,
  },
  {
    id: "dsd-blackspots",
    name: "Flooding Blackspots",
    provider: "DSD",
    group: "Slopes & landslides",
    what: "Locations the Drainage Services Department currently lists as flooding blackspots, with flooding cause and improvement status.",
    usedFor: "The “Flood blackspots” map layer.",
    connection: "live-api",
    realness: "real",
    sourceCadence: "As DSD reviews the list",
    freshness: "Fetched when the layer is toggled on, cached for the session",
    ref: "dsd_rcd_1728891975004_392",
    records: "a few dozen points",
  },

  // ---------- Rainfall & weather ----------
  {
    id: "geo-raingauge",
    name: "GEO Raingauge Data 1984 → present",
    provider: "CEDD / GEO",
    group: "Rainfall & weather",
    what: `Daily rainfall totals at GEO's ${m.rainfall?.gauges ?? 97} territory raingauges since 1984-01-01 — ${n(m.rainfall?.validReadings)} valid readings.`,
    usedFor: "Real rainfall history: nearest-gauge monthly and annual record on each slope (History tab), territory daily maximum vs landslide incidents and the top storm days (Reports → Rainfall & landslides).",
    connection: "baked",
    realness: "real",
    sourceCadence: `Updated periodically (record currently ends ${isoDate(m.rainfall?.lastDate)})`,
    freshness: `Baked ${m.rainfall?.bakedOn ?? "—"} — per-gauge monthly/annual and territory daily series only (1.1 M raw rows are not shipped)`,
    ref: "cedd_rcd_1636517963140_47030",
    records: `${m.rainfall?.gauges ?? 97} gauges · ${n(m.rainfall?.validReadings)} daily values`,
  },
  {
    id: "hko-live",
    name: "HKO hourly rainfall (live)",
    provider: "Hong Kong Observatory",
    group: "Rainfall & weather",
    what: `Rainfall in the past hour at ${m.hko?.stations ?? 36} automatic weather stations, from the HKO Open Data API.`,
    usedFor: "Current rainfall intensity on every slope (nearest station) — the twin's live rain driver — and the 24-hour total, accumulated hour by hour by the server and labelled with the hours covered. Storm Watch adds its synthetic band on top.",
    connection: "live-proxy",
    realness: "real",
    sourceCadence: "Hourly (published a few minutes past the hour)",
    freshness: "Polled every 5 min; the server keeps a rolling 24-h window. If the server is unreachable the browser calls HKO directly (intensity only, no 24-h total).",
    ref: "data.weather.gov.hk/weatherAPI/opendata/hourlyRainfall.php",
    records: `${m.hko?.stations ?? 36} stations`,
  },
  {
    id: "synthetic-forecast",
    name: "Rainfall forecast & Storm Watch scenario",
    provider: "—",
    group: "Rainfall & weather",
    what: "Deterministic synthetic 72-hour rainfall series and the city-wide “Storm Watch” rain band.",
    usedFor: "Forecast bars, “Next 24 h” KPI, projected risk at a chosen horizon.",
    connection: "synthetic",
    realness: "synthetic",
    sourceCadence: "—",
    freshness: "Recomputed continuously from the simulation clock",
  },

  // ---------- Exposure & people ----------
  {
    id: "census-2021",
    name: "2021 Population Census — small TPU groups",
    provider: "Census & Statistics Department",
    group: "Exposure & people",
    what: `${m.census?.units ?? 211} small tertiary-planning-unit-group polygons with total population, five age bands (0–14 … 65+) and domestic households; ${n(m.census?.population)} residents in total.`,
    usedFor: "Residents within reach of each slope (local density × reach disc) and the 65+ share; exposure KPIs, the consequence cascade and the portfolio optimizer's population objective.",
    connection: "baked",
    realness: "real",
    sourceCadence: "Census every 10 years, by-census every 5",
    freshness: `Baked ${m.census?.bakedOn ?? "—"} (50 m simplified polygons)`,
    ref: "censtatd_rcd_1635933193720_58660",
    records: `${m.census?.units ?? 211} polygons`,
  },
  {
    id: "facilities",
    name: "Hospitals, schools, fire & police stations, clinics",
    provider: "HA · EDB · FSD · HKPF · DH",
    group: "Exposure & people",
    what: `Hospital Authority hospitals (${n(m.facilities?.hospital)}), EDB schools (${n(m.facilities?.school)}) and kindergartens (${n(m.facilities?.kindergarten)}), FSD fire stations (${n(m.facilities?.["fire-station"])}), police stations (${n(m.facilities?.police)}), DH clinics (${n(m.facilities?.clinic)}) — point and English name.`,
    usedFor: "The “Buildings & facilities” map layer, each slope's linked facilities within 500 m (consequence cascade, optimizer's critical-infrastructure objective). Service population and criticality are kind-based estimates, labelled “est.”.",
    connection: "baked",
    realness: "real",
    sourceCadence: "As each department updates its list",
    freshness: `Baked ${m.facilities?.bakedOn ?? "—"}`,
    ref: "fhb_rcd_1637028364270_14638 · edb_rcd_1629267205213_* · hkfsd_rcd_1634798867463_89696 · police_rcd_1639562064290_95464 · dh_rcd_1629267205213_98466",
    records: `${n((m.facilities?.hospital ?? 0) + (m.facilities?.school ?? 0) + (m.facilities?.kindergarten ?? 0) + (m.facilities?.["fire-station"] ?? 0) + (m.facilities?.police ?? 0) + (m.facilities?.clinic ?? 0))} points`,
  },
  {
    id: "landsd-neighbours",
    name: "Building blocks & nearest road per slope",
    provider: "Lands Department (derived)",
    group: "Exposure & people",
    what: `LandsD building blocks (${n(m.assets?.buildings)} active, with height) and road centrelines (${n(m.assets?.roadSegments)} segments) spatially joined to every registered slope in the inventory: blocks within 150 m and the nearest road within 300 m.`,
    usedFor: "The buildings and road in each slope's consequence cascade and exposure counts; building residents are estimated from block height.",
    connection: "baked",
    realness: "derived",
    sourceCadence: "LandsD updates continuously",
    freshness: `Baked ${m.assets?.bakedOn ?? "—"} — ${n(m.assets?.withBuildings)} slopes with buildings, ${n(m.assets?.withRoad)} with a road`,
    ref: "landsd_rcd_1637211194312_35158 · landsd_rcd_1637310758814_80061",
    records: `${n(m.assets?.slopes)} slopes`,
  },
  {
    id: "landsd-roads",
    name: "Road centrelines — map layer",
    provider: "Lands Department",
    group: "Exposure & people",
    what: "LandsD road centreline network (39,877 lines) with street name and class (expressway, trunk, primary, secondary, local).",
    usedFor: "The “Roads” map layer from zoom 13, drawn by class.",
    connection: "live-api",
    realness: "real",
    sourceCadence: "Continuous",
    freshness: "Fetched per viewport at zoom ≥ 13, cached by extent",
    ref: "landsd_rcd_1637310758814_80061",
    records: "39,877 lines",
  },
  {
    id: "synthetic-assets",
    name: "Drainage & utility assets",
    provider: "—",
    group: "Exposure & people",
    what: "Synthetic culvert and substation points inside real hill-massif land footprints (used only when the real asset bake is unavailable, together with synthetic blocks, roads and facilities).",
    usedFor: "Fallback exposure layers and the drainage step of the consequence cascade.",
    connection: "synthetic",
    realness: "synthetic",
    sourceCadence: "—",
    freshness: "Generated at boot, deterministic",
  },

  // ---------- Geography & basemap ----------
  {
    id: "terrain",
    name: "Terrain elevation (DEM)",
    provider: "Mapzen / AWS Open Data",
    group: "Geography & basemap",
    what: "Terrarium-encoded global elevation tiles (~30 m resolution over Hong Kong).",
    usedFor: "3D terrain and hillshade; a baked slope/aspect/elevation grid (npm run terrain) gives each slope its elevation and aspect.",
    connection: "tiles",
    realness: "real",
    sourceCadence: "Static",
    freshness: "Streamed as tiles; grid baked with scripts/build-terrain.mjs",
    ref: "s3.amazonaws.com/elevation-tiles-prod/terrarium",
  },
  {
    id: "basemap",
    name: "Basemap & satellite imagery",
    provider: "OpenFreeMap (OpenMapTiles) · Esri",
    group: "Geography & basemap",
    what: "Light and dark vector basemaps with 3D building extrusions, and Esri World Imagery.",
    usedFor: "Map background.",
    connection: "tiles",
    realness: "real",
    sourceCadence: "Continuous",
    freshness: "Streamed",
  },

  // ---------- Synthetic twin state ----------
  {
    id: "synthetic-sensors",
    name: "Slope sensors & soil parameters",
    provider: "—",
    group: "Synthetic twin state",
    what: "Displacement, pore pressure, GNSS, groundwater and soil-moisture streams, plus soil strength and permeability — deterministic functions of slope number and time.",
    usedFor: "Live Monitoring charts, the pore-pressure and displacement risk drivers, the cross-section.",
    connection: "synthetic",
    realness: "synthetic",
    sourceCadence: "—",
    freshness: "Recomputed every 10 simulated minutes",
  },
  {
    id: "synthetic-risk",
    name: "Risk model, simulation & active incidents",
    provider: "—",
    group: "Synthetic twin state",
    what: "Heuristic risk score and trajectories, mock physics engine (instant / fast / high-fidelity), active incident feed, model-validation records.",
    usedFor: "Everything labelled DEMONSTRATION MODEL — NOT FOR ENGINEERING DECISIONS.",
    connection: "synthetic",
    realness: "synthetic",
    sourceCadence: "—",
    freshness: "Recomputed every 10 simulated minutes",
  },
];

// ---------- runtime status (reported by loaders, mirrored into the store) ----------

export interface SourceStatus {
  at: number; // real-time epoch ms of the report
  ok: boolean;
  count?: number;
  note?: string;
}

const status = new Map<string, SourceStatus>();
const listeners = new Set<() => void>();

export function reportSource(id: string, s: Omit<SourceStatus, "at"> & { at?: number }): void {
  status.set(id, { at: s.at ?? Date.now(), ok: s.ok, count: s.count, note: s.note });
  for (const fn of listeners) fn();
}

export function getSourceStatus(): Record<string, SourceStatus> {
  return Object.fromEntries(status);
}

export function subscribeSources(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

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
  barriers?: { bakedOn: string; nd: number; ns: number; linked: number; linkedSlopes: number };
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
    what: "Every registered slope feature in Hong Kong — cut slopes, fill slopes, retaining walls and natural terrain hazard mitigation measures — with slope number, overall height and angle, location, maintenance party and footprint polygon. 61,000+ features.",
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
    id: "cedd-ntmm",
    name: "Natural terrain hazard mitigation measures — debris-resisting barriers",
    provider: "CEDD / GEO",
    group: "Slopes & landslides",
    what: `The Catalogue of Slopes features registered as natural terrain hazard mitigation measures: ${n(m.barriers?.nd)} ND defence measures (rigid check dams, flexible debris-resisting barriers, earth bunds, boulder fences) and ${n(m.barriers?.ns)} NS stabilisation measures (soil nails, buttresses, raking drains on natural hillsides), each with footprint polygon, location and maintenance party. Barrier type, height and design retention volume are not published.`,
    usedFor: "Real debris-barrier and stabilisation entries on every slope within 200 m (Overview, cross-section); the “Debris barriers” map layer; indicative 4 m walls in the 3D playback that the surge front is tested against. Condition and height are assumptions, labelled as such.",
    connection: "baked",
    realness: "real",
    sourceCadence: "Continuous (GEO Slope Information System)",
    freshness: `Baked ${m.barriers?.bakedOn ?? "—"} — ${n(m.barriers?.linked)} measures within 200 m of an inventory slope (${n(m.barriers?.linkedSlopes)} slopes)`,
    ref: "cedd_rcd_1636517655915_91216 (SLOPE_NO …/ND, …/NS) · DEVB TC(W) 02/2018",
    records: `${n((m.barriers?.nd ?? 0) + (m.barriers?.ns ?? 0))} footprints`,
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
    usedFor: "Real rainfall history: nearest-gauge monthly and annual record on each slope (History tab), territory daily maximum vs landslide incidents and the top storm days (Reports → Rainfall & landslides); the per-gauge totals on the 40 wettest days replay each storm through the risk chain (Reports → Model Validation).",
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
    id: "hko-nowcast",
    name: "HKO gridded rainfall nowcast (next 2 h)",
    provider: "Hong Kong Observatory",
    group: "Rainfall & weather",
    what: "Half-hourly accumulated rainfall nowcast for the next two hours on a ~2 km grid over the Pearl River Delta (SWIRLS radar nowcast), reissued every 12 minutes as a 2.7 MB CSV.",
    usedFor: "The server keeps the Hong Kong cells and reduces them to the twin's 36 HKO stations; each slope's +1 h and +3 h risk trajectory adds its nearest station's nowcast, the KPI panel shows the territory mean, and the storm report quotes it.",
    connection: "live-proxy",
    realness: "real",
    sourceCadence: "Every 12 minutes",
    freshness: "Server re-pulls every 6 minutes; the browser re-checks every 6 minutes. Browser requests time out after 12 seconds; unavailable nowcasts are reported without blocking startup.",
    ref: "https://data.weather.gov.hk/weatherAPI/hko_data/F3/Gridded_rainfall_nowcast.csv · hko_rcd_1634958531320_87755",
    records: "4 × 30-min values per station",
  },
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
    id: "pola-risk",
    name: "Slope risk — PoLA chain (Zhang group, HKUST)",
    provider: "Twin engine · after He, Zhang et al. (2023) and Zhang & He (IWDTERM 2026)",
    group: "Synthetic twin state",
    what: "Risk = P(H|R) · P(M|H,R) · P(L|H,M) · V · E per slope and storm: occurrence from the Hong Kong rainfall–landslide correlations in logistic form, magnitude from the four failure scales, mobility × vulnerability from HK QRA proximity factors, elements at risk from census, LandsD, facility and road data. Every term and coefficient is listed under “How it is calculated” below.",
    usedFor: "Score and band on the map and in every panel, drivers, trajectory, expected landslides and PLL in the KPI panel, the quantitative block in each slope's Overview.",
    connection: "synthetic",
    realness: "derived",
    sourceCadence: "—",
    freshness: "Recomputed every 10 simulated minutes from live rainfall; monitoring-evidence and material terms are synthetic",
    ref: "https://doi.org/10.1061/JGGEFK.GTENG-10980 · https://doi.org/10.1680/jgeot.21.00160 · https://www.cedd.gov.hk/filemanager/eng/content_299/er144.pdf · https://www.cedd.gov.hk/filemanager/eng/content_350/er195links.pdf",
  },
  {
    id: "synthetic-risk",
    name: "Scenario engine, active incidents & validation records",
    provider: "—",
    group: "Synthetic twin state",
    what: "Reduced-order stress-test model behind the Scenario Lab (instant / fast / high-fidelity modes), the active incident feed and the model-validation records.",
    usedFor: "Everything labelled DEMONSTRATION MODEL — NOT FOR ENGINEERING DECISIONS. The Scenario Lab also reports the PoLA per-storm P(H|R) of the same event.",
    connection: "synthetic",
    realness: "synthetic",
    sourceCadence: "—",
    freshness: "Computed on demand",
  },
];

// ---------- Calculations: how every derived number in the twin is produced ----------
//
// RULE: whenever a formula, coefficient or input of a computed quantity changes, update its entry here in the same
// commit. The "How it is calculated" section of the Data Sources page renders this list.

export type CalcGroup =
  | "Hazard & risk — the PoLA chain"
  | "Rainfall"
  | "Slope baseline & monitoring signals"
  | "Exposure & consequence"
  | "Scenario engine & 3D playback"
  | "Planning, KPIs & reports";

export interface Calculation {
  id: string;
  name: string;
  group: CalcGroup;
  output: string; // what comes out and where it is shown
  inputs: string[]; // each tagged (real) / (derived) / (synthetic)
  how: string[]; // the arithmetic, step by step
  realness: Realness; // of the result
  reference?: string;
  code: string; // where it lives
}

export const CALCULATIONS: Calculation[] = [
  // ---------- Hazard & risk — the PoLA chain ----------
  {
    id: "calc-chain",
    name: "Risk chain (structure)",
    group: "Hazard & risk — the PoLA chain",
    output: "Per slope and storm: P(failure), magnitude distribution, expected fatalities (PLL), individual risk, 0–100 score and band.",
    inputs: ["all terms below"],
    how: [
      "Risk(T) = Σ_i Σ_j Σ_k P(H_i | R) · P(M_j | H_i, R) · P(L_k | H_i, M_j) · V(H_i, M_j, E_k) · E_k(T)",
      "H = landslide occurrence on this slope, R = maximum rolling 24-h rainfall, M_j = one of four failure scales, L_k = debris reaching element k, V = vulnerability of that element, E_k = people or facility at k.",
      "The twin evaluates the sum for one slope (i) at a time: PLL = P(H|R) · Σ_j P(M_j|H,R) · C_j, where C_j = Σ_k V_j(d_k) · E_k is the expected loss if a class-j landslide occurs.",
    ],
    realness: "derived",
    reference: "He, Zhang, Xiao, Wang & Luo (2023) J. Geotech. Geoenviron. Eng. 149(5) 04023023; Zhang & He, IWDTERM 2026, slide 37",
    code: "src/core/pola.ts · riskChain()",
  },
  {
    id: "calc-r24",
    name: "R — maximum rolling 24-h rainfall at the slope",
    group: "Hazard & risk — the PoLA chain",
    output: "R24 (mm) used by every term; shown in the slope Overview.",
    inputs: ["HKO past-24-h total at the nearest automatic station (real, server-accumulated)", "Storm Watch overlay (synthetic)", "regional rainfall factor 0.6–1.4 for the synthetic parts (synthetic)"],
    how: [
      "rain24(t) = station mm24 + storm24(t) × regional factor; without live data the synthetic bursty baseline replaces the station total.",
      "R24 = max of rain24 over the trailing day, sampled now and every 4 h back to −24 h (7 samples) — the storm's peak rolling total so far, as in the GEO correlations.",
      "Ahead of now (trajectory), R24 = max(R24 so far, projected trailing-24-h total at t + h).",
    ],
    realness: "derived",
    reference: "GEO Report 144 §4 (max rolling 24-h rainfall as the storm intensity parameter)",
    code: "src/mock/signals.ts · slopeRain(), rain24At(); src/core/riskEngine.ts · maxRolling24()",
  },
  {
    id: "calc-occurrence",
    name: "P(H | R) — occurrence",
    group: "Hazard & risk — the PoLA chain",
    output: "Per-storm probability that the slope fails; its baseline for the feature type; the named log-odds terms shown as “risk drivers”.",
    inputs: ["R24 (derived)", "feature type from the slope number C / F / R (real)", "overall height and angle (real, CEDD)", "CEDD landslide incidents on record for the slope (real)", "ENTLI crowns per km² within 500 m (real, derived)", "registered mitigation works × condition (measure real for CEDD ND/NS features, condition synthetic)", "material susceptibility (synthetic)", "pore-pressure ratio and displacement rate (synthetic monitoring evidence)"],
    how: [
      "Statistical correlation (soil cut slope): log10 P0 = −4 + 0.008 · (R24 − 120) for R24 ≤ 350 mm; +0.002 per mm beyond; capped at 0.03. Anchored at 1e-4 per slope-storm at 120 mm (2,127 registered failures in 22 million slope-storm records, 1984–2017) and at the ~1 % plateau above 350 mm reported in GEO Report 144.",
      "Feature-type rate: soil cut 1.0 · rock cut 0.5 · fill 0.25 · retaining wall 0.12 · natural 0.6 (GEO Report 144 Table 2 landslide counts against the SIS population shares).",
      "Logistic form (Xiao et al. 2023 eq. 1): logit P = logit(P0,type at 0 mm) + Σ terms, with terms: rainfall = logit(P0(R24)) − logit(P0(0)); geometry = 0.9·clamp((angle − 45°)/25°, −1, 1) + 0.5·log10(H/10 m); past failure on CEDD record +0.7; ENTLI +0.4·clamp(log10(1 + density)/2.5, 0, 1); mitigation −1.0 × factor (soil nails 0.35, walls 0.25, drainage 0.25, shotcrete 0.2, mesh 0.15, NS works 0.3, each × condition, sum capped at 1); susceptibility +1.2·(s − 0.5); monitoring evidence +1.2·clamp(pore − 0.55, −0.5, 0.45) + 0.5·clamp(disp rate / 3 mm·h⁻¹, 0, 1).",
      "P(H|R) = sigmoid(logit P), capped at 0.5. Driver shares = |term| / Σ|terms|.",
    ],
    realness: "derived",
    reference: "Yu (2004) GEO Report 144; Xiao, Zhang, Cheung & Lacasse (2023) Géotechnique 73(9) 749–765, eq. (1), Fig. 7, Fig. 11; Xiao & Zhang (2020)",
    code: "src/core/pola.ts · baselineFrequency(), TYPE_RATE, OCCURRENCE_COEF, occurrence()",
  },
  {
    id: "calc-magnitude",
    name: "P(M | H, R) — magnitude",
    group: "Hazard & risk — the PoLA chain",
    output: "Probability of each failure scale given a failure; shown in the slope Overview.",
    inputs: ["R24 (derived)", "slope height (real)"],
    how: [
      "Four scales with their 1984–2017 shares: very minor < 5 m³ 45.0 % (2 m³ representative), minor 5–50 m³ 44.0 % (20 m³), major 50–500 m³ 9.4 % (150 m³), very major ≥ 500 m³ 1.6 % (1,000 m³).",
      "Shares are re-weighted: w_j = share_j · exp(g_j · (R24 − 150)/100 + h_j · log2(H/15 m)), g = [−0.08, 0, 0.22, 0.40], h = [−0.1, 0, 0.2, 0.4], then normalised — heavier storms and taller slopes shift mass to the larger classes (Xiao et al. 2023 Fig. 10: median rainfall of landslide records rises with failure scale; GEO Report 144: major failures ≈ 1/10 of all).",
    ],
    realness: "derived",
    reference: "Xiao et al. (2023) Fig. 4(b), Fig. 10; GEO Report 144 §5",
    code: "src/core/pola.ts · MAGNITUDE_BASE, MAGNITUDE_SHIFT, magnitude()",
  },
  {
    id: "calc-mobility",
    name: "P(L | H, M) · V — mobility × vulnerability",
    group: "Hazard & risk — the PoLA chain",
    output: "V_j(d): probability that a person at plan distance d from the source is killed by a class-j landslide.",
    inputs: ["distance of each element from the slope (real: LandsD block and road distances, facility centroids)", "magnitude class (derived)", "debris-barrier condition (measure real, condition synthetic)"],
    how: [
      "Hong Kong QRA proximity-zone vulnerability factors for open-hillslope debris slides of 30 / 100 / 300 / 1,000 m³ (GEO Report 195 Table 5.9, Wong et al. 2004): e.g. 100 m³ → 0.41 at 5 m, 0.17 at 30 m, 0 beyond 70 m; 1,000 m³ → 0.90 at 5 m, 0.53 at 50 m, 0 beyond 130 m.",
      "Interpolated linearly in distance and in log-volume between the four rows; the 2 m³ class is the 30 m³ row scaled by log10(V+1)/log10(31) (floor 0.15).",
      "A debris-resisting barrier retains a share of the debris: V × (1 − r_j × condition) with r = 0.8 / 0.7 / 0.5 / 0.25 for the four classes (very large failures overtop it).",
      "Residents spread over the reach disc use the area-weighted mean of V_j(r) over 0 < r < reach.",
    ],
    realness: "derived",
    reference: "GEO Report 195 (Landslide Risk Assessment — Application and Practice) Table 5.9; Wong et al. (2004); Ju, Xiao, He, Wang & Zhang (2022) Eng. Geol. 311 for the reach-angle background",
    code: "src/core/pola.ts · PROXIMITY_V, proximityVulnerability(), BARRIER_RETENTION, discAverageVulnerability()",
  },
  {
    id: "calc-elements",
    name: "E — elements at risk",
    group: "Hazard & risk — the PoLA chain",
    output: "The people and facilities each slope can reach, with distances.",
    inputs: ["LandsD building blocks within 150 m with height (real) and their estimated residents (derived)", "nearest LandsD road within 300 m with class (real)", "HA / EDB / FSD / HKPF / DH facilities within 500 m (real)", "2021 census residents within reach (derived from real)"],
    how: [
      "Building block: people = residents estimated from height (see “Residents in a building block”) × exposed share (the two lowest storeys: 2 / storeys, storeys = height / 3 m) × temporal presence 0.65 × building protection 0.1 / 0.25 / 0.5 / 0.8 by landslide class (occupants are shielded from small failures — after the building vs “others” rows of GEO Report 195 Tables 3.7–3.8).",
      "Census residents not already counted as block occupants are spread over the reach disc (radius 2.1 × slope height, 40–220 m) with exposed share 0.3 and the same presence and protection factors.",
      "Facilities and roads use the GEO priority-classification potential loss of life for a direct hit by a 10 m wide, 50 m³ landslide (GEO Report 195 Table 3.5): hospital / school / kindergarten / clinic 3; fire and police stations 2; expressway and trunk road 3; primary road 1; secondary road 0.25; local road 0.03. Scaled by landslide class × 0.1 / 0.5 / 1.5 / 3 and by the distance decay V_j(d)/V_j(5 m).",
    ],
    realness: "derived",
    reference: "GEO Report 195 Table 3.5 (Wong & Ho 1995); Wong, Ho & Chan (1997)",
    code: "src/core/pola.ts · elementsOf(), GROUP_PLL, VOLUME_FACTOR, RESIDENT_PRESENCE, consequenceOf()",
  },
  {
    id: "calc-risk-numbers",
    name: "PLL, individual risk, return period",
    group: "Hazard & risk — the PoLA chain",
    output: "Expected fatalities in the storm (societal risk per event), individual risk of the nearest resident per event and per year, indicative return period of R24.",
    inputs: ["all terms above"],
    how: [
      "PLL_event = P(H|R) · Σ_j P(M_j) · C_j.",
      "P(≥ 50 m³) = P(H|R) · (P(major) + P(very major)).",
      "IR_event = P(H|R) · Σ_j P(M_j) · V_j(d_nearest) · protection_j · 0.65 for a ground-floor occupant of the nearest block (or the mid-radius of the census disc).",
      "Return period T of the current 24-h rainfall: log-interpolated through 100 mm → 2 y, 150 → 10, 275 (1972) → 50, 400 → 100, 623 (2008) → 200, 846 (7 Sep 2023) → 1,000, 956 (1994) → 2,000.",
      "Annual failure probability: storms per year in each R24 class from the return-period table (rate = 1/T(R_i) − 1/T(R_{i+1}); 50–100 mm at 2 a year, assumption) × P(H|R_class) without monitoring evidence, P_annual = 1 − exp(−Σ). IR_annual = IR_event × P_annual / P_event; PLL_annual likewise. Shown against the Hong Kong criteria of 1e-4 /y for existing and 1e-5 /y for new slopes.",
    ],
    realness: "derived",
    reference: "Zhang & He (IWDTERM 2026) slide 4 storm table; ERM (1998) risk guidelines as reproduced in GEO Report 195 §5",
    code: "src/core/pola.ts · riskChain(), returnPeriodYears()",
  },
  {
    id: "calc-score",
    name: "Score 0–100 and band",
    group: "Hazard & risk — the PoLA chain",
    output: "The number and colour on the map, KPI counts by band.",
    inputs: ["P(H|R) (derived)", "PLL_event (derived)", "hasData flag (synthetic)"],
    how: [
      "hazard index = clamp((log10 P(H|R) + 6) / 5, 0, 1): 1e-6 → 0, 1e-1 → 1.",
      "consequence index = clamp((log10 PLL_event + 6) / 5, 0, 1): 1e-6 → 0, 1e-1 → 1.",
      "score = 100 · (0.55 · hazard index + 0.45 · consequence index).",
      "Band: ≥ 80 critical · ≥ 62 high · ≥ 45 elevated · ≥ 28 moderate · else low; grey “insufficient data” when the slope has no coverage.",
    ],
    realness: "derived",
    code: "src/core/pola.ts · SCORE_MAP, scoreFromChain(); src/core/types.ts · scoreToCategory()",
  },
  {
    id: "calc-trajectory",
    name: "Trajectory, trend and storm projection",
    group: "Hazard & risk — the PoLA chain",
    output: "Score at +1, +3, +6, +12, +24 h; the trend arrow; the Storm Watch map colouring.",
    inputs: ["projected trailing-24-h rainfall at t + h (synthetic forecast: Storm Watch ramp + deterministic baseline)", "current synthetic pore ratio and displacement rate"],
    how: [
      "At horizon h: R24 = max(R24 so far, rain24(t + h)); pore ratio → 0.55 × current + 0.5 × min(1.3, rain24/220); displacement rate × (1 + max(0, Δrain)/180); then the same chain and score.",
      "Trend: score now − score 3 h ago; ↑ if > +2.5, ↓ if < −2.5.",
      "Storm Watch colours the map with the +h score of every slope.",
    ],
    realness: "synthetic",
    code: "src/core/riskEngine.ts · chainAt(), projectScore(), projectUnderStorm()",
  },
  {
    id: "calc-confidence",
    name: "Model confidence",
    group: "Hazard & risk — the PoLA chain",
    output: "0.15–0.97 confidence and the purple “uncertainty” tint.",
    inputs: ["online sensors (synthetic)", "geometry and inspection ages (synthetic)", "per-slope parameter uncertainty (deterministic hash of the slope number)"],
    how: [
      "sensor coverage = min(1, online / 5); geometry confidence = max(0.2, 1 − age_days / 720); freshness penalty = min(0.3, geometry age / 3000 + inspection age / 3600); parameter uncertainty = 0.15 + 0.5 × hash(slope) ∈ [0.15, 0.65); anomaly penalty 0.06 if any sensor is anomalous.",
      "confidence = clamp(0.42 + 0.3 coverage + 0.15 geometry + 0.15 (1 − parameter uncertainty) − freshness − anomaly, 0.15, 0.97).",
    ],
    realness: "synthetic",
    code: "src/core/riskEngine.ts · confidenceOf()",
  },

  // ---------- Rainfall ----------
  {
    id: "calc-live-rain",
    name: "Live rainfall at a slope",
    group: "Rainfall",
    output: "Current intensity (mm/h) and past-24-h total on every slope; the KPI rainfall tiles.",
    inputs: ["HKO hourly rainfall API, 36 stations (real)", "HKO station coordinates from CSDI (real)", "Storm Watch band (synthetic)"],
    how: [
      "Server polls HKO every 5 min and keeps a rolling 24-h sum of the past-hour readings per station, labelled with the hours it covers (partial until 24 h have accumulated).",
      "Each slope takes its nearest station (great-circle distance). City-wide KPI rainfall = mean of the first 40 slopes' 24-h totals.",
      "Storm Watch adds a synthetic band: arrives 8 h after activation, ramps over 6 h to 38–60 mm/h, holds 8 h, decays over 8 h; the trailing-24-h storm total is the sum of the past 24 hourly values.",
    ],
    realness: "derived",
    code: "server/liveRain.js; src/live/hko.ts; src/mock/signals.ts · stormRateAt(), storm24At(), slopeRain()",
  },
  {
    id: "calc-rain-history",
    name: "Rainfall history and storm days",
    group: "Rainfall",
    output: "Per-slope nearest-gauge monthly and annual record; territory daily maximum vs landslide incidents; top storm days (Reports).",
    inputs: ["GEO raingauge daily totals 1984 → present, 97 gauges (real)", "CEDD landslide incidents with failure date (real)"],
    how: [
      "Each slope's gauge = nearest of the 97 by distance. Monthly totals and the wettest day per year are summed per gauge at bake time.",
      "Territory series per day: maximum and mean over reporting gauges; landslide incidents counted per day by FAILDATE (HK midnight, +8 h).",
      "Top storm days = the days ranked by territory maximum daily total.",
    ],
    realness: "derived",
    code: "scripts/build-live-data.mjs · bakeRain(); src/live/rainfallHistory.ts",
  },
  {
    id: "calc-return-period",
    name: "Return period of a 24-h rainfall",
    group: "Rainfall",
    output: "“~N-year storm” labels in the Scenario Lab and the risk chain.",
    inputs: ["24-h rainfall (mm)"],
    how: ["Log-linear interpolation through the Hong Kong storm table of Zhang & He (IWDTERM 2026): 100 mm → 2 y, 150 → 10, 275 → 50, 400 → 100, 623 → 200, 846 → 1,000, 956 → 2,000. Scenario events longer than 24 h use the uniform-intensity 24-h share of the total."],
    realness: "derived",
    reference: "Zhang & He (IWDTERM 2026) slide 4",
    code: "src/core/pola.ts · returnPeriodYears(); src/mock/MockSimulationProvider.ts · rolling24hMm()",
  },

  // ---------- Slope baseline & monitoring signals ----------
  {
    id: "calc-susceptibility",
    name: "Material susceptibility baseline (synthetic)",
    group: "Slope baseline & monitoring signals",
    output: "s ∈ [0.03, 0.97] per slope — the synthetic material term of the occurrence model and of the scenario engine.",
    inputs: ["overall angle and height (real, CEDD)", "ENTLI density within 500 m (real, derived)", "two random terms seeded by the slope number (synthetic)"],
    how: ["s = clamp(0.28·(angle − 22)/40 + 0.22·u₁ + 0.20·u₂·u₃ + 0.15·H/180 + 0.15·clamp(log10(1 + ENTLI)/2.5, 0, 1), 0.03, 0.97); when the ENTLI grid is unavailable the last term is a fourth random draw."],
    realness: "synthetic",
    code: "src/mock/generate.ts · slopesFromShells()",
  },
  {
    id: "calc-slope-type",
    name: "Feature type from the registration number",
    group: "Slope baseline & monitoring signals",
    output: "soil cut / rock cut / fill / retaining wall / natural — selects the occurrence rate.",
    inputs: ["CEDD slope number (real)"],
    how: ["The letters after the slash: F → fill; R → retaining wall; C → cut, of which 25 % (seeded draw) are treated as rock cut and the rest soil cut, since rock/soil is not in the open layer; anything else → natural."],
    realness: "derived",
    code: "src/mock/generate.ts · slopeTypeFor()",
  },
  {
    id: "calc-signals",
    name: "Monitoring signals: pore pressure, soil moisture, displacement, GNSS",
    group: "Slope baseline & monitoring signals",
    output: "Live Monitoring charts and the monitoring-evidence term of P(H|R).",
    inputs: ["rain24 at the slope (real when HKO is live)", "soil permeability, drainage condition, saturation base (synthetic)", "smooth noise seeded by the slope number (synthetic)"],
    how: [
      "wet = clamp(rain24/220, 0, 1.4); pore ratio = clamp(0.55·saturation base + 0.5·wet·perm·drain + noise(±0.06), 0.02, 0.99), perm = 0.7 / 1 / 1.25 for high / medium / low permeability, drain = 1.15 − 0.45·drainage condition.",
      "soil moisture = clamp(saturation base + 0.45·wet + noise, 0.05, 1); groundwater Δ% = 60·(pore − 0.6·saturation base).",
      "displacement rate = clamp(0.12·creep + activation·(0.4 + 0.6·noise), 0, 12) mm/h with creep = 0.35·s and activation = 9·s·max(0, pore − 0.55); total = clamp(0.08·creep·T + 0.25·activation·T, 0, 400), T = min(hours since epoch + 36, 96); GNSS = 0.8·total + noise.",
      "Charted sensor values add a small deterministic jitter per 10 min; live rainfall is shown unjittered.",
    ],
    realness: "synthetic",
    code: "src/mock/signals.ts · featuresFor(), sensorValueAt()",
  },

  // ---------- Exposure & consequence ----------
  {
    id: "calc-residents",
    name: "Residents within reach of a slope",
    group: "Exposure & consequence",
    output: "“People nearby” on every slope; the census element of E; the “People near at-risk slopes” KPI.",
    inputs: ["2021 census small-TPU polygons: population, age bands (real)", "slope centroid and height (real)"],
    how: [
      "Census unit = smallest polygon containing the centroid. Density = population / area.",
      "reach = clamp(2.1 × height, 40 m, 220 m); residents = density × π × reach².",
      "Share aged 65+ and under 15 come from the unit's age bands (used by the optimizer's population objective).",
    ],
    realness: "derived",
    code: "src/mock/generate.ts · realContextFor(), censusAt()",
  },
  {
    id: "calc-block-residents",
    name: "Residents in a building block",
    group: "Exposure & consequence",
    output: "People per LandsD block in the consequence chain and in E.",
    inputs: ["LandsD block height and type (real)"],
    how: ["storeys = height / 3 m; residents = 8 per storey for towers / residential blocks, 3 per storey otherwise; minimum 10. Labelled “est.”."],
    realness: "derived",
    code: "src/live/realAssets.ts · residentsFromHeight()",
  },
  {
    id: "calc-facility-est",
    name: "Facility service population and criticality",
    group: "Exposure & consequence",
    output: "The “serves ~N (est.)” and criticality on facilities and roads; the optimizer's critical-infrastructure objective.",
    inputs: ["facility kind (real)", "road class (real)"],
    how: ["Kind-based constants: hospital 60,000 / 0.95; clinic 8,000 / 0.6; school 800 / 0.7; kindergarten 150 / 0.65; fire station 40,000 / 0.9; police 40,000 / 0.75; building 300 / 0.4. Roads by class: expressway 80,000 / 0.95, trunk 40,000 / 0.9, primary 20,000 / 0.8, secondary 8,000 / 0.6, local 2,000 / 0.45. No open dataset publishes these."],
    realness: "synthetic",
    code: "src/live/realAssets.ts · EST, ROAD_SERVED, ROAD_CRIT",
  },
  {
    id: "calc-entli",
    name: "Natural terrain landslide density",
    group: "Exposure & consequence",
    output: "Crowns per km² within ~500 m of a slope; the territory density layer.",
    inputs: ["ENTLI crowns with type and year (real)"],
    how: ["Crowns are counted on a 250 m grid at bake time (recent = dated, relict = 1963 baseline). Per slope: sum of the 5 × 5 cells around the centroid ÷ 1.5625 km²."],
    realness: "derived",
    code: "scripts/build-live-data.mjs · bakeEntli(); src/mock/generate.ts · entliDensityAt()",
  },
  {
    id: "calc-neighbours",
    name: "Slope neighbours: blocks, road, facilities, barriers",
    group: "Exposure & consequence",
    output: "The linked assets of each slope; the real ND/NS mitigation entries.",
    inputs: ["LandsD building blocks (real)", "LandsD road centrelines (real)", "facility points (real)", "CEDD ND/NS features (real)"],
    how: [
      "Spatial join at bake time on a 300 m cell index: the three nearest blocks within 150 m of the slope centroid (with distance), the nearest road segment within 300 m (point-to-segment distance), facilities within 500 m (up to 5), ND/NS measures within 200 m.",
      "Distances are great-circle metres from the slope centroid — an approximation for large features.",
    ],
    realness: "derived",
    code: "scripts/build-live-data.mjs · bakeSlopeAssets(), bakeBarriers(); src/live/realAssets.ts · buildRealAssets()",
  },
  {
    id: "calc-cascade",
    name: "Consequence cascade (slope Overview)",
    group: "Exposure & consequence",
    output: "The “If it fails” chain: trigger → direct impacts → cascading effects → people.",
    inputs: ["linked assets and distances (real)", "last scenario result if any (synthetic)", "residents within reach (derived)"],
    how: ["Reach = last scenario runout, else 2.1 × height; an asset is “in the corridor” when its distance ≤ 2.5 × reach. Served people = Σ populationServed of impacted assets (est.); people affected = scenario peopleExposed, else residents within reach. Effects are rule-based text per asset kind."],
    realness: "synthetic",
    code: "src/components/scc/ConsequenceChain.tsx",
  },

  // ---------- Scenario engine & 3D playback ----------
  {
    id: "calc-scenario-prob",
    name: "Scenario stress-test failure probability",
    group: "Scenario engine & 3D playback",
    output: "“Failure probability” and FAILURE LIKELY / UNLIKELY in the Scenario Lab; drives the runout and the 3D playback.",
    inputs: ["scenario sliders (user)", "material susceptibility (synthetic)", "interventions chosen (user)"],
    how: [
      "A conditional what-if index, not a frequency: prob = clamp(0.42·s + 0.34·clamp(rain/320, 0, 1.3) + 0.16·sat + 0.10·gw + 0.08·pore + disp + quake + runoff − 0.22·drainage − 0.06·vegetation − 0.5·(strength − 1), 0.01, 0.99)",
      "with sat = clamp(saturation/100 + 0.25·antecedent/900, 0, 1); gw = clamp(0.5 + Δgw/60, 0, 1.2); pore = clamp(0.5 + Δpore/80, 0, 1.3); disp = clamp(existing displacement/120, 0, 0.4); quake = clamp(PGA/0.4, 0, 1.25)·(0.16 + 0.22·sat); runoff = 0.06·clamp(peak hourly/150, 0, 1.6) when the peak hour exceeds 70 mm/h (channelised initiation, EDDA's second mechanism).",
      "Each intervention multiplies prob (soil nails 0.45, drainage 0.7, new wall 0.4, wall upgrade 0.65, new barrier 0.95, barrier strengthening 0.98, sensors 1.0). Failure likely when prob > 0.5.",
      "The same event is also run through the PoLA occurrence model with R24 = the event's 24-h share and the antecedent term (+0.6·clamp(antecedent/300, 0, 1)), reduced by the same intervention factors — reported as “P(H | R) this storm · PoLA”.",
    ],
    realness: "synthetic",
    reference: "Shen, Zhang, Chen & Fan (2018) EDDA 2.0, Geosci. Model Dev. 11 (two initiation mechanisms); Zhang & He (IWDTERM 2026)",
    code: "src/mock/MockSimulationProvider.ts · coreModel()",
  },
  {
    id: "calc-scenario-runout",
    name: "Scenario volume, runout, velocity, barrier, exposure",
    group: "Scenario engine & 3D playback",
    output: "Displaced volume, runout distance, max velocity, affected area, road impact, buildings and people exposed, barrier overtopped, downstream flooding, time to failure.",
    inputs: ["scenario probability (synthetic)", "slope area, height, aspect (real)", "linked assets (real)", "residents within reach (derived)", "warning lead time (user)"],
    how: [
      "depth = 1 + 3.5·prob m; source volume = area × depth × (0.25 + 0.5·prob).",
      "runout = clamp(H·(1.4 + 2.6·prob)·(0.8–1.2 seeded)·(1 + 0.35·quake)·(1 + 0.45·entrainment)·(1.15 if runoff-driven) × intervention runout factors × barrier factor (1 − 0.3·condition when condition > 0.5) × (2 − wall factor), 10, 900) m.",
      "displaced volume = source × (1 + entrainment·clamp(runout/300, 0, 1.5)); max velocity = (2 + 16·prob·runout/400)·(1 + 0.25·peak factor if runoff-driven) m/s; affected area = 0.6·runout·√area.",
      "barrier overtopped when a barrier exists and displaced volume × prob > 6,000 m³ × barrier condition. Road impact: unlikely if no road or prob < 0.3, likely if prob × reach > 0.45 (reach = clamp(runout/260, 0, 1)), else possible. Buildings exposed = blocks × (2 + 12·prob) × reach when failure likely.",
      "people exposed = residents × prob × reach × 0.8 × (1 − evacuated), evacuated = clamp(lead time / 45 min, 0, 0.85). Time to failure = 2 + 26·(1 − prob) h, 0.1 h for a quake. Runout path = 12 steps along the DEM aspect with a seeded wobble.",
      "Instant mode snaps groundwater / saturation / drainage to the nearest library node and interpolates linearly between the two bracketing rainfall nodes (50 … 400 mm).",
    ],
    realness: "synthetic",
    code: "src/mock/MockSimulationProvider.ts · coreModel(), makeRunoutPath(), compute()",
  },
  {
    id: "calc-3d",
    name: "3D playback: flow, hits, barriers",
    group: "Scenario engine & 3D playback",
    output: "The debris flow over the terrain and the tally of buildings, roads, people, vehicles and barriers reached.",
    inputs: ["scenario runout path and distance (synthetic)", "terrain elevation (real DEM)", "basemap building footprints and LandsD road centrelines (real)", "CEDD ND barrier footprints (real)"],
    how: [
      "The front follows the scenario frames; corridor half-width = (7 + 28*s/L) * scale m, where scale = clamp(L/120, 0.25, 1). Thickness rises from 1.4 * scale to 6.6 * scale m over the last min(45, 0.6L) m. Particle and boulder sizes use the same illustrative scale so short runouts stay proportionate.",
      "A building, road sample, person, vehicle or barrier is “hit” when any of its points falls inside the corridor behind the front. Barriers are the real ND footprints within 570 m of the toe, drawn 4 m tall (the register has no height).",
      "People and vehicles are synthetic agents on the real road centrelines within 420 m; with a warning lead time up to 85 % of people walk away from the toe first.",
      "The camera frames the source polygon and entire route, including a 55 m margin for the deposit. Local geometry is sampled after arrival; road lines are clipped to a 420 m square around the toe. No road is fabricated when geometry is missing, and loaded road/building context is shown in the HUD.",
      "The 60-second presentation timeline interpolates model frames. Traffic placements are seeded per slope; first contacts are sampled every half model-second and cached, so pause, replay and seeking preserve the same outcome. Displayed contacts are illustrative, not casualty estimates. Stable results release no debris.",
      "The route is resampled at 8 m intervals, and debris elevations follow the DEM across the corridor width. Site labels and the gold route remain visible through terrain for orientation; the route is an illustrative scenario path, not a terrain-resolved physics calculation.",
    ],
    realness: "synthetic",
    code: "src/map/debris3d.ts",
  },

  // ---------- Planning, KPIs & reports ----------
  {
    id: "calc-kpis",
    name: "City KPIs",
    group: "Planning, KPIs & reports",
    output: "Counts by band, people near at-risk slopes, roads and buildings exposed, expected landslides and PLL, trends.",
    inputs: ["every slope's assessment (derived)"],
    how: [
      "Counts = slopes per band. People near at-risk slopes = Σ residents within reach over high and critical slopes; roads / buildings exposed = distinct linked assets of those slopes.",
      "Expected landslides this storm = Σ P(H|R); expected fatalities = Σ PLL_event over the inventory.",
      "Trend arrows compare with the same counts 24 h earlier (memoised per game-hour).",
    ],
    realness: "derived",
    code: "src/core/riskEngine.ts · kpis()",
  },
  {
    id: "calc-optimizer",
    name: "Portfolio optimizer",
    group: "Planning, KPIs & reports",
    output: "The intervention portfolio for a budget and objective.",
    inputs: ["scores and confidence (derived)", "intervention catalogue: cost, probability-reduction factor (synthetic)", "residents within reach and 65+ share (real census)", "LPM works programme membership (real)"],
    how: [
      "Candidates = the 60 highest-scoring elevated/high/critical slopes not already in CEDD's LPM programme. Per option: risk reduction = score × (1 − factor) × (0.7 + 0.3·option confidence); people protected = 0.6 × residents × (1 − factor).",
      "Value per HK$ M: risk objective = reduction / cost; population = people protected × (1 + 1.5 × share 65+) / cost; critical infrastructure = reduction × (2.5 if a facility is linked and residents > 800, else 0.6) / cost.",
      "Greedy pick by value, one intervention per slope, within budget, at most 12 items.",
    ],
    realness: "synthetic",
    code: "src/decision/optimizer.ts",
  },
  {
    id: "calc-reports",
    name: "Rainfall & landslides report",
    group: "Planning, KPIs & reports",
    output: "Daily territory rainfall vs incidents, the top storm days, annual wettest-day series.",
    inputs: ["baked GEO raingauge record and CEDD incidents (real)"],
    how: ["Straight reads of the baked series (see “Rainfall history and storm days”); no modelling."],
    realness: "real",
    code: "src/components/RainfallLandslidesPane.tsx; src/live/rainfallHistory.ts",
  },

  // ---------- Uncertainty, value of information, storm report, validation, nowcast ----------
  {
    id: "calc-uncertainty",
    name: "Uncertainty on P(H | R) and PLL",
    group: "Hazard & risk — the PoLA chain",
    output: "σ on the log-odds, the 5–95 % range of P(H|R) and of the expected fatalities, and the parts σ is made of (slope Overview; KPI range).",
    inputs: ["CEDD incident record for the slope (real)", "geometry survey age and inspection age (synthetic)", "whether blocks are joined (real)"],
    how: [
      "Prior σ parts (ln-odds): correlation scatter 0.55, material 0.6, hydrology 0.5, geometry 0.15 (0.3 when the survey is > 2 y old), mitigation 0.4 (0.15 within 180 d of an inspection). A slope with a CEDD incident on record has correlation × 0.8 and material × 0.7 — its behaviour is partly known.",
      "σ = √Σ parts²; P5/P95 = sigmoid(logit P ∓ 1.645 σ).",
      "PLL range: lognormal with σ_PLL = √(σ² + σ_E² + σ_V²), σ_E = 0.25 with LandsD blocks joined or 0.45 census-only, σ_V = 0.5 for the vulnerability factors.",
      "The KPI range sums the per-slope 5 % and 95 % bounds — a conservative envelope, not a joint interval.",
    ],
    realness: "derived",
    reference: "GEO Report 144 (correlation coefficient ≈ 0.9); El Bouachi (2026) PhD proposal, Stage A",
    code: "src/core/pola.ts · UNCERTAINTY_PRIOR, uncertaintyOf(), pllRange()",
  },
  {
    id: "calc-voi",
    name: "Value of information — what to observe next",
    group: "Hazard & risk — the PoLA chain",
    output: "Per slope and decision (storm precaution; 25-year upgrade): act / wait, expected loss of waiting, EVPI, and each observation's VOI, cost, time and ratio (slope Overview; Planning → Where to investigate next; Ask the Twin).",
    inputs: ["P(H|R) and σ (derived); annual P(failure) for the upgrade decision (derived)", "consequence given a failure K = Σ_j P(M_j)·C_j (derived)", "VSL HK$30 M (after Hong Kong transport appraisal practice), precaution cost HK$0.08 M (a day's road closure and crew), upgrade HK$5 M over a 25-year life, λ = HK$0.002 M per hour (assumptions)", "observation catalogue: inspection HK$0.02 M / 4 h; UAV-LiDAR 0.08 / 8 h; piezometer + moisture 0.15 / 24 h; GNSS / inclinometer 0.3 / 48 h; ground investigation 0.8 / 720 h (assumptions)"],
    how: [
      "Two decisions share one machinery. Storm: loss(wait | p) = p · K · VSL on the per-storm belief; loss(act) = HK$0.08 M. Upgrade: loss(defer | p_annual) = p_annual · K · VSL · 25 y; loss(upgrade) = HK$5 M. Under the lognormal belief E[p] = p̂ · exp(σ²/2); act when the expected loss of waiting exceeds the action's cost.",
      "Each observation collapses named σ parts to a posterior value (e.g. piezometer: hydrology 0.5 → 0.2); σ' = √Σ parts'².",
      "VOI = E_prior[min(C, E[p]·K·VSL)] − E_m[min(C, E[p|m]·K·VSL)], the posterior mean m lognormal with variance σ² − σ'² (Raiffa–Schlaifer preposterior analysis), integrated with 21-point Gauss–Hermite quadrature.",
      "EVPI = the same with σ' = 0. Ranking J = VOI / (cost + λ·hours); the top option is reported with whether J > 1 (it pays for itself). “Enough evidence” when EVPI < the cheapest observation.",
    ],
    realness: "derived",
    reference: "Raiffa & Schlaifer (1961); El Bouachi (2026) PhD proposal, eqs. (1)–(2), Stages B–C",
    code: "src/core/pola.ts · OBSERVATIONS, VOI_PARAMS, valueOfInformation()",
  },
  {
    id: "calc-storm-report",
    name: "Storm report and the expected-landslides grid",
    group: "Planning, KPIs & reports",
    output: "Reports → Storm Report; the “Expected landslides grid” map layer; Ask the Twin “storm report”.",
    inputs: ["every slope's assessment (derived)", "HKO nowcast (real)", "district from the CEDD register (real)"],
    how: [
      "Territory totals = Σ over the inventory of P(H|R), P(≥ 50 m³) and PLL, with the 5 % / 95 % sums as the range; buildings affected = Σ P(H|R) × blocks within reach.",
      "By district: the same sums grouped by the CEDD district code, with the three highest-P slopes.",
      "Grid: GEO's 750 m E–W × 600 m N–S cells from origin 113.8° E, 22.13° N (the Survey and Mapping Office gridding of Xiao et al. 2023); each slope's centroid falls in one cell.",
      "Context lines quote GEO Information Note 18/2025 (≈ 300 incidents and 3 Landslip Warnings a year) and the 2008 and 2023 storms.",
    ],
    realness: "derived",
    reference: "He, Zhang et al. (2023) one-page PoLA report; Xiao et al. (2023) Fig. 12 grid; GEO IN 18/2025",
    code: "src/decision/stormReport.ts · buildStormReport(), stormGridFC()",
  },
  {
    id: "calc-replay",
    name: "Storm replay — validation against the CEDD record",
    group: "Planning, KPIs & reports",
    output: "Reports → Model Validation: predicted vs observed failures on the 40 wettest days, correlation ρ and the calibration factor.",
    inputs: ["per-gauge daily totals on the 40 wettest days (real, baked)", "each slope's nearest GEO gauge (real)", "CEDD incidents citing an inventory slope, by day (real)", "all CEDD incidents by day (real)"],
    how: [
      "For each storm day and slope: R = nearest gauge's daily total (territory mean when that gauge has no record); occurrence term with no monitoring evidence, past-failure term off, susceptibility neutral (0.5).",
      "Predicted = Σ P(H|R) over the inventory; predicted ≥ 50 m³ = Σ P(H|R)·(P(major) + P(very major)).",
      "Observed · inventory = incidents that day whose slope number is in the inventory; Observed · all = every incident reported that day.",
      "ρ = Pearson correlation of ln(1 + predicted) against ln(1 + observed) over the storms (the storm-based index of Xiao et al. 2023); calibration = Σ observed · inventory / Σ predicted.",
      "Caveats: daily totals understate the maximum rolling 24-h rainfall; only 42 % of incidents cite a slope number; the inventory is the tallest 4,155 of 61,475 slopes.",
    ],
    realness: "derived",
    reference: "Xiao, Zhang, Cheung & Lacasse (2023) Fig. 13; GEO Report 144",
    code: "scripts/build-live-data.mjs · bakeRain() stormGaugeX10; src/decision/stormReplay.ts · replayStorms()",
  },
  {
    id: "calc-nowcast",
    name: "Nowcast into the trajectory",
    group: "Rainfall",
    output: "The +1 h and +3 h scores; the KPI “Next 2 h” tile; the storm report's nowcast line.",
    inputs: ["HKO gridded rainfall nowcast (real, via server)", "each slope's nearest HKO station (real)"],
    how: [
      "Server: download the CSV, keep cells inside 113.75–114.55° E / 22.1–22.65° N, take the nearest cell to each of the 36 stations → four 30-min totals and their 2-h sum; cached 6 min.",
      "Slope at horizon h: nowcast(h) = Σ of the first ⌈min(h, 2) × 2⌉ half-hour values at its station; future rain24 = projected trailing-24-h total + nowcast(h); R24 ahead = max(R24 so far, future rain24). Applied only while the twin's clock is within 3 h of real time.",
      "KPI “Next 2 h” = mean of nowcast(2) over the first 40 slopes.",
    ],
    realness: "derived",
    reference: "HKO Open Data — gridded rainfall nowcast; Zhang & He (IWDTERM 2026) slides 42–47 (risk nowcast with the HKO 2-h nowcast)",
    code: "server/liveNowcast.js; src/mock/signals.ts · nowcastForSlope(); src/core/riskEngine.ts · chainAt()",
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

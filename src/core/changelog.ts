// What's new — the twin's changelog, rendered at Reports → What's new and flagged in the top banner.
//
// RULE (user instruction, 2026-09-08): every new feature, data source, model change or calculation gets an entry here
// in the same commit, newest release first. An entry says what changed, where to find it in the app, and links to the
// Data Sources / How-it-is-calculated rows behind it (`calc` / `source` ids from src/core/dataSources.ts). Keep the
// `id` stable — the banner uses the newest id to decide whether a viewer has seen it.

export type ChangeKind = "feature" | "data" | "model" | "ui" | "fix";

export interface ChangeItem {
  kind: ChangeKind;
  title: string;
  what: string; // one or two sentences, plain language
  where?: string; // how to reach it in the app
  calc?: string; // CALCULATIONS id
  source?: string; // DATA_SOURCES id
  real?: boolean; // built on real open data
}

export interface Release {
  id: string; // yyyy-mm-dd-slug, unique, never reused
  date: string; // yyyy-mm-dd
  title: string;
  items: ChangeItem[];
}

export const CHANGELOG: Release[] = [
  {
    id: "2026-09-10-localised-playback",
    date: "2026-09-10",
    title: "3D scenarios that stay anchored to their site",
    items: [
      { kind: "feature", title: "Named sites and guided playback", what: "Every 3D scenario identifies its slope, district and coordinates, with source and runout labels, a visible route, phase explanations, camera shortcuts, chapter jumps and playback speed. Stable outcomes can be demonstrated in 3D too.", where: "Slope Command Center → Scenario Lab → Run scenario & watch it in 3D", calc: "calc-3d" },
      { kind: "fix", title: "Full-site framing and local context", what: "The camera fits the slope and complete runout, targets terrain elevation in close-ups, and loads scene geometry after arriving. Traffic stays on local road segments; missing geometry is reported instead of inventing a road. Only contacted parts of roads turn red.", where: "3D playback", calc: "calc-3d" },
      { kind: "fix", title: "3D overlays align on scaled displays", what: "Rain and debris now synchronize both the shared canvas and default framebuffer dimensions with the map, correcting displacement after resizing and on scaled displays.", where: "3D map and scenario playback", calc: "calc-3d" },
      { kind: "fix", title: "An unavailable nowcast no longer blocks the demo", what: "The optional nowcast request times out after 12 seconds and reports its unavailable status, allowing the platform to open when that proxy stalls.", where: "Startup; Reports → Data Sources", source: "hko-nowcast" },
      { kind: "fix", title: "Repeatable playback and terrain rendering", what: "Pause freezes debris and traffic; replay and seeking use repeatable placements and contacts. Boulder and fallback meshes now render correctly, and flow geometry samples terrain across its width. Short runouts use proportionate debris widths, thicknesses and rock sizes. Rainstorm presets clear earthquake settings from earlier presets; stable frames agree with the result classification.", where: "Scenario Lab and 3D playback", calc: "calc-3d" },
    ],
  },
  {
    id: "2026-09-08-zhang-roadmap",
    date: "2026-09-08",
    title: "Uncertainty, value of information, storm report, validation replay, HKO nowcast",
    items: [
      { kind: "model", title: "Uncertainty on the risk chain", what: "P(failure | R) is carried as a distribution on the log-odds with named parts (correlation scatter, material, hydrology, geometry age, mitigation condition). Every slope shows σ and 5–95 % ranges on P(failure) and expected fatalities; the KPI panel shows the range of expected landslides.", where: "Slope Overview → quantitative block; KPI panel", calc: "calc-uncertainty" },
      { kind: "feature", title: "Value of information — what to observe next", what: "Two decisions per slope, storm precaution and 25-year upgrade, valued by a preposterior analysis: which inspection, survey, piezometer, GNSS or ground investigation would most change the decision per HK$ and hour.", where: "Slope Overview; Planning → Where to investigate next; Ask the Twin “what should we investigate next?”", calc: "calc-voi" },
      { kind: "model", title: "Annual failure probability and individual risk", what: "Annual P(failure) integrates the occurrence term over the rainfall climatology from the return-period table, so the annual individual risk shown against the 1e-4 / 1e-5 criteria is a proper figure rather than an event value divided by a return period.", where: "Slope Overview", calc: "calc-risk-numbers" },
      { kind: "feature", title: "PoLA storm report and expected-landslides grid", what: "The one-page prompt risk assessment: expected landslides with range, share above 50 m³, expected fatalities, buildings within reach, by district and on GEO's 750 × 600 m grid, with GEO's yardsticks. A map layer draws the grid.", where: "Reports → Storm Report; Layers → Expected landslides grid; Ask the Twin “storm report”", calc: "calc-storm-report" },
      { kind: "data", title: "Storm replay against the CEDD record", what: "The 40 wettest days since 1984 replayed through the occurrence term with each slope's nearest GEO gauge, compared with the incidents reported that day: correlation, calibration factor, scatter and table.", where: "Reports → Model Validation", calc: "calc-replay", real: true },
      { kind: "data", title: "HKO 2-hour rainfall nowcast", what: "The server proxies HKO's gridded nowcast (reissued every 12 minutes) and reduces it to the twin's 36 stations; the +1 h and +3 h trajectories add each slope's nearest-station nowcast, and the KPI panel shows the territory mean for the next two hours.", where: "KPI panel → Next 2 h · nowcast; storm report", source: "hko-nowcast", calc: "calc-nowcast", real: true },
      { kind: "feature", title: "Ask the Twin grounded on the registries", what: "“How is PLL calculated?”, “what is the census term?”, “storm report”, “what should we investigate next?” and “nowcast” are answered from the glossary, the calculation registry and the dataset registry — no external model.", where: "Ask the Twin" },
      { kind: "ui", title: "What's new", what: "This page, and the “What's new” link in the banner that lights up until you have read the latest release.", where: "Reports → What's new" },
      { kind: "fix", title: "Lighter side panels", what: "One line per KPI row (ranges moved to the tooltip), the nowcast as a row rather than a third tile, and the panel scrollbar kept inside the rounded card.", where: "KPI panel" },
      { kind: "ui", title: "Full-width report and planning pages", what: "Data Sources, Storm Report, Model Validation, Rainfall & Landslides and Planning tables now use the whole page width instead of a 1,000 px column; prose keeps a readable measure.", where: "Reports; Planning" },
    ],
  },
  {
    id: "2026-09-08-pola",
    date: "2026-09-08",
    title: "Risk engine on Zhang's PoLA chain, calculation registry, real CEDD barriers, glossary, new home view",
    items: [
      { kind: "model", title: "Slope risk follows the PoLA chain", what: "Risk = P(H|R) · P(M|H,R) · P(L|H,M) · V · E (He, Zhang et al. 2023; Zhang & He, IWDTERM 2026): occurrence from the Hong Kong rainfall–landslide correlations in logistic form, four failure scales, HK QRA proximity vulnerability, census / LandsD / facility / road elements at risk; PLL, individual risk, return period and a log-scale score.", where: "Every score and band; Slope Overview → quantitative block", calc: "calc-chain" },
      { kind: "feature", title: "“How it is calculated” on the Data Sources page", what: "Every derived number — 32 calculations — with inputs tagged real or synthetic, the formula and coefficients, references and code location.", where: "Reports → Data Sources → How it is calculated" },
      { kind: "data", title: "Real debris-resisting barriers", what: "888 natural terrain defence measures (rigid and flexible barriers, bunds, boulder fences) and 310 stabilisation works baked from CEDD's Catalogue of Slopes: real mitigation entries on slopes within 200 m, a “Debris barriers” map layer, and 4 m walls in the 3D playback that the surge front is tested against.", where: "Layers → Debris barriers; Slope Overview → Mitigation measures; 3D playback", source: "cedd-ntmm", real: true },
      { kind: "ui", title: "Labels explain themselves", what: "Hover any underlined label for a plain-language explanation; click it to jump to the matching calculation or dataset row.", where: "Slope Overview, KPI panel, Scenario Lab, Storm Report" },
      { kind: "ui", title: "Opens on Hong Kong Island", what: "The twin starts on satellite imagery with 3D terrain, looking north over Hong Kong Island; “reset view” returns there.", where: "Map" },
    ],
  },
  {
    id: "2026-09-07-3d",
    date: "2026-09-07",
    title: "3D playback of scenarios, rain in 3D, earthquake trigger",
    items: [
      { kind: "feature", title: "3D playback of a scenario", what: "A scenario's runout becomes a textured debris flow over the real terrain, with glTF people, cars and trucks on the real road centrelines and buildings, roads, people and vehicles lighting up as the front reaches them; cinematic camera, own clock and HUD tally.", where: "Scenario Lab → Watch it in 3D", calc: "calc-3d" },
      { kind: "feature", title: "Rain falling in 3D", what: "Rain over the terrain whenever the displayed intensity is above zero — HKO live when available, plus the Storm Watch band.", where: "Layers → Rain in 3D" },
      { kind: "model", title: "Earthquake trigger and IWDTERM parameters", what: "The scenario engine gains peak ground acceleration, antecedent 3-day rain, peak-hour intensity (runoff-driven initiation past 70 mm/h), entrainment and warning lead time, after Zhang & He (IWDTERM 2026).", where: "Scenario Lab", calc: "calc-scenario-prob" },
      { kind: "fix", title: "Terrain and rendering", what: "Hillshade separated from the terrain source, the map confined to Hong Kong, per-drag terrain toggling dropped, and the render task queue made to survive a throw.", where: "Map" },
    ],
  },
  {
    id: "2026-09-06-real-data",
    date: "2026-09-06",
    title: "Real live CSDI and HKO data, iOS-style interface, 3D performance",
    items: [
      { kind: "data", title: "Real exposure and context", what: "HKO hourly rainfall with a server-side 24-h accumulation, GEO raingauge record 1984 → present, CEDD landslide incidents per slope, ENTLI natural-terrain landslides as a density grid and live layer, 2021 census residents, and real hospitals, schools, kindergartens, fire and police stations, clinics, LandsD building blocks and roads joined to every slope.", where: "Layers; Slope History; Reports → Rainfall & Landslides", source: "hko-live", real: true },
      { kind: "feature", title: "Data Sources page", what: "Every dataset with what it is, how it reaches the app, real or synthetic, cadence, freshness and live load status.", where: "Reports → Data Sources" },
      { kind: "ui", title: "Liquid-glass interface", what: "iOS 26-style cards on a 12/24 px grid, floating panels, progressive disclosure, light basemap.", where: "Everywhere" },
      { kind: "fix", title: "3D performance", what: "Render-queue and move-listener fixes; the 3D map no longer stalls on the integrated GPU.", where: "Map" },
    ],
  },
  {
    id: "2026-09-04-real-slopes",
    date: "2026-09-04",
    title: "The twin runs on the real slope inventory",
    items: [
      { kind: "data", title: "CEDD Catalogue of Slopes", what: "Every registered slope of 20 m or more plus the LPM works programme — 4,155 real polygons with slope number, height, angle, district and maintenance party — replaces the synthetic inventory. Live CSDI layers for registered slopes, landslide incidents, LPM works and DSD flood blackspots.", where: "Map; Slope Command Center", source: "cedd-slopes", real: true },
      { kind: "feature", title: "Password gate and sign-in page", what: "A designed sign-in page with 30-day sessions in front of the deployed twin.", where: "/login" },
      { kind: "model", title: "Slopes on real hillsides", what: "Before the real inventory arrived, synthetic slopes were placed on steep DEM cells with min-separation packing and oriented along the contour.", where: "Map (fallback path)" },
    ],
  },
  {
    id: "2026-09-04-prototype",
    date: "2026-09-04",
    title: "Hong Kong landslide and flood digital twin prototype",
    items: [
      { kind: "feature", title: "The prototype", what: "3D Hong Kong map with real basemap and terrain, city KPI dashboard, Slope Command Center, Scenario Lab with instant / fast / high-fidelity modes, intervention comparison, consequence cascade, emergency mode, situation report, Ask the Twin, portfolio optimizer and model-validation module.", where: "Everywhere" },
    ],
  },
];

export const LATEST_RELEASE = CHANGELOG[0];

const SEEN_KEY = "twin.whatsNew.seen";

/** Has this browser read the newest release? Wrapped: storage can be unavailable. */
export function latestSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === LATEST_RELEASE.id;
  } catch {
    return true;
  }
}
export function markLatestSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, LATEST_RELEASE.id);
  } catch {
    /* ignore */
  }
}

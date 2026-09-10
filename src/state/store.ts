// Global app state (zustand). Serializable by design → future replay/collaboration.

import { create } from "zustand";
import { registry } from "@/core/registry";
import { GAME_EPOCH, prepareRealSlopes } from "@/mock/generate";
import { fetchLiveRain, fetchNowcast, startLiveRainPolling, type LiveRain, type Nowcast } from "@/live/hko";
import { getSourceStatus, subscribeSources, type SourceStatus } from "@/core/dataSources";
import { timed } from "@/core/schedule";
import { DEFAULT_PARAMS } from "@/mock/MockSimulationProvider";
import type {
  Asset,
  Incident,
  KpiSnapshot,
  RiskAssessment,
  RiskCategory,
  Role,
  ScenarioParams,
  SimulationJob,
  SimulationMode,
  SimulationResult,
  Slope,
  WeatherState,
} from "@/core/types";

export type ViewId = "overview" | "emergency" | "planning" | "reports" | "ask";
export type ReportsTabId = "sitrep" | "storm" | "validation" | "rainfall" | "sources" | "whatsnew";
export type BasemapId = "light" | "dark" | "satellite";

const ALL_RISK_VISIBLE: Record<RiskCategory, boolean> = { low: true, moderate: true, elevated: true, high: true, critical: true, "no-data": true };
const ALL_RISK_HIDDEN: Record<RiskCategory, boolean> = { low: false, moderate: false, elevated: false, high: false, critical: false, "no-data": false };

export interface LayerState {
  slopeRisk: boolean;
  uncertainty: boolean;
  rainfall: boolean;
  roads: boolean;
  buildings: boolean;
  drainage: boolean;
  mitigations: boolean;
  incidents: boolean;
  historicalLandslides: boolean;
  floodZones: boolean;
  sensors: boolean;
  // live CSDI / HKO layers (real HK government data, not synthetic)
  csdiSlopes: boolean;
  csdiBlackspots: boolean;
  csdiLandslides: boolean;
  csdiLpm: boolean; // LPMitP works programme polygons
  csdiBarriers: boolean; // CEDD natural terrain hazard mitigation measures (ND debris barriers, NS stabilisation)
  stormGrid: boolean; // PoLA storm report: expected landslides per GEO 750 × 600 m cell
  csdiEntli: boolean; // ENTLI natural terrain landslides (density grid far out, crowns + trails close in)
  liveRain: boolean; // HKO rain-gauge stations with the latest past-hour reading
  rain3d: boolean; // rain streaks over the terrain in 3D, driven by the displayed mm/hr
}

import type { Sim3dImpact } from "@/core/types";

interface AppState {
  // clock
  gameTime: number;
  speed: number; // game-seconds per real second (0 = paused)
  lastAssessTime: number;

  // data
  ready: boolean;
  slopes: Slope[];
  assets: Asset[];
  incidents: Incident[];
  assessments: Map<string, RiskAssessment>;
  kpi: KpiSnapshot | null;
  weather: WeatherState | null;
  liveRain: LiveRain | null; // latest HKO observation (real), null when unavailable
  nowcast: Nowcast | null; // latest HKO 2-h gridded rainfall nowcast (real), null when the proxy is unreachable
  sourceStatus: Record<string, SourceStatus>; // runtime status per data source id

  // ui
  view: ViewId;
  reportsTab: ReportsTabId; // which Reports pane opens (deep-linked from the banner's "Data sources")
  role: Role;
  selectedSlopeId: string | null;
  commandCenterOpen: boolean;
  layers: LayerState;
  stormMode: boolean;
  stormHorizonH: number; // projection horizon slider in storm mode
  searchQuery: string;
  flyTo: { center: [number, number]; zoom: number; token: number } | null;
  mapLoaded: boolean; // true once terrain + overlay layers are on screen
  riskFilter: Record<RiskCategory, boolean>; // legend-driven visibility of slope risk classes
  viewCmd: { type: "rotate" | "tilt" | "north" | "home" | "zoom" | "scene" | "source" | "toe"; delta?: number; token: number } | null; // camera commands for the map
  basemap: BasemapId; // light/dark vector (OpenFreeMap) or satellite imagery (Esri)
  map3d: boolean;

  // scenario / simulation
  scenarioParams: ScenarioParams;
  simMode: SimulationMode;
  activeJob: SimulationJob | null;
  simResult: SimulationResult | null;
  comparisonResults: SimulationResult[]; // for intervention comparison
  animPlaying: boolean;
  animTimeSec: number;
  animSpeed: number;
  // 3D playback of simResult on the map (illustrative presentation of the engine's result)
  sim3dActive: boolean;
  sim3dReady: boolean;
  sim3dImpact: Sim3dImpact | null;

  // actions
  init(): Promise<void>;
  tick(realDtSec: number): void;
  setSpeed(s: number): void;
  refreshDerived(force?: boolean): Promise<void>;
  selectSlope(id: string | null): void;
  openCommandCenter(open: boolean): void;
  setView(v: ViewId): void;
  setReportsTab(t: ReportsTabId): void;
  setRole(r: Role): void;
  toggleLayer(k: keyof LayerState): void;
  setStormMode(on: boolean): void;
  setStormHorizon(h: number): void;
  setScenarioParams(p: Partial<ScenarioParams>): void;
  setSimMode(m: SimulationMode): void;
  runScenario(extraInterventions?: ScenarioParams["interventions"], forComparison?: boolean): Promise<void>;
  clearComparison(): void;
  setAnim(p: Partial<{ playing: boolean; timeSec: number; speed: number }>): void;
  setSim3d(active: boolean): void;
  setSim3dImpact(i: Sim3dImpact | null): void;
  flyToSlope(id: string): void;
  setMapLoaded(v: boolean): void;
  resetScenarioParams(): void;
  toggleRiskCategory(c: RiskCategory): void;
  resetRiskFilter(): void;
  sendViewCmd(type: NonNullable<AppState["viewCmd"]>["type"], delta?: number): void;
  setBasemap(b: BasemapId): void;
  setMap3d(enabled: boolean): void;
}

// one risk pass at a time; a forced pass (storm toggle, live rain) supersedes an in-flight one
let refreshSeq = 0;
let refreshing = false;
let initialization: Promise<void> | null = null;
let scenarioSeq = 0;
let basemapBeforeSim3d: BasemapId | null = null;
let map3dBeforeSim3d: boolean | null = null;
let cameraSeq = 0;

export const useStore = create<AppState>((set, get) => ({
  gameTime: GAME_EPOCH,
  speed: 1, // real-time by default; accelerated playback is explicitly selected
  lastAssessTime: 0,

  ready: false,
  slopes: [],
  assets: [],
  incidents: [],
  assessments: new Map(),
  kpi: null,
  weather: null,
  liveRain: null,
  nowcast: null,
  sourceStatus: {},

  view: "overview",
  reportsTab: "sitrep",
  role: "engineer",
  selectedSlopeId: null,
  commandCenterOpen: false,
  layers: {
    slopeRisk: true,
    uncertainty: false,
    rainfall: false,
    roads: true,
    buildings: true,
    drainage: false,
    mitigations: false,
    incidents: true,
    historicalLandslides: false,
    floodZones: false,
    sensors: false,
    csdiSlopes: false,
    csdiBlackspots: false,
    csdiLandslides: false,
    csdiLpm: false,
    csdiBarriers: false,
    stormGrid: false,
    csdiEntli: false,
    liveRain: false,
    rain3d: true,
  },
  stormMode: false,
  stormHorizonH: 8,
  searchQuery: "",
  flyTo: null,
  mapLoaded: false,
  riskFilter: { ...ALL_RISK_VISIBLE },
  viewCmd: null,
  basemap: "satellite", // opens on imagery + terrain; the layer sheet switches to the light / dark vector maps
  map3d: true, // 3D terrain + buildings by default; the HUD toggle flattens the map for a 2D read

  scenarioParams: { ...DEFAULT_PARAMS },
  simMode: "fast",
  activeJob: null,
  simResult: null,
  comparisonResults: [],
  animPlaying: false,
  animTimeSec: 0,
  animSpeed: 1,
  sim3dActive: false,
  sim3dReady: false,
  sim3dImpact: null,

  async init() {
    if (initialization) return initialization;
    initialization = (async () => {
    // runtime status of every data source, for the Data Sources panel
    subscribeSources(() => set({ sourceStatus: getSourceStatus() }));
    // The real CEDD slope inventory (+ baked real context) must be in place before the registry builds
    // the dataset; the first HKO observation is fetched alongside so the first risk pass is already live.
    const [, live, nowcast] = await Promise.all([prepareRealSlopes(), fetchLiveRain().catch(() => null), fetchNowcast()]);
    if (live) registry.weather.setLive(live);
    if (nowcast) registry.weather.setNowcast(nowcast);
    const [slopes, assets, incidents] = await Promise.all([
      registry.slopes.getAll(),
      registry.assets.getAll(),
      registry.incidents.getActive(get().gameTime),
    ]);
    set({ slopes, assets, incidents, liveRain: live, nowcast, ready: true });
    await get().refreshDerived(true);
    // keep the rainfall baseline live: HKO publishes hourly, we re-check every 5 real minutes
    startLiveRainPolling(
      (r) => {
        registry.weather.setLive(r);
        set({ liveRain: r });
        void get().refreshDerived(true);
      },
      5 * 60_000,
      false
    );
    // the 2-hour nowcast is reissued every 12 min; re-pull every 6 so the trajectory follows it
    setInterval(() => {
      void fetchNowcast().then((n) => {
        if (!n) return;
        registry.weather.setNowcast(n);
        set({ nowcast: n });
        void get().refreshDerived(true);
      });
    }, 6 * 60_000);
    })();
    return initialization;
  },

  tick(realDtSec: number) {
    const { speed, gameTime } = get();
    if (speed === 0) return;
    set({ gameTime: gameTime + realDtSec * speed * 1000 });
    void get().refreshDerived(false);
  },

  setSpeed(s: number) {
    set({ speed: s });
  },

  async refreshDerived(force = false) {
    const { gameTime, lastAssessTime, slopes } = get();
    if (!slopes.length) return;
    // recompute at most every 10 game-minutes, never two passes at once
    if (!force && gameTime - lastAssessTime < 10 * 60_000) return;
    if (!force && refreshing) return;
    const seq = ++refreshSeq;
    refreshing = true;
    try {
      // chunked: yields to the browser between slices so the map stays interactive
      const assessments = await timed("risk pass (chunked)", () => registry.risk.assessAllAsync(slopes, gameTime), 400);
      if (seq !== refreshSeq) return; // superseded by a newer pass
      const [kpi, weather] = await timed("kpis + weather", () =>
        Promise.all([registry.risk.kpis(slopes, assessments, gameTime), registry.weather.getState(gameTime)])
      );
      if (seq !== refreshSeq) return;
      await timed("store update + render", () => set({ assessments, kpi, weather, lastAssessTime: gameTime }));
    } finally {
      if (seq === refreshSeq) refreshing = false;
    }
  },

  selectSlope(id) {
    const slope = id ? get().slopes.find((s) => s.id === id) : undefined;
    if (id && !slope) return;
    if (get().sim3dActive) get().setSim3d(false);
    scenarioSeq++;
    set({
      selectedSlopeId: id,
      commandCenterOpen: id !== null,
      simResult: null,
      activeJob: null,
      comparisonResults: [],
      animPlaying: false,
      animTimeSec: 0,
      sim3dActive: false,
      sim3dImpact: null,
      scenarioParams: { ...DEFAULT_PARAMS },
      ...(slope ? {
        view: get().view === "emergency" ? "emergency" as const : "overview" as const,
        flyTo: { center: slope.centroid, zoom: 17, token: ++cameraSeq },
      } : {}),
    });
  },

  openCommandCenter(open) {
    set({ commandCenterOpen: open });
  },

  setView(v) {
    if (get().sim3dActive) get().setSim3d(false);
    set({ view: v });
  },

  setReportsTab(t) {
    set({ reportsTab: t });
  },

  setRole(r) {
    if (get().sim3dActive) get().setSim3d(false);
    const patch: Partial<AppState> = { role: r };
    if (r === "emergency") patch.view = "emergency";
    if (r === "public") { patch.view = "overview"; patch.commandCenterOpen = false; }
    set(patch as AppState);
  },

  toggleLayer(k) {
    set((st) => ({ layers: { ...st.layers, [k]: !st.layers[k] } }));
  },

  setStormMode(on) {
    registry.weather.setStorm(on ? get().gameTime : null);
    set({ stormMode: on });
    void get().refreshDerived(true);
  },

  setStormHorizon(h) {
    set({ stormHorizonH: h });
  },

  setScenarioParams(p) {
    set((st) => ({ scenarioParams: { ...st.scenarioParams, ...p } }));
  },

  setSimMode(m) {
    set({ simMode: m });
  },

  async runScenario(extraInterventions, forComparison = false) {
    const { selectedSlopeId, scenarioParams, simMode } = get();
    if (!selectedSlopeId) return;
    const seq = ++scenarioSeq;
    const current = () => seq === scenarioSeq && get().selectedSlopeId === selectedSlopeId;
    const params: ScenarioParams = {
      ...scenarioParams,
      interventions: extraInterventions ?? scenarioParams.interventions,
    };
    const job = await registry.simulation.submit(selectedSlopeId, params, simMode);
    if (!current()) return;
    set({ activeJob: job });
    const poll = async () => {
      if (!current()) return;
      const j = await registry.simulation.getJob(job.id);
      if (!j || !current()) return;
      set({ activeJob: j });
      if (j.status === "done" && j.result) {
        if (forComparison) {
          set((st) => ({ comparisonResults: [...st.comparisonResults, j.result!] }));
        } else {
          set({ simResult: j.result, animPlaying: true, animTimeSec: 0, comparisonResults: [j.result] });
        }
      } else if (j.status === "running" || j.status === "queued") {
        setTimeout(poll, 200);
      }
    };
    await poll();
  },

  clearComparison() {
    set({ comparisonResults: [] });
  },

  setAnim(p) {
    set((st) => ({
      animPlaying: p.playing ?? st.animPlaying,
      animTimeSec: p.timeSec ?? st.animTimeSec,
      animSpeed: p.speed ?? st.animSpeed,
    }));
  },
  setSim3d(active) {
    // the playback owns the screen: the command centre folds away, the basemap goes to imagery (a pale
    // vector map turns the hillside into paper), and both come back on exit
    set((st) => {
      if (active && (!st.simResult || st.simResult.slopeId !== st.selectedSlopeId)) return {};
      if (active && !st.sim3dActive) { basemapBeforeSim3d = st.basemap; map3dBeforeSim3d = st.map3d; }
      const basemap = active ? "satellite" : basemapBeforeSim3d ?? st.basemap;
      const map3d = active ? true : map3dBeforeSim3d ?? st.map3d;
      if (!active) { basemapBeforeSim3d = null; map3dBeforeSim3d = null; }
      return { sim3dActive: active, sim3dReady: false, animPlaying: false, map3d, ...(active ? { animTimeSec: 0 } : {}), sim3dImpact: null, commandCenterOpen: active ? false : st.selectedSlopeId !== null, basemap };
    });
  },
  setSim3dImpact(i) {
    set({ sim3dImpact: i });
  },

  flyToSlope(id) {
    const s = get().slopes.find((x) => x.id === id);
    if (!s) return;
    set({ flyTo: { center: s.centroid, zoom: 17, token: ++cameraSeq } });
  },

  setMapLoaded(v) {
    set({ mapLoaded: v });
  },

  resetScenarioParams() {
    set({ scenarioParams: { ...DEFAULT_PARAMS } });
  },

  // Legend interaction: first click on an all-visible legend isolates that class; further clicks add/remove
  // classes; clearing the last visible class restores everything.
  toggleRiskCategory(c) {
    const cur = get().riskFilter;
    const allOn = Object.values(cur).every(Boolean);
    let next: Record<RiskCategory, boolean>;
    if (allOn) {
      next = { ...ALL_RISK_HIDDEN, [c]: true };
    } else {
      next = { ...cur, [c]: !cur[c] };
      if (!Object.values(next).some(Boolean)) next = { ...ALL_RISK_VISIBLE };
    }
    set({ riskFilter: next });
  },

  resetRiskFilter() {
    set({ riskFilter: { ...ALL_RISK_VISIBLE } });
  },

  sendViewCmd(type, delta) {
    set({ viewCmd: { type, delta, token: Date.now() } });
  },

  setBasemap(b) {
    set({ basemap: b });
  },
  setMap3d(map3d) {
    if (!map3d && get().sim3dActive) get().setSim3d(false);
    set({ map3d });
  },
}));

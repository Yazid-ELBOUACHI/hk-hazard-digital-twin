// Global app state (zustand). Serializable by design → future replay/collaboration.

import { create } from "zustand";
import { registry } from "@/core/registry";
import { GAME_EPOCH } from "@/mock/generate";
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
}

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

  // ui
  view: ViewId;
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
  viewCmd: { type: "rotate" | "tilt" | "north" | "home" | "zoom"; delta?: number; token: number } | null; // camera commands for the map
  basemap: BasemapId; // light/dark vector (OpenFreeMap) or satellite imagery (Esri)

  // scenario / simulation
  scenarioParams: ScenarioParams;
  simMode: SimulationMode;
  activeJob: SimulationJob | null;
  simResult: SimulationResult | null;
  comparisonResults: SimulationResult[]; // for intervention comparison
  animPlaying: boolean;
  animTimeSec: number;
  animSpeed: number;

  // actions
  init(): Promise<void>;
  tick(realDtSec: number): void;
  setSpeed(s: number): void;
  refreshDerived(force?: boolean): Promise<void>;
  selectSlope(id: string | null): void;
  openCommandCenter(open: boolean): void;
  setView(v: ViewId): void;
  setRole(r: Role): void;
  toggleLayer(k: keyof LayerState): void;
  setStormMode(on: boolean): void;
  setStormHorizon(h: number): void;
  setScenarioParams(p: Partial<ScenarioParams>): void;
  setSimMode(m: SimulationMode): void;
  runScenario(extraInterventions?: ScenarioParams["interventions"], forComparison?: boolean): Promise<void>;
  clearComparison(): void;
  setAnim(p: Partial<{ playing: boolean; timeSec: number; speed: number }>): void;
  flyToSlope(id: string): void;
  setMapLoaded(v: boolean): void;
  resetScenarioParams(): void;
  toggleRiskCategory(c: RiskCategory): void;
  resetRiskFilter(): void;
  sendViewCmd(type: "rotate" | "tilt" | "north" | "home" | "zoom", delta?: number): void;
  setBasemap(b: BasemapId): void;
}

export const useStore = create<AppState>((set, get) => ({
  gameTime: GAME_EPOCH,
  speed: 60, // 1 real second = 1 game minute
  lastAssessTime: 0,

  ready: false,
  slopes: [],
  assets: [],
  incidents: [],
  assessments: new Map(),
  kpi: null,
  weather: null,

  view: "overview",
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
  },
  stormMode: false,
  stormHorizonH: 8,
  searchQuery: "",
  flyTo: null,
  mapLoaded: false,
  riskFilter: { ...ALL_RISK_VISIBLE },
  viewCmd: null,
  basemap: "light",

  scenarioParams: { ...DEFAULT_PARAMS },
  simMode: "fast",
  activeJob: null,
  simResult: null,
  comparisonResults: [],
  animPlaying: false,
  animTimeSec: 0,
  animSpeed: 1,

  async init() {
    const [slopes, assets, incidents] = await Promise.all([
      registry.slopes.getAll(),
      registry.assets.getAll(),
      registry.incidents.getActive(get().gameTime),
    ]);
    set({ slopes, assets, incidents, ready: true });
    await get().refreshDerived(true);
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
    // recompute at most every 10 game-minutes
    if (!force && gameTime - lastAssessTime < 10 * 60_000) return;
    const assessments = registry.risk.assessAll(slopes, gameTime);
    const [kpi, weather] = await Promise.all([
      registry.risk.kpis(slopes, assessments, gameTime),
      registry.weather.getState(gameTime),
    ]);
    set({ assessments, kpi, weather, lastAssessTime: gameTime });
  },

  selectSlope(id) {
    set({
      selectedSlopeId: id,
      commandCenterOpen: id !== null,
      simResult: null,
      activeJob: null,
      comparisonResults: [],
      animPlaying: false,
      animTimeSec: 0,
      scenarioParams: { ...DEFAULT_PARAMS },
    });
  },

  openCommandCenter(open) {
    set({ commandCenterOpen: open });
  },

  setView(v) {
    set({ view: v });
  },

  setRole(r) {
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
    const params: ScenarioParams = {
      ...scenarioParams,
      interventions: extraInterventions ?? scenarioParams.interventions,
    };
    const job = await registry.simulation.submit(selectedSlopeId, params, simMode);
    set({ activeJob: job });
    const poll = async () => {
      const j = await registry.simulation.getJob(job.id);
      if (!j) return;
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

  flyToSlope(id) {
    const s = get().slopes.find((x) => x.id === id);
    if (!s) return;
    set({ flyTo: { center: s.centroid, zoom: 14.5, token: Date.now() } });
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
}));

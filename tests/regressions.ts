import assert from "node:assert/strict";
import test from "node:test";
import { fmtClock } from "../src/core/format";
import { slopeCamera } from "../src/core/mapSelection";
import { HeuristicRiskEngine } from "../src/core/riskEngine";
import { setMapInteracting } from "../src/core/schedule";
import { GAME_EPOCH } from "../src/mock/generate";
import { featuresFor, projectedRain24, rainRateAt, regionalRainFactor, setLiveRain, setStormOverlay, slopeRain, stormRateAt } from "../src/mock/signals";
import { useStore } from "../src/state/store";
import { registry } from "../src/core/registry";
import type { Slope, SimulationJob } from "../src/core/types";

const slope: Slope = {
  id: "11SW-A/C 123", name: "Test slope", region: "HK Island", district: "Central & Western",
  centroid: [114.15, 22.28], polygon: [[114.149, 22.279], [114.152, 22.279], [114.151, 22.283], [114.149, 22.279]],
  elevationM: 120, heightM: 35, slopeAngleDeg: 40, areaM2: 1000, aspectDeg: 90,
  slopeType: "soil-cut", geology: "test", soil: { cohesionKPa: 15, frictionAngleDeg: 30, permeability: "medium", saturationBase: 0.4 },
  drainage: { type: "none", condition: 0.5, lastCleared: new Date(GAME_EPOCH).toISOString() },
  vegetationCover: 0.5, mitigations: [], nearbyAssetIds: [], sensors: [], history: [],
  freshness: Object.fromEntries(["sensor", "rainfall", "geometry", "inspection", "simulation", "record"].map(k => [k, new Date(GAME_EPOCH).toISOString()])) as Slope["freshness"],
  susceptibility: 0.6, populationNearby: 100, hasData: true, isSynthetic: true, realIncidents: [],
};

test("Hong Kong clock rolls date/year correctly, independent of computer timezone", () => {
  assert.equal(fmtClock(Date.parse("2026-09-06T16:05:00Z")), "00:05 HKT · 2026-09-07");
  assert.equal(fmtClock(Date.parse("2026-12-31T16:00:00Z")), "00:00 HKT · 2027-01-01");
  assert.ok(Math.abs(GAME_EPOCH - Date.now()) < 60_000);
  assert.equal(useStore.getState().speed, 1);
});

test("camera includes the entire polygon and leaves room inside a narrow map", () => {
  const { bounds, options } = slopeCamera(slope, 320, 240);
  for (const [x, y] of slope.polygon) {
    assert.ok(x >= bounds[0][0] && x <= bounds[1][0]);
    assert.ok(y >= bounds[0][1] && y <= bounds[1][1]);
  }
  assert.ok(320 - options.padding * 2 >= 200);
  assert.ok(240 - options.padding * 2 >= 160);
});

test("selecting a real slope from a non-map view opens, zooms, and selects it", () => {
  useStore.setState({ slopes: [slope], view: "planning" });
  useStore.getState().selectSlope(slope.id);
  const s = useStore.getState();
  assert.equal(s.view, "overview");
  assert.equal(s.selectedSlopeId, slope.id);
  assert.equal(s.commandCenterOpen, true);
  assert.deepEqual(s.flyTo?.center, slope.centroid);
  const token = s.flyTo?.token;
  s.selectSlope(slope.id);
  assert.notEqual(useStore.getState().flyTo?.token, token);
});

test("an old job cannot overwrite a newly selected slope", async () => {
  const second = { ...slope, id: "11SW-A/C 456" };
  useStore.setState({ slopes: [slope, second] });
  useStore.getState().selectSlope(slope.id);
  const descriptor = Object.getOwnPropertyDescriptor(registry, "simulation")!;
  let finish!: (job: SimulationJob) => void;
  const pending = new Promise<SimulationJob>(resolve => { finish = resolve; });
  Object.defineProperty(registry, "simulation", { configurable: true, value: {
    submit: async () => ({ id: "old", slopeId: slope.id, mode: "fast", status: "running", progress: 0 }),
    getJob: () => pending,
  } });
  try {
    const run = useStore.getState().runScenario();
    await Promise.resolve();
    useStore.getState().selectSlope(second.id);
    finish({ id: "old", slopeId: slope.id, mode: "fast", status: "done", progress: 1, stage: "Done", result: { slopeId: slope.id } as any });
    await run;
    assert.equal(useStore.getState().selectedSlopeId, second.id);
    assert.equal(useStore.getState().activeJob, null);
    assert.equal(useStore.getState().simResult, null);
  } finally {
    Object.defineProperty(registry, "simulation", descriptor);
  }
});

test("cached rainfall preserves the original sums and storm-toggle behavior", () => {
  setLiveRain(null);
  setStormOverlay(null);
  const t = GAME_EPOCH + 15 * 3600_000;
  let expected = 0;
  for (let i = 0; i < 24; i++) expected += rainRateAt(t - i * 3600_000);
  const rf = regionalRainFactor(...slope.centroid);
  setLiveRain({ source: "direct", obsTime: new Date(t).toISOString(), fetchedAt: new Date(t).toISOString(), hours24: 0,
    stations: [{ id: "test", name: "Test", lon: slope.centroid[0], lat: slope.centroid[1], mmHr: 1, mm24: null }] });
  assert.equal(slopeRain(slope, t).rain24, expected * rf);
  setStormOverlay(GAME_EPOCH);
  let storm = 0;
  for (let i = 0; i < 24; i++) storm += stormRateAt(t - i * 3600_000);
  assert.equal(slopeRain(slope, t).rain24, expected * rf + storm * rf);
  setStormOverlay(null);
  assert.equal(slopeRain(slope, t).rain24, expected * rf);
  setLiveRain(null);
});

test("city risk calculation yields to camera input and matches synchronous results", async () => {
  const engine = new HeuristicRiskEngine(featuresFor, projectedRain24, { activeIncidentSlopeIds: new Set(), simulationsRunning: () => 0, forecast24Mm: () => 0 });
  const slopes = Array.from({ length: 256 }, (_, i) => ({ ...slope, id: `test-${i}` }));
  let done = false;
  setMapInteracting(true);
  const pass = engine.assessAllAsync(slopes, GAME_EPOCH).then(r => { done = true; return r; });
  try {
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(done, false, "background work must wait while camera moves");
  } finally { setMapInteracting(false); }
  assert.deepEqual(await pass, engine.assessAll(slopes, GAME_EPOCH));
});

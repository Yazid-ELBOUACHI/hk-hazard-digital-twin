// Cinematic 3D playback of a scenario result: the engine's runout path becomes a debris flow over the
// real terrain, with synthetic people and vehicles moving on the real road centrelines below the
// slope, and buildings, roads, people and vehicles lighting up as the front reaches them.
// Illustrative — this presents the scenario engine's result, it computes no physics. Terrain is read
// through one function (`ElevationAt`) so a LiDAR mesh can replace the map DEM later.

import { SolidPolygonLayer, ScatterplotLayer, PathLayer } from "@deck.gl/layers";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import type { Layer } from "@deck.gl/core";
import type maplibregl from "maplibre-gl";
import type { SimulationResult, Sim3dImpact } from "@/core/types";
import { getDeckOverlay } from "./deckOverlay";

export interface Debris3d {
  show(result: SimulationResult): void;
  /** Rewind: fresh people, vehicles and hit state for the same result, camera left alone. */
  reset(): void;
  setTime(tSec: number): void;
  hide(): void;
  dispose(): void;
}
export type ElevationAt = (lon: number, lat: number) => number;

const M_PER_DEG_LAT = 111_320;
const PARTICLES = 1400;
const VEHICLES = 22;
const PEOPLE = 48;
const REACH_M = 420; // roads / buildings this far from the toe take part in the scene
const CAR: [number, number, number] = [4.4, 1.8, 1.5];
const BUS: [number, number, number] = [11, 2.5, 3.1];
const PERSON: [number, number, number] = [0.45, 0.4, 1.7];
const CAR_COLORS = [[225, 225, 230], [40, 40, 45], [180, 30, 35], [30, 60, 140], [200, 200, 60], [90, 90, 95]];
const PERSON_COLORS = [[40, 70, 140], [120, 40, 40], [60, 60, 60], [30, 110, 80], [150, 110, 60], [200, 200, 210]];
const HIT = [235, 55, 45];

type XY = [number, number];
interface Poly { pts: XY[]; cum: number[]; len: number; samples: XY[] }
interface Agent { poly: Poly; s: number; dir: 1 | -1; speed: number; lateral: number; size: [number, number, number]; color: number[]; person: boolean; hit: boolean; pos: [number, number, number]; yaw: number }
interface Building { ring: [number, number][]; ringM: XY[]; height: number; base: number; hit: boolean }

/** Unit box on z ∈ [0, 1], centred on x/y — cars, buses and people are scaled instances of it. */
function cubeMesh() {
  const P: number[] = [], N: number[] = [], T: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[]) => {
    for (const v of [a, b, c, a, c, d]) {
      P.push(v[0], v[1], v[2]);
      N.push(n[0], n[1], n[2]);
      T.push(0, 0);
    }
  };
  quad([-0.5, -0.5, 1], [0.5, -0.5, 1], [0.5, 0.5, 1], [-0.5, 0.5, 1], [0, 0, 1]);
  quad([-0.5, 0.5, 0], [0.5, 0.5, 0], [0.5, -0.5, 0], [-0.5, -0.5, 0], [0, 0, -1]);
  quad([0.5, -0.5, 0], [0.5, 0.5, 0], [0.5, 0.5, 1], [0.5, -0.5, 1], [1, 0, 0]);
  quad([-0.5, 0.5, 0], [-0.5, -0.5, 0], [-0.5, -0.5, 1], [-0.5, 0.5, 1], [-1, 0, 0]);
  quad([0.5, 0.5, 0], [-0.5, 0.5, 0], [-0.5, 0.5, 1], [0.5, 0.5, 1], [0, 1, 0]);
  quad([-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, -0.5, 1], [-0.5, -0.5, 1], [0, -1, 0]);
  return { positions: new Float32Array(P), normals: new Float32Array(N), texCoords: new Float32Array(T) };
}
const MESH = cubeMesh();

function makePoly(pts: XY[]): Poly {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const poly: Poly = { pts, cum, len: cum[cum.length - 1], samples: [] };
  // hit tests sample every ~8 m so a long straight segment can't pass through the flow untouched
  for (let s = 0; s <= poly.len; s += 8) { const p = along(poly, s); poly.samples.push([p.x, p.y]); }
  return poly;
}

/** Point and unit direction at distance `s` along a polyline. */
function along(p: Poly, s: number): { x: number; y: number; dx: number; dy: number } {
  const sc = Math.max(0, Math.min(p.len, s));
  let i = 1;
  while (i < p.cum.length - 1 && p.cum[i] < sc) i++;
  const a = p.pts[i - 1], b = p.pts[i];
  const segLen = p.cum[i] - p.cum[i - 1] || 1e-9;
  const t = (sc - p.cum[i - 1]) / segLen;
  return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, dx: (b[0] - a[0]) / segLen, dy: (b[1] - a[1]) / segLen };
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

export function attachDebris3d(map: maplibregl.Map, onImpact: (i: Sim3dImpact | null) => void, elevationAt?: ElevationAt): Debris3d {
  const deck = getDeckOverlay(map);
  const elev: ElevationAt = elevationAt ?? ((lon, lat) => map.queryTerrainElevation({ lng: lon, lat }) ?? 0);

  let result: SimulationResult | null = null;
  let origin: [number, number] = [0, 0];
  let mPerLon = M_PER_DEG_LAT;
  const toM = (lon: number, lat: number): XY => [(lon - origin[0]) * mPerLon, (lat - origin[1]) * M_PER_DEG_LAT];
  const toLL = (x: number, y: number): XY => [origin[0] + x / mPerLon, origin[1] + y / M_PER_DEG_LAT];
  const zAt = (x: number, y: number) => { const [lon, lat] = toLL(x, y); return elev(lon, lat); };

  let path: Poly = makePoly([[0, 0], [1, 1]]);
  let pathZ: number[] = [];
  let front = 0, targetFront = 0, phase = "rainfall", tSim = 0;
  let particles: { u: number; v: number; r: number; color: number[] }[] = [];
  let agents: Agent[] = [];
  let roads: Poly[] = [];
  let hitRoads = new Set<Poly>();
  let buildings: Building[] = [];
  let raf = 0, last = 0;
  let lastImpact = "";

  const width = (s: number) => 7 + 28 * (s / Math.max(1, path.len));
  const pathZAt = (s: number) => {
    let i = 1;
    while (i < path.cum.length - 1 && path.cum[i] < s) i++;
    const t = (s - path.cum[i - 1]) / ((path.cum[i] - path.cum[i - 1]) || 1e-9);
    return pathZ[i - 1] + (pathZ[i] - pathZ[i - 1]) * Math.max(0, Math.min(1, t));
  };

  /** Inside the flow (≤ front) — perpendicular distance to the path smaller than the corridor half-width there. */
  const inFlow = (x: number, y: number) => {
    if (front <= 1) return false;
    for (let i = 1; i < path.pts.length; i++) {
      if (path.cum[i - 1] > front) break;
      const a = path.pts[i - 1], b = path.pts[i];
      const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / L2));
      const s = path.cum[i - 1] + t * Math.sqrt(L2);
      if (s > front) continue;
      const d = Math.hypot(x - (a[0] + vx * t), y - (a[1] + vy * t));
      if (d < width(s)) return true;
    }
    return false;
  };

  const roadsNearToe = (): Poly[] => {
    const out: Poly[] = [];
    const seen = new Set<string>();
    for (const srcId of ["csdi-roads", "roads"]) {
      let feats: GeoJSON.Feature[] = [];
      try { feats = map.getSource(srcId) ? (map.querySourceFeatures(srcId) as GeoJSON.Feature[]) : []; } catch { feats = []; }
      for (const f of feats) {
        const g = f.geometry;
        const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
        for (const line of lines) {
          const pts = line.map(([lon, lat]) => toM(lon, lat));
          if (pts.length < 2 || !pts.some(([x, y]) => Math.hypot(x, y) < REACH_M)) continue;
          const key = `${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}|${pts[pts.length - 1][0].toFixed(1)},${pts[pts.length - 1][1].toFixed(1)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const poly = makePoly(pts);
          if (poly.len > 15) out.push(poly);
        }
      }
      if (out.length) break;
    }
    if (!out.length) {
      // no centrelines loaded here: a synthetic road across the toe so the scene still reads
      const d = along(path, path.len);
      out.push(makePoly([[d.x - d.dy * 220 + d.dx * 40, d.y + d.dx * 220 + d.dy * 40], [d.x + d.dy * 220 + d.dx * 40, d.y - d.dx * 220 + d.dy * 40]]));
    }
    return out;
  };

  const buildingsNearToe = (): Building[] => {
    let feats: GeoJSON.Feature[] = [];
    try { feats = map.getSource("openmaptiles") ? (map.querySourceFeatures("openmaptiles", { sourceLayer: "building" }) as GeoJSON.Feature[]) : []; } catch { feats = []; }
    const out: Building[] = [];
    for (const f of feats) {
      const g = f.geometry;
      const rings = g.type === "Polygon" ? [g.coordinates[0]] : g.type === "MultiPolygon" ? g.coordinates.map((p) => p[0]) : [];
      for (const ring of rings) {
        const ringM = ring.map(([lon, lat]) => toM(lon, lat));
        if (!ringM.some(([x, y]) => Math.hypot(x, y) < REACH_M)) continue;
        const cx = ringM.reduce((s, p) => s + p[0], 0) / ringM.length, cy = ringM.reduce((s, p) => s + p[1], 0) / ringM.length;
        const h = Number((f.properties as any)?.render_height) || 12;
        out.push({ ring: ring as [number, number][], ringM, height: h, base: zAt(cx, cy), hit: false });
      }
      if (out.length > 400) break;
    }
    return out;
  };

  const spawnAgents = () => {
    agents = [];
    const total = roads.reduce((s, r) => s + r.len, 0) || 1;
    const pickRoad = () => { let r = Math.random() * total; for (const p of roads) { r -= p.len; if (r <= 0) return p; } return roads[roads.length - 1]; };
    for (let i = 0; i < VEHICLES; i++) {
      const bus = i % 5 === 0;
      const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
      agents.push({ poly: pickRoad(), s: 0, dir, speed: bus ? rnd(5, 8) : rnd(6, 11), lateral: 2.2 * dir, size: bus ? BUS : CAR, color: bus ? [235, 235, 240] : pick(CAR_COLORS), person: false, hit: false, pos: [0, 0, 0], yaw: 0 });
    }
    for (let i = 0; i < PEOPLE; i++) {
      const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
      agents.push({ poly: pickRoad(), s: 0, dir, speed: rnd(0.9, 1.6), lateral: (Math.random() < 0.5 ? 5.5 : -5.5) + rnd(-0.8, 0.8), size: PERSON, color: pick(PERSON_COLORS), person: true, hit: false, pos: [0, 0, 0], yaw: 0 });
    }
    for (const a of agents) a.s = Math.random() * a.poly.len;
  };

  const placeAgent = (a: Agent) => {
    const p = along(a.poly, a.s);
    const x = p.x - p.dy * a.lateral, y = p.y + p.dx * a.lateral;
    const [lon, lat] = toLL(x, y);
    a.pos = [lon, lat, elev(lon, lat)];
    a.yaw = (Math.atan2(p.dy, p.dx) * 180) / Math.PI;
    if (a.dir < 0) a.yaw += 180;
    return [x, y] as XY;
  };

  const buildLayers = (): Layer[] => {
    const layers: Layer[] = [];
    // corridor: the flow footprint up to the front, draped just above the terrain
    if (front > 2) {
      const left: [number, number, number][] = [], right: [number, number, number][] = [];
      const step = Math.max(4, front / 60);
      for (let s = 0; s <= front; s += step) {
        const p = along(path, s), w = width(s), z = pathZAt(s) + 0.8;
        const L = toLL(p.x - p.dy * w, p.y + p.dx * w), R = toLL(p.x + p.dy * w, p.y - p.dx * w);
        left.push([L[0], L[1], z]);
        right.push([R[0], R[1], z]);
      }
      const tip = along(path, front), tipLL = toLL(tip.x + tip.dx * width(front) * 0.6, tip.y + tip.dy * width(front) * 0.6);
      const ring = [...left, [tipLL[0], tipLL[1], pathZAt(front) + 0.8] as [number, number, number], ...right.reverse(), left[0]];
      layers.push(new SolidPolygonLayer({ id: "debris-corridor", data: [{ polygon: ring }], getPolygon: (d: any) => d.polygon, getFillColor: [112, 80, 48, 225], pickable: false }));
      layers.push(new ScatterplotLayer({
        id: "debris-particles",
        data: particles,
        getPosition: (d: any) => { const s = ((d.u + tSim * 0.05) % 1) * front; const p = along(path, s); const w = width(s) * 0.9; const ll = toLL(p.x - p.dy * d.v * w, p.y + p.dx * d.v * w); return [ll[0], ll[1], pathZAt(s) + 0.6 + d.r * 0.5 + 0.35 * Math.sin(tSim * 6 + d.u * 40)]; },
        getRadius: (d: any) => d.r,
        radiusUnits: "meters",
        getFillColor: (d: any) => d.color,
        updateTriggers: { getPosition: [front, tSim] },
        pickable: false,
      }));
    }
    // buildings the front has reached
    const hitB = buildings.filter((b) => b.hit);
    if (hitB.length) {
      layers.push(new SolidPolygonLayer({ id: "debris-hit-buildings", data: hitB, getPolygon: (b: Building) => b.ring.map(([lon, lat]) => [lon, lat, b.base] as [number, number, number]), extruded: true, getElevation: (b: Building) => b.height + 1, getFillColor: [225, 60, 50, 165], pickable: false }));
    }
    if (hitRoads.size) {
      layers.push(new PathLayer({ id: "debris-hit-roads", data: [...hitRoads], getPath: (p: Poly) => p.pts.map(([x, y]) => { const ll = toLL(x, y); return [ll[0], ll[1], zAt(x, y) + 0.5] as [number, number, number]; }), getColor: [225, 60, 50, 220], getWidth: 6, widthUnits: "meters", pickable: false }));
    }
    // people and vehicles
    layers.push(new SimpleMeshLayer({
      id: "sim-agents",
      data: agents,
      mesh: MESH as any,
      getPosition: (a: Agent) => a.pos,
      getOrientation: (a: Agent) => (a.hit ? (a.person ? [0, a.yaw, 85] : [18, a.yaw, 8]) : [0, a.yaw, 0]),
      getScale: (a: Agent) => a.size,
      getColor: (a: Agent) => (a.hit ? HIT : a.color) as [number, number, number],
      updateTriggers: { getPosition: tSim, getOrientation: tSim, getColor: tSim },
      pickable: false,
    }));
    return layers;
  };

  const report = () => {
    const imp: Sim3dImpact = { buildings: buildings.filter((b) => b.hit).length, roads: hitRoads.size, people: agents.filter((a) => a.person && a.hit).length, vehicles: agents.filter((a) => !a.person && a.hit).length, frontM: Math.round(front), phase };
    const key = JSON.stringify(imp);
    if (key === lastImpact) return;
    lastImpact = key;
    onImpact(imp);
  };

  const frame = (now: number) => {
    raf = 0;
    if (!result) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    tSim += dt;
    front += (targetFront - front) * Math.min(1, dt * 3);
    for (const a of agents) {
      if (!a.hit) {
        a.s += a.dir * a.speed * dt;
        if (a.s < 0 || a.s > a.poly.len) { a.dir = a.dir === 1 ? -1 : 1; a.s = Math.max(0, Math.min(a.poly.len, a.s)); }
      }
      const [x, y] = placeAgent(a);
      if (!a.hit && inFlow(x, y)) a.hit = true;
    }
    if (front > 2) {
      for (const b of buildings) if (!b.hit && b.ringM.some(([x, y]) => inFlow(x, y))) b.hit = true;
      for (const r of roads) if (!hitRoads.has(r) && r.samples.some(([x, y]) => inFlow(x, y))) hitRoads.add(r);
    }
    deck.setLayers("debris3d", buildLayers());
    report();
    raf = requestAnimationFrame(frame);
  };

  const initScene = (r: SimulationResult) => {
    result = r;
    const pts = r.runoutPath.length >= 2 ? r.runoutPath : [r.runoutPath[0] ?? [114.15, 22.28], r.runoutPath[0] ?? [114.15, 22.28]];
    const toe = pts[pts.length - 1];
    origin = [toe[0], toe[1]];
    mPerLon = M_PER_DEG_LAT * Math.cos((toe[1] * Math.PI) / 180);
    path = makePoly(pts.map(([lon, lat]) => toM(lon, lat)));
    pathZ = pts.map(([lon, lat]) => elev(lon, lat));
    front = 0; targetFront = 0; tSim = 0; phase = "rainfall"; lastImpact = "";
    particles = Array.from({ length: PARTICLES }, () => ({ u: Math.random(), v: rnd(-1, 1), r: rnd(0.6, 2.1), color: pick([[120, 85, 50], [150, 110, 65], [95, 70, 45], [175, 130, 70], [130, 95, 60]]) }));
    roads = roadsNearToe();
    hitRoads = new Set();
    buildings = buildingsNearToe();
    spawnAgents();
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  };

  return {
    reset() {
      if (result) initScene(result);
    },
    show(r) {
      initScene(r);
      // cinematic: from just past the toe, looking up the slope
      const crown = path.pts[0];
      const d = Math.hypot(crown[0], crown[1]) || 1;
      const ux = crown[0] / d, uy = crown[1] / d;
      const center = toLL(-ux * 45, -uy * 45);
      // the command centre folds away when playback starts; that resize cancels any in-flight ease, so let the layout settle first
      setTimeout(() => {
        if (result === r) map.easeTo({ center, zoom: 17, pitch: 60, bearing: (Math.atan2(ux, uy) * 180) / Math.PI, duration: 2200, essential: true });
      }, 450);
    },
    setTime(tSec) {
      if (!result) return;
      const f = result.frames.reduce((best, fr) => (fr.tSec <= tSec ? fr : best), result.frames[0]);
      targetFront = Math.min(path.len, f.debrisFrontM);
      phase = f.phase;
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
    },
    hide() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      result = null;
      deck.setLayers("debris3d", []);
      lastImpact = "";
      onImpact(null);
    },
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      result = null;
      deck.remove("debris3d");
    },
  };
}

// Cinematic 3D playback of a scenario result: the engine's runout path becomes a debris flow over the
// real terrain, with synthetic people and vehicles moving on the real road centrelines below the
// slope, and buildings, roads, people and vehicles lighting up as the front reaches them.
// Illustrative — this presents the scenario engine's result, it computes no physics. Terrain is read
// through one function (`ElevationAt`) so a LiDAR mesh can replace the map DEM later.

import { SolidPolygonLayer, ScatterplotLayer, PathLayer } from "@deck.gl/layers";
import { SimpleMeshLayer, ScenegraphLayer } from "@deck.gl/mesh-layers";
import { GLTFLoader } from "@loaders.gl/gltf";
import type { Layer } from "@deck.gl/core";
import maplibregl from "maplibre-gl";
import { clipSceneRoad, simulationBounds, simulationMoment } from "@/core/simulationScene";
import type { SimulationResult, Sim3dImpact, Slope } from "@/core/types";
import { getDeckOverlay } from "./deckOverlay";
import { loadRealBarriers, ND_INDICATIVE_HEIGHT_M, type Barrier } from "@/live/realBarriers";

export interface Debris3d {
  /** Start playback of a result; the slope (when known) drives the camera framing. */
  show(result: SimulationResult, slope?: Slope, onReady?: () => void): void;
  focus(view?: "scene" | "source" | "toe"): void;
  /** Rewind the same seeded scene and clear contacts, leaving the camera alone. */
  reset(): void;
  setTime(tSec: number): void;
  hide(): void;
  dispose(): void;
}
export type ElevationAt = (lon: number, lat: number) => number;

const M_PER_DEG_LAT = 111_320;
const PARTICLES = 4200; // the body of the flow
const SURGE = 1600; // the churning front
const BOULDERS = 140; // tumbling blocks riding the front
const VEHICLES = 22;
const PEOPLE = 48;
const REACH_M = 420; // roads / buildings this far from the toe take part in the scene
const BODY_COLORS = [[92, 64, 40], [118, 84, 52], [74, 52, 32], [140, 104, 64], [105, 74, 46]];
// wet dark mud, drier ochre crust and pale rock speckle — the mix is what reads as texture from the road
const SURGE_COLORS = [[150, 112, 66], [128, 92, 55], [168, 128, 78], [112, 80, 48], [66, 46, 30], [58, 40, 28], [188, 160, 118], [140, 104, 64]];
const ROCK_COLORS = [[118, 112, 104], [96, 90, 84], [136, 128, 118], [82, 74, 66]];
const CAR_COLORS = [[225, 225, 230], [40, 40, 45], [180, 30, 35], [30, 60, 140], [200, 200, 60], [90, 90, 95]];
const PERSON_COLORS = [[40, 70, 140], [120, 40, 40], [60, 60, 60], [30, 110, 80], [150, 110, 60], [200, 200, 210]];
const HIT: [number, number, number] = [235, 55, 45];

type XY = [number, number];
type Kind = "car" | "bus" | "person";
interface Poly { pts: XY[]; cum: number[]; len: number; samples: XY[] }
interface Agent { kind: Kind; poly: Poly; s: number; dir: 1 | -1; speed: number; lateral: number; color: number[]; hit: boolean; pos: [number, number, number]; yaw: number; startS?: number; startDir?: number }
interface Building { ring: [number, number][]; ringM: XY[]; height: number; base: number; hit: boolean }
/** A REAL CEDD defence measure (ND) near the toe, drawn as a wall of indicative height — the register has no height. */
interface Wall { b: Barrier; ringM: XY[]; base: number; hit: boolean }
const WALL_COLOR: [number, number, number, number] = [96, 124, 156, 235];
const WALL_HIT: [number, number, number, number] = [236, 150, 48, 245];
interface Mesh { attributes: { POSITION: { value: Float32Array; size: number }; NORMAL: { value: Float32Array; size: number }; TEXCOORD_0: { value: Float32Array; size: number } } }

/** Low-poly shapes assembled from boxes, in metres, sitting on z = 0 and facing +x. */
function buildMesh(build: (box: (cx: number, cy: number, z0: number, sx: number, sy: number, sz: number) => void) => void): Mesh {
  const P: number[] = [], N: number[] = [], T: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[]) => {
    for (const v of [a, b, c, a, c, d]) { P.push(v[0], v[1], v[2]); N.push(n[0], n[1], n[2]); T.push(0, 0); }
  };
  build((cx, cy, z0, sx, sy, sz) => {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z1 = z0 + sz;
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
    quad([x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [0, 0, -1]);
    quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]);
    quad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [-1, 0, 0]);
    quad([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [0, 1, 0]);
    quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
  });
  return { attributes: { POSITION: { value: new Float32Array(P), size: 3 }, NORMAL: { value: new Float32Array(N), size: 3 }, TEXCOORD_0: { value: new Float32Array(T), size: 2 } } };
}
const ROCK_MESH = buildMesh((box) => box(0, 0, -0.5, 1, 0.8, 1)); // unit block, centred, scaled per boulder

// glTF models (Khronos glTF sample assets, served from /public/models): CesiumMan and CesiumMilkTruck © Cesium,
// CC-BY 4.0; ToyCar CC0. sizeScale brings each to metres. deck applies no up-axis conversion, and its
// [pitch, yaw, roll] matrix maps the model's +Y to world (…, …, cos(pitch)·sin(roll)), so a Y-up glTF stands
// upright with roll = 90; yaw then turns it onto the heading (+x). A figure facing glTF +Z needs yaw 90 on top;
// the truck's length runs along its own X, so it needs none.
const MODELS: Record<Kind, { url: string; scale: number; base: [number, number, number]; animate: boolean }> = {
  person: { url: "/models/CesiumMan.glb", scale: 1.15, base: [0, 90, 90], animate: true },
  car: { url: "/models/ToyCar.glb", scale: 0.006, base: [0, 0, 90], animate: false },
  bus: { url: "/models/CesiumMilkTruck.glb", scale: 1.25, base: [0, 0, 90], animate: true },
};
const MESHES: Record<Kind, Mesh> = {
  car: buildMesh((box) => {
    box(0, 0, 0.35, 4.4, 1.8, 0.75); // body
    box(-0.2, 0, 1.1, 2.3, 1.6, 0.6); // cabin
    for (const [x, y] of [[1.45, 0.85], [1.45, -0.85], [-1.45, 0.85], [-1.45, -0.85]]) box(x, y, 0, 0.65, 0.25, 0.65);
  }),
  bus: buildMesh((box) => {
    box(0, 0, 0.45, 11, 2.5, 2.7);
    for (const [x, y] of [[3.6, 1.2], [3.6, -1.2], [-3.6, 1.2], [-3.6, -1.2]]) box(x, y, 0, 0.9, 0.3, 0.9);
  }),
  person: buildMesh((box) => {
    box(0, 0.1, 0, 0.16, 0.16, 0.75); // legs
    box(0, -0.1, 0, 0.16, 0.16, 0.75);
    box(0, 0, 0.75, 0.42, 0.28, 0.65); // torso
    box(0, 0, 1.42, 0.24, 0.24, 0.26); // head
  }),
};

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

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function attachDebris3d(map: maplibregl.Map, onImpact: (i: Sim3dImpact | null) => void, elevationAt?: ElevationAt): Debris3d {
  const deck = getDeckOverlay(map);
  // Heights are ABSOLUTE metres: maplibre's queryTerrainElevation is relative to the terrain under the map centre, and
  // deck's interleaved viewport is lifted by that same centre elevation (measured: q + transform.elevation projects
  // onto maplibre's own pixel for the point to within 1 px). Sampling adds the centre back, so caches stay valid
  // wherever the camera goes.
  const centerElev = () => ((map as any).transform?.elevation ?? 0) as number;
  const elevationCache = new Map<string, number>();
  const elev: ElevationAt = elevationAt ?? ((lon, lat) => {
    const x = Math.round(lon * 50000), y = Math.round(lat * 50000);
    const key = `${x},${y}`;
    const cached = elevationCache.get(key);
    if (cached !== undefined) return cached;
    const q = map.queryTerrainElevation({ lng: x / 50000, lat: y / 50000 });
    const height = q === null ? 0 : q + centerElev();
    elevationCache.set(key, height);
    return height;
  });
  const zOff = 0; // draw frame = absolute; kept as a single knob should a LiDAR mesh come in another datum

  let result: SimulationResult | null = null;
  let origin: [number, number] = [0, 0];
  let mPerLon = M_PER_DEG_LAT;
  const toM = (lon: number, lat: number): XY => [(lon - origin[0]) * mPerLon, (lat - origin[1]) * M_PER_DEG_LAT];
  const toLL = (x: number, y: number): XY => [origin[0] + x / mPerLon, origin[1] + y / M_PER_DEG_LAT];
  const zAt = (x: number, y: number) => { const [lon, lat] = toLL(x, y); return elev(lon, lat); };

  let path: Poly = makePoly([[0, 0], [1, 1]]);
  let pathZ: number[] = [];
  let front = 0, phase = "rainfall", tSim = 0;
  let site: Slope | undefined;
  let prepared = false;
  let terrainRevision = 0;
  let terrainTimer: ReturnType<typeof setTimeout> | undefined;
  let prepareTimer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let markers: maplibregl.Marker[] = [];
  let roadContext = "No local road geometry loaded";
  let sceneSeed = 1;
  const random = () => { sceneSeed = (Math.imul(sceneSeed, 1664525) + 1013904223) >>> 0; return sceneSeed / 4294967296; };
  const rnd = (a: number, b: number) => a + random() * (b - a);
  const pick = <T,>(arr: T[]) => arr[Math.floor(random() * arr.length)];
  let body: { u: number; v: number; r: number; h: number; color: number[] }[] = [];
  let surge: { o: number; v: number; r: number; h: number; color: number[] }[] = [];
  let boulders: { o: number; v: number; size: [number, number, number]; spin: number; rate: number; color: number[] }[] = [];
  let agents: Agent[] = [];
  let agentContacts = new Map<Agent, number>();
  let roads: Poly[] = [];
  let hitRoads = new Set<Poly>();
  let buildings: Building[] = [];
  let walls: Wall[] = [];
  let barrierRegister: Barrier[] = [];
  void loadRealBarriers().then((d) => { if (d) barrierRegister = d.all.filter((b) => b.cls === "ND"); });
  let raf = 0;
  let lastImpact = "";
  let useModels = true; // falls back to the built-in low-poly shapes if a glTF fails to load
  // Keep small cut-slope demos proportionate; the old fixed 70 m spread and
  // 6.6 m snout overwhelmed routes only 20 m long.
  const sceneScale = () => Math.max(0.25, Math.min(1, path.len / 120));
  const width = (s: number) => (7 + 28 * (s / Math.max(1, path.len))) * sceneScale();
  /** Flow thickness: a shallow body that bulks up into a surge over the last 45 m before the front (a debris-flow snout). */
  const thickness = (s: number) => {
    const snout = Math.min(45, path.len * 0.6);
    return (1.4 + 5.2 * Math.pow(clamp01((s - (front - snout)) / Math.max(1, snout)), 1.6)) * sceneScale();
  };
  const pathZAt = (s: number) => {
    let i = 1;
    while (i < path.cum.length - 1 && path.cum[i] < s) i++;
    const t = (s - path.cum[i - 1]) / ((path.cum[i] - path.cum[i - 1]) || 1e-9);
    return pathZ[i - 1] + (pathZ[i] - pathZ[i - 1]) * clamp01(t);
  };

  /** Inside the flow (≤ front) — perpendicular distance to the path smaller than the corridor half-width there. */
  const inFlow = (x: number, y: number) => {
    if (front <= 1) return false;
    for (let i = 1; i < path.pts.length; i++) {
      if (path.cum[i - 1] > front) break;
      const a = path.pts[i - 1], b = path.pts[i];
      const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy || 1e-9;
      const t = clamp01(((x - a[0]) * vx + (y - a[1]) * vy) / L2);
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
          for (const pts of clipSceneRoad(line.map(([lon, lat]) => toM(lon, lat)), REACH_M)) {
            const key = `${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}|${pts[pts.length - 1][0].toFixed(1)},${pts[pts.length - 1][1].toFixed(1)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const poly = makePoly(pts);
            if (poly.len > 15) out.push(poly);
          }
        }
      }
      if (out.length) { roadContext = "Local road geometry loaded · people and traffic are illustrative"; break; }
    }
    if (!out.length) {
      roadContext = "No local road geometry loaded · people and traffic omitted";
    }
    return out;
  };

  const buildingsNearToe = (): Building[] => {
    let feats: GeoJSON.Feature[] = [];
    try { feats = map.getSource("openmaptiles") ? (map.querySourceFeatures("openmaptiles", { sourceLayer: "building" }) as GeoJSON.Feature[]) : []; } catch { feats = []; }
    const out: Building[] = [];
    const seen = new Set<string>();
    for (const f of feats) {
      const g = f.geometry;
      const rings = g.type === "Polygon" ? [g.coordinates[0]] : g.type === "MultiPolygon" ? g.coordinates.map((p) => p[0]) : [];
      for (const ring of rings) {
        const ringM = ring.map(([lon, lat]) => toM(lon, lat));
        if (!ringM.some(([x, y]) => Math.hypot(x, y) < REACH_M)) continue;
        const key = JSON.stringify(ring);
        if (seen.has(key)) continue;
        seen.add(key);
        const cx = ringM.reduce((s, p) => s + p[0], 0) / ringM.length, cy = ringM.reduce((s, p) => s + p[1], 0) / ringM.length;
        const h = Number((f.properties as any)?.render_height) || 12;
        out.push({ ring: ring as [number, number][], ringM, height: h, base: zAt(cx, cy), hit: false });
      }
      if (out.length > 400) break;
    }
    return out;
  };

  /** Real ND defence measures within reach of the toe: barriers, bunds and fences the front may run into. */
  const wallsNearToe = (): Wall[] => {
    const out: Wall[] = [];
    for (const b of barrierRegister) {
      const [cx, cy] = toM(b.lon, b.lat);
      if (Math.hypot(cx, cy) > REACH_M + 150) continue;
      out.push({ b, ringM: b.ring.map(([lon, lat]) => toM(lon, lat)), base: zAt(cx, cy), hit: false });
    }
    return out;
  };

  const spawnAgents = () => {
    agents = [];
    if (!roads.length) return;
    const total = roads.reduce((s, r) => s + r.len, 0) || 1;
    const pickRoad = () => { let r = random() * total; for (const p of roads) { r -= p.len; if (r <= 0) return p; } return roads[roads.length - 1]; };
    for (let i = 0; i < VEHICLES; i++) {
      const bus = i % 5 === 0;
      const dir: 1 | -1 = random() < 0.5 ? 1 : -1;
      agents.push({ kind: bus ? "bus" : "car", poly: pickRoad(), s: 0, dir, speed: bus ? rnd(5, 8) : rnd(6, 11), lateral: 2.2 * dir, color: bus ? [235, 235, 240] : pick(CAR_COLORS), hit: false, pos: [0, 0, 0], yaw: 0 });
    }
    for (let i = 0; i < PEOPLE; i++) {
      const dir: 1 | -1 = random() < 0.5 ? 1 : -1;
      agents.push({ kind: "person", poly: pickRoad(), s: 0, dir, speed: rnd(0.9, 1.6), lateral: (random() < 0.5 ? 5.5 : -5.5) + rnd(-0.8, 0.8), color: pick(PERSON_COLORS), hit: false, pos: [0, 0, 0], yaw: 0 });
    }
    for (const a of agents) a.s = random() * a.poly.len;
    // warned in time: most people are already walking away from the slope, and quickly
    const evacuated = Math.max(0, Math.min(0.85, (result?.params.warningLeadTimeMin ?? 0) / 45));
    for (const a of agents) {
      if (a.kind !== "person" || random() > evacuated) continue;
      const here = along(a.poly, a.s), ahead = along(a.poly, Math.min(a.poly.len, a.s + 5));
      const awayFromToe = (ahead.x - here.x) * here.x + (ahead.y - here.y) * here.y > 0; // does +s lead away from the origin (toe)?
      a.dir = awayFromToe ? 1 : -1;
      a.speed = rnd(1.8, 2.6);
    }
    for (const a of agents) { a.startS = a.s; a.startDir = a.dir; }
  };

  const positionAgent = (a: Agent, t: number) => {
    const travel = a.startS! + a.startDir! * a.speed * t / 2;
    const period = 2 * a.poly.len;
    const folded = ((travel % period) + period) % period;
    a.s = folded <= a.poly.len ? folded : period - folded;
    a.dir = (folded <= a.poly.len ? a.startDir! : -a.startDir!) as 1 | -1;
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

  const ringAt = (scale: number, lift: number): [number, number, number][] => {
    const left: [number, number, number][] = [], right: [number, number, number][] = [];
    const step = Math.max(4, front / 60);
    for (let s = 0; s <= front; s += step) {
      const p = along(path, s), w = width(s) * scale;
      const L = toLL(p.x - p.dy * w, p.y + p.dx * w), R = toLL(p.x + p.dy * w, p.y - p.dx * w);
      left.push([L[0], L[1], elev(L[0], L[1]) + lift]);
      right.push([R[0], R[1], elev(R[0], R[1]) + lift]);
    }
    const tip = along(path, front), tipLL = toLL(tip.x + tip.dx * width(front) * scale * 0.7, tip.y + tip.dy * width(front) * scale * 0.7);
    return [...left, [tipLL[0], tipLL[1], pathZAt(front) + lift - zOff], ...right.reverse(), left[0]];
  };

  /** The mass as a chain of quads, each extruded to the local thickness — flat body, tall snout. */
  const massSegments = () => {
    const segs: { polygon: [number, number, number][]; h: number; color: [number, number, number, number] }[] = [];
    const step = Math.max(5, front / 40);
    let prev: { L: XY; R: XY } | null = null;
    for (let s = 0; s <= front + step * 0.5; s += step) {
      const sc = Math.min(s, front);
      const p = along(path, sc), w = width(sc);
      const cur = { L: toLL(p.x - p.dy * w, p.y + p.dx * w), R: toLL(p.x + p.dy * w, p.y - p.dx * w) };
      if (prev) {
        const h = thickness(sc);
        const wet = clamp01((front - sc) / 60); // older, further-back material is darker and wetter
        segs.push({ polygon: [prev.L, cur.L, cur.R, prev.R, prev.L].map(([lon, lat]) => [lon, lat, elev(lon, lat) + 0.3] as [number, number, number]), h, color: [96 - 20 * wet, 66 - 14 * wet, 40 - 8 * wet, 240] });
      }
      prev = cur;
      if (sc >= front) break;
    }
    return segs;
  };

  const buildLayers = (): Layer[] => {
    const layers: Layer[] = [];
    if (result?.failureLikely) layers.push(new PathLayer({
      id: "sim-route-guide", data: [path.pts.map(([x, y]) => toLL(x, y))],
      getPath: (pts: XY[]) => pts.map(([lon, lat]) => [lon, lat, elev(lon, lat) + 3] as [number, number, number]),
      getColor: [255, 213, 110, 210], getWidth: 3, widthUnits: "pixels", pickable: false,
      parameters: { depthCompare: "always" },
    }));
    if (front > 2) {
      // wet spread beyond the mass, then the mass itself (thick snout, thin tail), then the churn on top
      layers.push(new SolidPolygonLayer({ id: "debris-spread", data: [{ polygon: ringAt(1.45, 0.4) }], getPolygon: (d: any) => d.polygon, getFillColor: [120, 90, 55, 95], pickable: false }));
      layers.push(new SolidPolygonLayer({ id: "debris-corridor", data: massSegments(), getPolygon: (d: any) => d.polygon, extruded: true, getElevation: (d: any) => d.h, getFillColor: (d: any) => d.color, updateTriggers: { getElevation: front, getFillColor: front }, pickable: false }));
      layers.push(new ScatterplotLayer({
        id: "debris-particles",
        data: body,
        getPosition: (d: any) => {
          const s = ((d.u + tSim * 0.05) % 1) * front;
          const p = along(path, s), w = width(s) * 0.9;
          const ll = toLL(p.x - p.dy * d.v * w, p.y + p.dx * d.v * w);
          return [ll[0], ll[1], elev(ll[0], ll[1]) + 0.4 + d.h * thickness(s) + 0.3 * Math.sin(tSim * 7 + d.u * 50) - zOff];
        },
        getRadius: (d: any) => d.r,
        radiusUnits: "meters",
        getFillColor: (d: any) => d.color,
        updateTriggers: { getPosition: [front, tSim, terrainRevision] },
        pickable: false,
      }));
      layers.push(new ScatterplotLayer({
        id: "debris-surge",
        data: surge,
        getPosition: (d: any) => {
          const s = Math.max(0, front - d.o * (1 + 0.15 * Math.sin(tSim * 9 + d.v * 20)));
          const p = along(path, s), w = width(s) * 1.05;
          const ll = toLL(p.x - p.dy * d.v * w, p.y + p.dx * d.v * w);
          return [ll[0], ll[1], elev(ll[0], ll[1]) + 0.4 + d.h * (thickness(s) + 1.5) + 0.6 * Math.abs(Math.sin(tSim * 11 + d.o)) - zOff];
        },
        getRadius: (d: any) => d.r,
        radiusUnits: "meters",
        getFillColor: (d: any) => d.color,
        updateTriggers: { getPosition: [front, tSim, terrainRevision] },
        pickable: false,
      }));
      layers.push(new SimpleMeshLayer({
        id: "debris-boulders",
        data: boulders,
        mesh: ROCK_MESH as any,
        getPosition: (d: any) => {
          const s = Math.max(0, front - d.o);
          const p = along(path, s), w = width(s) * 0.9;
          const ll = toLL(p.x - p.dy * d.v * w, p.y + p.dx * d.v * w);
          return [ll[0], ll[1], elev(ll[0], ll[1]) + 0.5 + thickness(s) * 0.9 + d.size[2] * 0.5 - zOff];
        },
        getOrientation: (d: any) => [d.spin + tSim * d.rate, d.v * 90, d.spin * 0.7 + tSim * d.rate * 0.6],
        getScale: (d: any) => d.size,
        getColor: (d: any) => d.color,
        updateTriggers: { getPosition: [front, tSim, terrainRevision], getOrientation: tSim },
        pickable: false,
      }));
    }
    if (walls.length) {
      layers.push(new SolidPolygonLayer({
        id: "debris-barriers", data: walls,
        getPolygon: (w: Wall) => w.b.ring.map(([lon, lat]) => [lon, lat, w.base - zOff] as [number, number, number]),
        extruded: true, getElevation: ND_INDICATIVE_HEIGHT_M, getFillColor: (w: Wall) => (w.hit ? WALL_HIT : WALL_COLOR),
        updateTriggers: { getPolygon: zOff, getFillColor: walls.filter((w) => w.hit).length }, pickable: false,
      }));
    }
    const hitB = buildings.filter((b) => b.hit);
    if (hitB.length) {
      layers.push(new SolidPolygonLayer({ id: "debris-hit-buildings", data: hitB, getPolygon: (b: Building) => b.ring.map(([lon, lat]) => [lon, lat, b.base - zOff] as [number, number, number]), extruded: true, getElevation: (b: Building) => b.height + 1, getFillColor: [225, 60, 50, 150], updateTriggers: { getPolygon: zOff }, pickable: false }));
    }
    if (hitRoads.size) {
      const contacts: XY[][] = [];
      for (const road of hitRoads) {
        for (let i = 1; i < road.samples.length; i++) {
          const a = road.samples[i - 1], b = road.samples[i];
          if (inFlow(a[0], a[1]) || inFlow(b[0], b[1])) contacts.push([a, b]);
        }
      }
      layers.push(new PathLayer({ id: "debris-hit-roads", data: contacts, getPath: (pts: XY[]) => pts.map(([x, y]) => { const ll = toLL(x, y); return [ll[0], ll[1], zAt(x, y) + 0.5 - zOff] as [number, number, number]; }), getColor: [225, 60, 50, 220], getWidth: 6, widthUnits: "meters", pickable: false }));
    }
    for (const kind of ["car", "bus", "person"] as Kind[]) {
      const data = agents.filter((a) => a.kind === kind);
      if (useModels) {
        // dev tuning hook: window.__models = { person: { base: [..], scale }, ... } overrides without a reload
        const tune = (window as any).__models?.[kind] ?? {};
        const mdl = { ...MODELS[kind], ...tune };
        layers.push(new ScenegraphLayer({
          id: `sim-${kind}`,
          data,
          scenegraph: mdl.url,
          loaders: [GLTFLoader],
          sizeScale: mdl.scale,
          _lighting: "pbr",
          _animations: mdl.animate ? { "*": { playing: false } } : undefined,
          getPosition: (a: Agent) => [a.pos[0], a.pos[1], a.pos[2] - zOff],
          getOrientation: (a: Agent) => {
            const [bp, by, br] = mdl.base;
            return a.hit ? (kind === "person" ? [bp + 85, by + a.yaw, br] : [bp + 18, by + a.yaw, br + 8]) : [bp, by + a.yaw, br];
          },
          getColor: (a: Agent) => (a.hit ? HIT : kind === "car" ? a.color : [255, 255, 255]) as [number, number, number],
          updateTriggers: { getPosition: [tSim, terrainRevision], getOrientation: tSim, getColor: tSim },
          onError: (err: Error) => { console.warn(`3D model for ${kind} failed, using built-in shapes:`, err.message); useModels = false; },
          pickable: false,
        } as any));
        continue;
      }
      layers.push(new SimpleMeshLayer({
        id: `sim-${kind}`,
        data,
        mesh: MESHES[kind] as any,
        getPosition: (a: Agent) => [a.pos[0], a.pos[1], a.pos[2] - zOff],
        getOrientation: (a: Agent) => (a.hit ? (a.kind === "person" ? [0, a.yaw, 85] : [18, a.yaw, 8]) : [0, a.yaw, 0]),
        getColor: (a: Agent) => (a.hit ? HIT : a.color) as [number, number, number],
        updateTriggers: { getPosition: [tSim, terrainRevision], getOrientation: tSim, getColor: tSim },
        pickable: false,
      }));
    }
    return layers;
  };

  const report = () => {
    const imp: Sim3dImpact = { buildings: buildings.filter((b) => b.hit).length, roads: hitRoads.size, people: agents.filter((a) => a.kind === "person" && a.hit).length, vehicles: agents.filter((a) => a.kind !== "person" && a.hit).length, barriers: walls.filter((w) => w.hit).length, barriersInScene: walls.length, frontM: Math.round(front), phase, roadContext, buildingsInScene: buildings.length, terrainReady: result!.runoutPath.every(([lng, lat]) => map.queryTerrainElevation({ lng, lat }) !== null) };
    const key = JSON.stringify(imp);
    if (key === lastImpact) return;
    lastImpact = key;
    onImpact(imp);
  };

  const frame = () => {
    raf = 0;
    if (!result || !prepared) return;
    deck.setLayers("debris3d", buildLayers());
    report();
  };

  const setTime = (time: number) => {
    if (!result || !prepared) return;
    const moment = simulationMoment(result, time);
    tSim = moment.tSec;
    phase = moment.phase;
    front = Math.min(path.len, moment.debrisFrontM);
    for (const a of agents) {
      const contact = agentContacts.get(a) ?? Infinity;
      a.hit = contact <= tSim;
      positionAgent(a, Math.min(tSim, contact));
    }
    for (const a of agents) placeAgent(a);
    for (const b of buildings) b.hit = b.ringM.some(([x, y]) => inFlow(x, y));
    for (const w of walls) w.hit = w.ringM.some(([x, y]) => inFlow(x, y));
    hitRoads = new Set(roads.filter(r => r.samples.some(([x, y]) => inFlow(x, y))));
    const p = along(path, front);
    if (markers[2]) {
      markers[2].setLngLat(toLL(p.x, p.y));
      markers[2].getElement().hidden = front < 1;
      markers[2].getElement().textContent = `Front | ${Math.round(front)} m`;
    }
    if (!raf) raf = requestAnimationFrame(frame);
  };

  const initScene = (r: SimulationResult) => {
    result = r;
    elevationCache.clear();
    const pts = r.runoutPath.length >= 2 ? r.runoutPath : [r.runoutPath[0] ?? [114.15, 22.28], r.runoutPath[0] ?? [114.15, 22.28]];
    const toe = pts[pts.length - 1];
    origin = [toe[0], toe[1]];
    mPerLon = M_PER_DEG_LAT * Math.cos((toe[1] * Math.PI) / 180);
    path = makePoly(pts.map(([lon, lat]) => toM(lon, lat)));
    const dense: XY[] = [];
    for (let s = 0; s < path.len; s += 8) { const p = along(path, s); dense.push([p.x, p.y]); }
    dense.push(path.pts[path.pts.length - 1]);
    if (dense.length >= 2) path = makePoly(dense);
    pathZ = path.pts.map(([x, y]) => zAt(x, y));
    front = 0; tSim = 0; phase = "rainfall"; lastImpact = "";
    sceneSeed = [...r.slopeId].reduce((h, c) => Math.imul(h, 31) + c.charCodeAt(0), 7) >>> 0;
    const scale = sceneScale();
    body = Array.from({ length: PARTICLES }, () => ({ u: random(), v: rnd(-1, 1), r: rnd(0.5, 2.4) * scale, h: random(), color: pick(BODY_COLORS) }));
    surge = Array.from({ length: SURGE }, () => ({ o: Math.pow(random(), 1.5) * Math.min(30, path.len * 0.45), v: rnd(-1, 1), r: rnd(1.4, 4.2) * scale, h: random(), color: pick(SURGE_COLORS) }));
    boulders = Array.from({ length: BOULDERS }, () => ({ o: rnd(0, Math.min(28, path.len * 0.45)), v: rnd(-0.9, 0.9), size: [rnd(1, 3.2) * scale, rnd(0.8, 2.6) * scale, rnd(0.8, 2.4) * scale] as [number, number, number], spin: rnd(0, 360), rate: rnd(-140, 140), color: pick(ROCK_COLORS) }));
    roads = roadsNearToe();
    hitRoads = new Set();
    buildings = buildingsNearToe();
    walls = wallsNearToe();
    spawnAgents();
    agentContacts = new Map();
    // Cache deterministic first contacts once. Playback and seeking only interpolate positions.
    for (let t = 0; t <= 60; t += 0.5) {
      front = Math.min(path.len, simulationMoment(r, t).debrisFrontM);
      for (const a of agents) {
        if (agentContacts.has(a)) continue;
        positionAgent(a, t);
        const p = along(a.poly, a.s);
        if (inFlow(p.x - p.dy * a.lateral, p.y + p.dx * a.lateral)) agentContacts.set(a, t);
      }
    }
    prepared = true;
    setTime(0);
  };

  const clearPreparation = () => {
    generation++;
    clearTimeout(prepareTimer);
    clearTimeout(terrainTimer);
    for (const marker of markers) marker.remove();
    markers = [];
  };

  // Zooming loads a different DEM level. Refresh cached heights after arrival or new DEM
  // tiles, including while paused, so a close-up cannot leave debris above/below the ground.
  const refreshTerrain = () => {
    if (!prepared || !result) return;
    clearTimeout(terrainTimer);
    terrainTimer = setTimeout(() => {
      if (!prepared || !result) return;
      if (map.isMoving()) { refreshTerrain(); return; }
      elevationCache.clear();
      terrainRevision++;
      pathZ = path.pts.map(([x, y]) => zAt(x, y));
      for (const b of buildings) {
        const x = b.ringM.reduce((sum, p) => sum + p[0], 0) / b.ringM.length;
        const y = b.ringM.reduce((sum, p) => sum + p[1], 0) / b.ringM.length;
        b.base = zAt(x, y);
      }
      for (const w of walls) w.base = elev(w.b.lon, w.b.lat);
      setTime(tSim);
    }, 200);
  };
  const onTerrainData = (event: maplibregl.MapSourceDataEvent) => {
    if (event.sourceId === "dem" && event.sourceDataType === "content") refreshTerrain();
  };
  map.on("moveend", refreshTerrain);
  map.on("sourcedata", onTerrainData);

  // MapLibre 4's animated camera can apply a cloned transform with stale
  // elevation. Resolve the target against the DEM so a close-up does not aim
  // at sea level and push the slope above the viewport.
  const previousCameraUpdate = map.transformCameraUpdate;
  const sceneCameraUpdate: NonNullable<typeof map.transformCameraUpdate> = transform => {
    const update = previousCameraUpdate?.(transform) ?? {};
    if (!result || !map.getTerrain()) return update;
    const center = update.center ?? transform.center;
    const sampled = map.queryTerrainElevation(center);
    return sampled === null ? update : { ...update, elevation: sampled + centerElev() };
  };
  map.transformCameraUpdate = sceneCameraUpdate;

  const focus = (view: "scene" | "source" | "toe" = "scene") => {
    if (!result) return;
    const box = map.getContainer();
    const hud = box.parentElement?.querySelector(".sim3d-hud");
    const bottom = Math.min(box.clientHeight * 0.48, (hud?.getBoundingClientRect().height ?? 200) + 36);
    const padding = { top: Math.min(100, box.clientHeight * 0.18), bottom, left: Math.min(80, box.clientWidth * 0.12), right: Math.min(80, box.clientWidth * 0.12) };
    const bearing = ((site?.aspectDeg ?? 0) + 150) % 360;
    if (view === "scene") {
      // No minimum zoom: a 900 m runout needs a wider view than a short cut slope.
      // fitBounds adds its padding to existing camera padding in MapLibre 4.
      // Clear the close-up/sidebar padding so repeated recentering still fits.
      map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
      map.fitBounds(simulationBounds(result, site), { padding, bearing, pitch: 30, maxZoom: 17.4, duration: 1200 });
    } else {
      const point = view === "source" ? result.runoutPath[0] : result.runoutPath[result.runoutPath.length - 1];
      map.easeTo({ center: point, zoom: path.len < 120 ? 18 : 17.3, pitch: 50, bearing, padding, duration: 900 });
    }
  };

  return {
    focus,
    reset() { setTime(0); },
    show(r, slope, onReady) {
      clearPreparation();
      const token = generation;
      result = r;
      prepared = false;
      site = slope;
      const addMarker = (point: XY, text: string, kind: string) => {
        const el = document.createElement("div");
        el.className = `sim-site-marker ${kind}`;
        el.textContent = text;
        const marker = new maplibregl.Marker({ element: el, opacityWhenCovered: "1", anchor: kind === "source" ? "bottom-right" : kind === "toe" ? "bottom-left" : "top-right", offset: kind === "source" ? [-12, -42] : kind === "toe" ? [12, -12] : [-35, 12] }).setLngLat(point).addTo(map);
        markers.push(marker);
      };
      addMarker(r.runoutPath[0], r.failureLikely ? "1 | Source slope" : "Tested slope | no failure", "source");
      if (r.failureLikely) {
        addMarker(r.runoutPath[r.runoutPath.length - 1], "2 | Modelled runout end", "toe");
        addMarker(r.runoutPath[0], "Front | 0 m", "front");
        markers[2].getElement().hidden = true;
      }
      const started = performance.now();
      // Let the panel resize finish, then frame the site before sampling local geometry/DEM.
      prepareTimer = setTimeout(() => {
        if (generation !== token) return;
        focus();
        const prepare = () => {
          if (generation !== token) return;
          if (map.isMoving() || (!map.areTilesLoaded() && performance.now() - started < 8000)) {
            prepareTimer = setTimeout(prepare, 150);
            return;
          }
          initScene(r);
          onReady?.();
        };
        prepareTimer = setTimeout(prepare, 1300);
      }, 350);
    },
    setTime,
    hide() {
      clearPreparation();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      result = null;
      prepared = false;
      deck.setLayers("debris3d", []);
      lastImpact = "";
      onImpact(null);
    },
    dispose() {
      clearPreparation();
      if (map.transformCameraUpdate === sceneCameraUpdate) map.transformCameraUpdate = previousCameraUpdate;
      map.off("moveend", refreshTerrain);
      map.off("sourcedata", onTerrainData);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      result = null;
      prepared = false;
      deck.remove("debris3d");
    },
  };
}

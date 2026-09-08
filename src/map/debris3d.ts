// Cinematic 3D playback of a scenario result: the engine's runout path becomes a debris flow over the
// real terrain, with synthetic people and vehicles moving on the real road centrelines below the
// slope, and buildings, roads, people and vehicles lighting up as the front reaches them.
// Illustrative — this presents the scenario engine's result, it computes no physics. Terrain is read
// through one function (`ElevationAt`) so a LiDAR mesh can replace the map DEM later.

import { SolidPolygonLayer, ScatterplotLayer, PathLayer } from "@deck.gl/layers";
import { SimpleMeshLayer, ScenegraphLayer } from "@deck.gl/mesh-layers";
import { GLTFLoader } from "@loaders.gl/gltf";
import type { Layer } from "@deck.gl/core";
import type maplibregl from "maplibre-gl";
import type { SimulationResult, Sim3dImpact, Slope } from "@/core/types";
import { getDeckOverlay } from "./deckOverlay";
import { loadRealBarriers, ND_INDICATIVE_HEIGHT_M, type Barrier } from "@/live/realBarriers";

export interface Debris3d {
  /** Start playback of a result; the slope (when known) drives the camera framing. */
  show(result: SimulationResult, slope?: Slope): void;
  /** Rewind: fresh people, vehicles and hit state for the same result, camera left alone. */
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
interface Agent { kind: Kind; poly: Poly; s: number; dir: 1 | -1; speed: number; lateral: number; color: number[]; hit: boolean; pos: [number, number, number]; yaw: number }
interface Building { ring: [number, number][]; ringM: XY[]; height: number; base: number; hit: boolean }
/** A REAL CEDD defence measure (ND) near the toe, drawn as a wall of indicative height — the register has no height. */
interface Wall { b: Barrier; ringM: XY[]; base: number; hit: boolean }
const WALL_COLOR: [number, number, number, number] = [96, 124, 156, 235];
const WALL_HIT: [number, number, number, number] = [236, 150, 48, 245];
interface Mesh { positions: Float32Array; normals: Float32Array; texCoords: Float32Array }

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
  return { positions: new Float32Array(P), normals: new Float32Array(N), texCoords: new Float32Array(T) };
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

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function attachDebris3d(map: maplibregl.Map, onImpact: (i: Sim3dImpact | null) => void, elevationAt?: ElevationAt): Debris3d {
  const deck = getDeckOverlay(map);
  // Heights are ABSOLUTE metres: maplibre's queryTerrainElevation is relative to the terrain under the map centre, and
  // deck's interleaved viewport is lifted by that same centre elevation (measured: q + transform.elevation projects
  // onto maplibre's own pixel for the point to within 1 px). Sampling adds the centre back, so caches stay valid
  // wherever the camera goes.
  const centerElev = () => ((map as any).transform?.elevation ?? 0) as number;
  const elev: ElevationAt = elevationAt ?? ((lon, lat) => {
    const q = map.queryTerrainElevation({ lng: lon, lat });
    return q === null ? 0 : q + centerElev();
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
  let front = 0, targetFront = 0, phase = "rainfall", tSim = 0;
  let body: { u: number; v: number; r: number; h: number; color: number[] }[] = [];
  let surge: { o: number; v: number; r: number; h: number; color: number[] }[] = [];
  let boulders: { o: number; v: number; size: [number, number, number]; spin: number; rate: number; color: number[] }[] = [];
  let agents: Agent[] = [];
  let roads: Poly[] = [];
  let hitRoads = new Set<Poly>();
  let buildings: Building[] = [];
  let walls: Wall[] = [];
  let barrierRegister: Barrier[] = [];
  void loadRealBarriers().then((d) => { if (d) barrierRegister = d.all.filter((b) => b.cls === "ND"); });
  let raf = 0, last = 0;
  let lastImpact = "";
  let useModels = true; // falls back to the built-in low-poly shapes if a glTF fails to load
  // earthquake: a short camera shake when the scenario's shaking hits (initiation), amplitude from the PGA
  let shakeArmed = false, shakeUntil = 0, shakeAmp = 0;
  let shakeBase: { lng: number; lat: number; bearing: number } | null = null;

  const width = (s: number) => 7 + 28 * (s / Math.max(1, path.len));
  /** Flow thickness: a shallow body that bulks up into a surge over the last 45 m before the front (a debris-flow snout). */
  const thickness = (s: number) => 1.4 + 5.2 * Math.pow(clamp01((s - (front - 45)) / 45), 1.6);
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
    const total = roads.reduce((s, r) => s + r.len, 0) || 1;
    const pickRoad = () => { let r = Math.random() * total; for (const p of roads) { r -= p.len; if (r <= 0) return p; } return roads[roads.length - 1]; };
    for (let i = 0; i < VEHICLES; i++) {
      const bus = i % 5 === 0;
      const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
      agents.push({ kind: bus ? "bus" : "car", poly: pickRoad(), s: 0, dir, speed: bus ? rnd(5, 8) : rnd(6, 11), lateral: 2.2 * dir, color: bus ? [235, 235, 240] : pick(CAR_COLORS), hit: false, pos: [0, 0, 0], yaw: 0 });
    }
    for (let i = 0; i < PEOPLE; i++) {
      const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
      agents.push({ kind: "person", poly: pickRoad(), s: 0, dir, speed: rnd(0.9, 1.6), lateral: (Math.random() < 0.5 ? 5.5 : -5.5) + rnd(-0.8, 0.8), color: pick(PERSON_COLORS), hit: false, pos: [0, 0, 0], yaw: 0 });
    }
    for (const a of agents) a.s = Math.random() * a.poly.len;
    // warned in time: most people are already walking away from the slope, and quickly
    const evacuated = Math.max(0, Math.min(0.85, (result?.params.warningLeadTimeMin ?? 0) / 45));
    for (const a of agents) {
      if (a.kind !== "person" || Math.random() > evacuated) continue;
      const here = along(a.poly, a.s), ahead = along(a.poly, Math.min(a.poly.len, a.s + 5));
      const awayFromToe = (ahead.x - here.x) * here.x + (ahead.y - here.y) * here.y > 0; // does +s lead away from the origin (toe)?
      a.dir = awayFromToe ? 1 : -1;
      a.speed = rnd(1.8, 2.6);
    }
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
      const p = along(path, s), w = width(s) * scale, z = pathZAt(s) + lift - zOff;
      const L = toLL(p.x - p.dy * w, p.y + p.dx * w), R = toLL(p.x + p.dy * w, p.y - p.dx * w);
      left.push([L[0], L[1], z]);
      right.push([R[0], R[1], z]);
    }
    const tip = along(path, front), tipLL = toLL(tip.x + tip.dx * width(front) * scale * 0.7, tip.y + tip.dy * width(front) * scale * 0.7);
    return [...left, [tipLL[0], tipLL[1], pathZAt(front) + lift - zOff], ...right.reverse(), left[0]];
  };

  /** The mass as a chain of quads, each extruded to the local thickness — flat body, tall snout. */
  const massSegments = () => {
    const segs: { polygon: [number, number, number][]; h: number; color: [number, number, number, number] }[] = [];
    const step = Math.max(5, front / 40);
    let prev: { L: XY; R: XY; z: number } | null = null;
    for (let s = 0; s <= front + step * 0.5; s += step) {
      const sc = Math.min(s, front);
      const p = along(path, sc), w = width(sc), z = pathZAt(sc) + 0.3 - zOff;
      const cur = { L: toLL(p.x - p.dy * w, p.y + p.dx * w), R: toLL(p.x + p.dy * w, p.y - p.dx * w), z };
      if (prev) {
        const h = thickness(sc);
        const wet = clamp01((front - sc) / 60); // older, further-back material is darker and wetter
        segs.push({ polygon: [[...prev.L, prev.z], [...cur.L, cur.z], [...cur.R, cur.z], [...prev.R, prev.z], [...prev.L, prev.z]], h, color: [96 - 20 * wet, 66 - 14 * wet, 40 - 8 * wet, 240] });
      }
      prev = cur;
      if (sc >= front) break;
    }
    return segs;
  };

  const buildLayers = (): Layer[] => {
    const layers: Layer[] = [];
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
          return [ll[0], ll[1], pathZAt(s) + 0.4 + d.h * thickness(s) + 0.3 * Math.sin(tSim * 7 + d.u * 50) - zOff];
        },
        getRadius: (d: any) => d.r,
        radiusUnits: "meters",
        getFillColor: (d: any) => d.color,
        updateTriggers: { getPosition: [front, tSim] },
        pickable: false,
      }));
      layers.push(new ScatterplotLayer({
        id: "debris-surge",
        data: surge,
        getPosition: (d: any) => {
          const s = Math.max(0, front - d.o * (1 + 0.15 * Math.sin(tSim * 9 + d.v * 20)));
          const p = along(path, s), w = width(s) * 1.05;
          const ll = toLL(p.x - p.dy * d.v * w, p.y + p.dx * d.v * w);
          return [ll[0], ll[1], pathZAt(s) + 0.4 + d.h * (thickness(s) + 1.5) + 0.6 * Math.abs(Math.sin(tSim * 11 + d.o)) - zOff];
        },
        getRadius: (d: any) => d.r,
        radiusUnits: "meters",
        getFillColor: (d: any) => d.color,
        updateTriggers: { getPosition: [front, tSim] },
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
          return [ll[0], ll[1], pathZAt(s) + 0.5 + thickness(s) * 0.9 + d.size[2] * 0.5 - zOff];
        },
        getOrientation: (d: any) => [d.spin + tSim * d.rate, d.v * 90, d.spin * 0.7 + tSim * d.rate * 0.6],
        getScale: (d: any) => d.size,
        getColor: (d: any) => d.color,
        updateTriggers: { getPosition: [front, tSim], getOrientation: tSim },
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
      layers.push(new PathLayer({ id: "debris-hit-roads", data: [...hitRoads], getPath: (p: Poly) => p.pts.map(([x, y]) => { const ll = toLL(x, y); return [ll[0], ll[1], zAt(x, y) + 0.5 - zOff] as [number, number, number]; }), getColor: [225, 60, 50, 220], getWidth: 6, widthUnits: "meters", updateTriggers: { getPath: zOff }, pickable: false }));
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
          _animations: mdl.animate ? { "*": { speed: 1 } } : undefined,
          getPosition: (a: Agent) => [a.pos[0], a.pos[1], a.pos[2] - zOff],
          getOrientation: (a: Agent) => {
            const [bp, by, br] = mdl.base;
            return a.hit ? (kind === "person" ? [bp + 85, by + a.yaw, br] : [bp + 18, by + a.yaw, br + 8]) : [bp, by + a.yaw, br];
          },
          getColor: (a: Agent) => (a.hit ? HIT : kind === "car" ? a.color : [255, 255, 255]) as [number, number, number],
          updateTriggers: { getPosition: tSim, getOrientation: tSim, getColor: tSim },
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
        updateTriggers: { getPosition: tSim, getOrientation: tSim, getColor: tSim },
        pickable: false,
      }));
    }
    return layers;
  };

  const report = () => {
    const imp: Sim3dImpact = { buildings: buildings.filter((b) => b.hit).length, roads: hitRoads.size, people: agents.filter((a) => a.kind === "person" && a.hit).length, vehicles: agents.filter((a) => a.kind !== "person" && a.hit).length, barriers: walls.filter((w) => w.hit).length, barriersInScene: walls.length, frontM: Math.round(front), phase };
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
      for (const w of walls) if (!w.hit && w.ringM.some(([x, y]) => inFlow(x, y))) w.hit = true;
      for (const r of roads) if (!hitRoads.has(r) && r.samples.some(([x, y]) => inFlow(x, y))) hitRoads.add(r);
    }
    if (shakeUntil > now) {
      if (!shakeBase) { const c = map.getCenter(); shakeBase = { lng: c.lng, lat: c.lat, bearing: map.getBearing() }; }
      const k = (shakeUntil - now) / 1400; // fades out
      const m = shakeAmp * k;
      map.jumpTo({ center: [shakeBase.lng + (rnd(-m, m) / mPerLon), shakeBase.lat + rnd(-m, m) / M_PER_DEG_LAT], bearing: shakeBase.bearing + rnd(-0.6, 0.6) * k });
    } else if (shakeBase) {
      map.jumpTo({ center: [shakeBase.lng, shakeBase.lat], bearing: shakeBase.bearing });
      shakeBase = null;
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
    shakeArmed = (r.params.seismicPga ?? 0) >= 0.05; shakeUntil = 0; shakeBase = null;
    shakeAmp = 1.2 + 6 * Math.min(1, (r.params.seismicPga ?? 0) / 0.4); // metres of camera jitter
    body = Array.from({ length: PARTICLES }, () => ({ u: Math.random(), v: rnd(-1, 1), r: rnd(0.5, 2.4), h: Math.random(), color: pick(BODY_COLORS) }));
    surge = Array.from({ length: SURGE }, () => ({ o: Math.pow(Math.random(), 1.5) * 30, v: rnd(-1, 1), r: rnd(1.4, 4.2), h: Math.random(), color: pick(SURGE_COLORS) }));
    boulders = Array.from({ length: BOULDERS }, () => ({ o: rnd(0, 28), v: rnd(-0.9, 0.9), size: [rnd(1, 3.2), rnd(0.8, 2.6), rnd(0.8, 2.4)] as [number, number, number], spin: rnd(0, 360), rate: rnd(-140, 140), color: pick(ROCK_COLORS) }));
    roads = roadsNearToe();
    hitRoads = new Set();
    buildings = buildingsNearToe();
    walls = wallsNearToe();
    spawnAgents();
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  };

  return {
    reset() {
      if (result) initScene(result);
    },
    show(r, slope) {
      initScene(r);
      // cinematic framing from the geometry: look *uphill* along the slope's own aspect (falling back to the
      // toe→crown direction of the runout), and fit the slope polygon plus the whole runout in view
      const crown = path.pts[0];
      const d = Math.hypot(crown[0], crown[1]) || 1;
      const ux = crown[0] / d, uy = crown[1] / d;
      const bearing = slope && slope.aspectDeg > 0 ? (slope.aspectDeg + 180) % 360 : (Math.atan2(ux, uy) * 180) / Math.PI;
      const pts: [number, number][] = [...r.runoutPath, ...(slope?.polygon ?? [])];
      let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
      for (const [lon, lat] of pts) { west = Math.min(west, lon); east = Math.max(east, lon); south = Math.min(south, lat); north = Math.max(north, lat); }
      const fit = map.cameraForBounds([[west, south], [east, north]], { bearing, padding: { top: 60, bottom: 120, left: 80, right: 80 }, maxZoom: 17.4 });
      // cameraForBounds frames a flat view: under pitch the uphill end compresses toward the top of the screen,
      // so bias the centre toward the crown and hold a little back
      const crownLL = r.runoutPath[0], toeLL = r.runoutPath[r.runoutPath.length - 1];
      const center: [number, number] = fit ? [(fit.center as any).lng ?? (fit.center as any)[0], (fit.center as any).lat ?? (fit.center as any)[1]] : toLL(-ux * 30, -uy * 30);
      center[0] += (crownLL[0] - toeLL[0]) * 0.25;
      center[1] += (crownLL[1] - toeLL[1]) * 0.25;
      const target = fit ? { center, zoom: Math.max(15.8, (fit.zoom ?? 17) - 0.2), pitch: 60, bearing } : { center, zoom: 17.2, pitch: 60, bearing };
      const go = () => {
        if (result !== r) return;
        map.easeTo({ ...target, duration: 2200, essential: true });
      };
      // the command centre folds away and the basemap may switch when playback starts; both cancel an in-flight ease
      setTimeout(() => (map.isStyleLoaded() ? go() : map.once("idle", go)), 500);
    },
    setTime(tSec) {
      if (!result) return;
      const f = result.frames.reduce((best, fr) => (fr.tSec <= tSec ? fr : best), result.frames[0]);
      targetFront = Math.min(path.len, f.debrisFrontM);
      if (shakeArmed && f.phase !== "rainfall" && f.phase !== "saturation" && f.phase !== "deformation" && phase !== f.phase) {
        shakeArmed = false;
        shakeUntil = performance.now() + 1400;
      }
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

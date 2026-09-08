// City-scale synthetic dataset generation. Deterministic (seeded), explicitly synthetic.

import {
  Asset,
  AssetKind,
  CensusContext,
  Incident,
  Mitigation,
  MitigationType,
  RealIncident,
  Region,
  SensorKind,
  SensorMeta,
  Slope,
  SlopeEvent,
  SlopeType,
  ValidationRecord,
  WorksProgramme,
} from "@/core/types";
import { HILL_CLUSTERS, HillCluster, samplePointInCluster, sampleUniformInCluster, walkInsideCluster, offsetM, distanceM, pointInRing } from "./geo";
import { TERRAIN_GRIDS, TerrainGrid } from "./terrainGrid";
import { clamp, pick, range, rangeInt, rngFor } from "./random";
import { fetchRealSlopeShells, RealSlopeShell, fetchLpmWorks, LpmWork, LpmWorks, normSlopeNo, quarterLabelToIso } from "@/live/csdi";
import { reportSource } from "@/core/dataSources";
import { buildRealAssets, loadRealAssets, type RealAssetData } from "@/live/realAssets";
import { loadRealBarriers, type Barrier } from "@/live/realBarriers";
import { RAIN_GAUGES } from "@/live/baked/gauges";
import { u16 } from "@/live/baked/decode";
import type { CensusUnit } from "@/live/baked/census";
import type { EntliGrid } from "@/live/baked/entliGrid";
import type { SlopeIncidentRow } from "@/live/baked/slopeIncidents";

/** Fixed game-time origin so all freshness/history math is deterministic. */
// Each session starts now; synthetic signals remain seeded relative to this epoch.
export const GAME_EPOCH = Date.now();

const SLOPE_COUNT = 5000;

const GEOLOGIES = [
  "Completely decomposed granite (synthetic)",
  "Completely decomposed volcanics (synthetic)",
  "Colluvium over CDG (synthetic)",
  "Highly decomposed tuff (synthetic)",
  "Fill over decomposed granite (synthetic)",
  "Residual soil / saprolite (synthetic)",
];

const SLOPE_TYPES: SlopeType[] = ["soil-cut", "rock-cut", "fill", "natural", "retaining-wall"];
const SENSOR_KINDS: SensorKind[] = [
  "rainfall",
  "displacement-total",
  "displacement-horizontal",
  "displacement-vertical",
  "pore-pressure",
  "groundwater",
  "gnss-movement",
  "soil-moisture",
];

// ---------- real-terrain sampler (baked DEM grids, see scripts/build-terrain.mjs) ----------

function decodeB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const x2lon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const y2lat = (y: number, z: number) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

export interface TerrainSample {
  p: [number, number];
  slopeDeg: number;
  aspectDeg: number; // downhill bearing from north
  elevM: number;
}

/**
 * Samples hillside cells of one massif: only land cells at or above STEEP_MIN degrees, weighted
 * toward steeper ground, so synthetic slope features sit on real slopes and face downhill.
 */
class TerrainSampler {
  private static readonly STEEP_MIN = 16;
  private slope: Uint8Array;
  private aspect: Uint8Array;
  private height: Uint8Array;
  private cells: number[] = [];
  private cum: number[] = [];
  private total = 0;

  constructor(private g: TerrainGrid, ring: [number, number][]) {
    this.slope = decodeB64(g.slope);
    this.aspect = decodeB64(g.aspect);
    this.height = decodeB64(g.height);
    for (let i = 0; i < g.cols * g.rows; i++) {
      const s = this.slope[i];
      if (s < TerrainSampler.STEEP_MIN) continue;
      if (!pointInRing(this.centre(i), ring)) continue;
      this.cells.push(i);
      this.total += s - TerrainSampler.STEEP_MIN + 2;
      this.cum.push(this.total);
    }
  }

  get usable(): boolean {
    return this.cells.length > 0;
  }

  private centre(i: number): [number, number] {
    const { cols, px0, py0, z, ds } = this.g;
    const q = i % cols;
    const r = Math.floor(i / cols);
    const px = px0 + 1 + q * ds + Math.floor(ds / 2);
    const py = py0 + 1 + r * ds + Math.floor(ds / 2);
    return [x2lon((px + 0.5) / 256, z), y2lat((py + 0.5) / 256, z)];
  }

  sample(rng: () => number): TerrainSample {
    const t = rng() * this.total;
    let lo = 0;
    let hi = this.cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    const i = this.cells[lo];
    const c = this.centre(i);
    // jitter within the cell (≈ ds source pixels)
    const { ds, z } = this.g;
    const pxSpan = ds / 256 / 2 ** z;
    const p: [number, number] = [c[0] + (rng() - 0.5) * pxSpan * 360, c[1] + (rng() - 0.5) * pxSpan * 300];
    return { p, slopeDeg: this.slope[i], aspectDeg: (this.aspect[i] / 255) * 360, elevM: this.height[i] * 4 };
  }
}

const TERRAIN_BY_NAME = new Map(TERRAIN_GRIDS.map((g) => [g.name, g]));

// ---------- point lookup into the baked DEM grids (for real slope locations) ----------

const decodedGridCache = new Map<string, { slope: Uint8Array; aspect: Uint8Array; height: Uint8Array }>();

function decodedGrid(g: TerrainGrid) {
  let d = decodedGridCache.get(g.name);
  if (!d) {
    d = { slope: decodeB64(g.slope), aspect: decodeB64(g.aspect), height: decodeB64(g.height) };
    decodedGridCache.set(g.name, d);
  }
  return d;
}

/** Real relief at a lon/lat, from whichever massif grid covers it (null outside all grids). */
function terrainAt(p: [number, number]): { slopeDeg: number; aspectDeg: number; elevM: number } | null {
  for (const g of TERRAIN_GRIDS) {
    const px = ((p[0] + 180) / 360) * 2 ** g.z * 256;
    const n = Math.asinh(Math.tan((p[1] * Math.PI) / 180));
    const py = ((Math.PI - n) / (2 * Math.PI)) * 2 ** g.z * 256;
    const q = Math.floor((px - g.px0 - 1) / g.ds);
    const r = Math.floor((py - g.py0 - 1) / g.ds);
    if (q < 0 || r < 0 || q >= g.cols || r >= g.rows) continue;
    const d = decodedGrid(g);
    const i = r * g.cols + q;
    return { slopeDeg: d.slope[i], aspectDeg: (d.aspect[i] / 255) * 360, elevM: d.height[i] * 4 };
  }
  return null;
}

// ---------- real slope inventory & real context (CEDD / C&SD via CSDI) ----------
//
// When the fetch succeeds, the twin's slope inventory uses REAL registered slope polygons and
// registration attributes (slope no., district, height, angle, maintenance party). Real context is
// then joined onto each slope: the LPM works programme and CEDD landslide incidents (by slope
// number), 2021 census population and ENTLI landslide density (by location), and the nearest GEO
// raingauge. Sensors, soil parameters, risk and the remaining history events stay synthetic.
// If CSDI is unreachable the generator falls back to the fully synthetic cluster placement below.

let realShells: RealSlopeShell[] | null = null;
let lpmBySlope = new Map<string, LpmWork>();
let censusUnits: CensusUnit[] = [];
let entli: { g: EntliGrid; k: Map<number, number>; recent: Uint16Array; relict: Uint16Array } | null = null;
let slopeIncidents: Record<string, SlopeIncidentRow[]> = {};
let incidentsLoaded = false; // once real incident records are in, no synthetic incidents are invented
let realAssetData: RealAssetData | null = null; // facilities + per-slope buildings/roads (LandsD, HA, EDB, FSD, HKPF, DH)
let barriersBySlope: Map<string, Barrier[]> | null = null; // CEDD ND / NS natural terrain mitigation measures within 200 m of a slope

/** Baked real context (census, ENTLI grid, per-slope incidents) — separate chunks, loaded in parallel with the inventory. */
async function loadBakedContext(): Promise<void> {
  const [c, e, i, ra, rb] = await Promise.all([import("@/live/baked/census"), import("@/live/baked/entliGrid"), import("@/live/baked/slopeIncidents"), loadRealAssets(), loadRealBarriers()]);
  realAssetData = ra;
  barriersBySlope = rb?.bySlope ?? null;
  censusUnits = c.CENSUS_UNITS;
  const g = e.ENTLI_GRID;
  const cells = u16(g.cells);
  const k = new Map<number, number>();
  cells.forEach((cell, idx) => k.set(cell, idx));
  entli = { g, k, recent: u16(g.recent), relict: u16(g.relict) };
  slopeIncidents = i.SLOPE_INCIDENTS;
  incidentsLoaded = true;
  reportSource("census-2021", { ok: true, count: censusUnits.length });
  reportSource("cedd-entli-grid", { ok: true, count: cells.length, note: `${g.totals.recent.toLocaleString()} recent · ${g.totals.relict.toLocaleString()} relict crowns` });
  reportSource("cedd-incidents-slope", { ok: true, count: Object.keys(slopeIncidents).length, note: "registered slopes with ≥ 1 recorded incident" });
}

/** Fetch the real inventory and context before the first getDataset() call. Returns false on fallback. */
export async function prepareRealSlopes(): Promise<boolean> {
  if (realShells) return true;
  const bakedP = loadBakedContext().catch((err) => console.warn("Baked real context unavailable.", err));
  let ok = false;
  try {
    const lpm = await fetchLpmWorks().catch((err): LpmWorks | null => {
      console.warn("CSDI LPM works programme unavailable.", err);
      return null;
    });
    if (lpm) lpmBySlope = new Map(lpm.slopes.map((w) => [w.key, w]));
    const shells = await fetchRealSlopeShells(lpm ? lpm.slopes.map((w) => w.slopeNo) : []);
    if (shells.length < 500) throw new Error(`only ${shells.length} shells`);
    realShells = shells;
    ok = true;
  } catch (err) {
    console.warn("CSDI slope inventory unavailable — using synthetic slope placement.", err);
    reportSource("cedd-slopes", { ok: false, note: String((err as Error)?.message ?? err) });
  }
  await bakedP;
  return ok;
}

const RAIN_EPOCH_MS = Date.UTC(1984, 0, 1);
const isoFromDay = (day: number) => new Date(RAIN_EPOCH_MS + day * 86400_000).toISOString();

/** Census unit containing a point — smallest containing polygon wins (holes are simply other units). */
function censusAt(p: [number, number]): CensusUnit | null {
  let best: CensusUnit | null = null;
  for (const u of censusUnits) {
    const b = u.bbox;
    if (p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) continue;
    if (!u.rings.some((r) => pointInRing(p, r))) continue;
    if (!best || u.areaM2 < best.areaM2) best = u;
  }
  return best;
}

/** ENTLI landslide crowns per km² within ~500 m of a point (5×5 block of 250 m cells). */
function entliDensityAt(p: [number, number]): number | undefined {
  if (!entli) return undefined;
  const { g, k, recent, relict } = entli;
  const q0 = Math.floor((p[0] - g.lon0) / g.dLon);
  const r0 = Math.floor((p[1] - g.lat0) / g.dLat);
  if (q0 < -2 || r0 < -2 || q0 >= g.cols + 2 || r0 >= g.rows + 2) return undefined;
  let n = 0;
  for (let r = r0 - 2; r <= r0 + 2; r++) {
    for (let q = q0 - 2; q <= q0 + 2; q++) {
      if (q < 0 || r < 0 || q >= g.cols || r >= g.rows) continue;
      const idx = k.get(r * g.cols + q);
      if (idx !== undefined) n += recent[idx] + relict[idx];
    }
  }
  return Math.round(n / (25 * 0.0625)); // 25 cells × 0.0625 km²
}

function nearestGauge(p: [number, number]): Slope["nearestGauge"] {
  let best: (typeof RAIN_GAUGES)[number] | null = null;
  let bestD = Infinity;
  for (const g of RAIN_GAUGES) {
    const d = distanceM(p, [g.lon, g.lat]);
    if (d < bestD) { bestD = d; best = g; }
  }
  return best ? { id: best.id, name: best.name, distM: Math.round(bestD) } : undefined;
}

interface RealContext {
  works?: WorksProgramme;
  census?: CensusContext;
  populationNearby?: number; // census-derived residents within reach
  entliPerKm2?: number;
  realIncidents: RealIncident[];
  events: SlopeEvent[]; // real history events (works, incidents)
  nearestGauge?: Slope["nearestGauge"];
}

/** Everything real we can say about one slope from government open data. */
function realContextFor(id: string, centroid: [number, number], heightM: number): RealContext {
  const key = normSlopeNo(id);
  const events: SlopeEvent[] = [];

  let works: WorksProgramme | undefined;
  const w = lpmBySlope.get(key);
  if (w) {
    const startIso = quarterLabelToIso(w.startLabel);
    const status = startIso && Date.parse(startIso) <= GAME_EPOCH ? "in-progress" : "pending";
    works = { kind: w.kind, contract: w.contract, location: w.location, startLabel: w.startLabel, completionLabel: w.completionLabel, status };
    events.push({
      date: startIso ?? new Date(GAME_EPOCH).toISOString(),
      kind: "works",
      label: `LPM upgrading works — contract ${w.contract}`,
      detail: `CEDD LPMitP programme: start ${w.startLabel}, completion ${w.completionLabel} (${status}).`,
      real: true,
    });
  }

  const realIncidents: RealIncident[] = (slopeIncidents[key] ?? []).map(([day, vol, ref]) => ({
    date: day >= 0 ? isoFromDay(day) : null,
    volumeM3: vol >= 0 ? vol : null,
    ref,
  }));
  for (const inc of realIncidents) {
    if (!inc.date) continue;
    events.push({
      date: inc.date,
      kind: "incident",
      label: `Landslide incident ${inc.ref}${inc.volumeM3 !== null ? ` — ${inc.volumeM3} m³` : ""}`,
      detail: "CEDD landslide incident database (real record).",
      real: true,
    });
  }

  let census: CensusContext | undefined;
  let populationNearby: number | undefined;
  const u = censusAt(centroid);
  if (u && u.pop > 0 && u.areaM2 > 0) {
    // residents inside a disc of ~2× slope height around the feature, at the local census density
    const reachM = clamp(heightM * 2.1, 40, 220);
    const densityPerKm2 = u.pop / (u.areaM2 / 1e6);
    census = { stpu: u.code, densityPerKm2: Math.round(densityPerKm2), share65Plus: u.age[4] / u.pop, shareUnder15: u.age[0] / u.pop, reachM: Math.round(reachM) };
    populationNearby = Math.round((densityPerKm2 * Math.PI * reachM * reachM) / 1e6);
  }

  return { works, census, populationNearby, entliPerKm2: entliDensityAt(centroid), realIncidents, events, nearestGauge: nearestGauge(centroid) };
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s,/(-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

/** Feature-type letter of a registration number ("11SW-A/C123" → cut, F → fill, R → wall). */
function slopeTypeFor(id: string, rng: () => number): SlopeType {
  const m = id.match(/\/\s*([A-Z]+)/);
  const code = m?.[1] ?? "";
  if (code.startsWith("F")) return "fill";
  if (code.startsWith("R")) return "retaining-wall";
  if (code.startsWith("C")) return rng() < 0.25 ? "rock-cut" : "soil-cut";
  return "natural";
}

/** Build twin slopes from real CEDD shells; synthetic enrichment is seeded per slope id. */
function slopesFromShells(shells: RealSlopeShell[], assets: Asset[], nearbyReal?: Map<string, string[]>): Slope[] {
  // pre-bucket assets by cluster index (asset ids embed "-<clusterIndex>-") — synthetic fallback only
  const clusterAssets = nearbyReal ? [] : HILL_CLUSTERS.map((_, ci) => assets.filter((a) => a.id.includes(`-${ci}-`)));
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const slopes: Slope[] = [];
  for (const shell of shells) {
    const rng = rngFor("slope", shell.id);
    const t = terrainAt(shell.centroid);
    const slopeAngleDeg = shell.angleDeg > 0 ? clamp(shell.angleDeg, 10, 88) : Math.round(range(rng, 25, 55));
    const heightM = clamp(shell.heightM, 3, 250);
    const ctx = realContextFor(shell.id, shell.centroid, heightM);
    // local natural-terrain landslide density (real, ENTLI) replaces one random term of the baseline
    const entliTerm = ctx.entliPerKm2 !== undefined ? clamp(Math.log10(1 + ctx.entliPerKm2) / 2.5, 0, 1) : rng();
    const susceptibility = clamp(
      0.28 * ((slopeAngleDeg - 22) / 40) +
        0.22 * rng() +
        0.2 * rng() * rng() +
        0.15 * (heightM / 180) +
        0.15 * entliTerm,
      0.03,
      0.97
    );
    const instrumented = rng() < 0.55 || susceptibility > 0.65;
    const hasData = rng() > 0.07;

    // nearest massif provides the synthetic exposure context (assets, base elevation)
    let ci = 0;
    let bestD = Infinity;
    HILL_CLUSTERS.forEach((c, i) => {
      const d = (c.lon - shell.centroid[0]) ** 2 + (c.lat - shell.centroid[1]) ** 2;
      if (d < bestD) { bestD = d; ci = i; }
    });
    // real neighbours (LandsD buildings/road + facilities within 500 m) when baked; synthetic cluster assets otherwise
    const nearby = nearbyReal
      ? (nearbyReal.get(normSlopeNo(shell.id)) ?? []).map((id) => assetById.get(id)).filter((a): a is Asset => !!a)
      : clusterAssets[ci].filter(() => rng() < 0.22).slice(0, 4);

    slopes.push({
      id: shell.id,
      name: titleCase(shell.location) || `${shell.district} slope`,
      region: shell.region,
      district: shell.district,
      centroid: shell.centroid,
      polygon: shell.polygon,
      elevationM: Math.round(t?.elevM ?? HILL_CLUSTERS[ci].baseElevation * range(rng, 0.15, 0.7)),
      heightM: Math.round(heightM),
      slopeAngleDeg: Math.round(slopeAngleDeg),
      areaM2: shell.areaM2,
      aspectDeg: Math.round(t?.aspectDeg ?? range(rng, 0, 360)),
      slopeType: slopeTypeFor(shell.id, rng),
      geology: pick(rng, GEOLOGIES),
      soil: {
        cohesionKPa: Math.round(range(rng, 2, 24)),
        frictionAngleDeg: Math.round(range(rng, 26, 42)),
        permeability: pick(rng, ["low", "medium", "high"] as const),
        saturationBase: range(rng, 0.25, 0.6),
      },
      drainage: {
        type: pick(rng, ["surface-channels", "raking-drains", "catchpits", "none"] as const),
        condition: range(rng, 0.35, 1),
        lastCleared: isoDaysAgo(rangeInt(rng, 20, 700)),
      },
      vegetationCover: range(rng, 0.05, 0.95),
      mitigations: makeMitigations(rng, susceptibility, barriersBySlope ? (barriersBySlope.get(normSlopeNo(shell.id)) ?? []) : null),
      nearbyAssetIds: nearby.map((a) => a.id),
      sensors: makeSensors(shell.id, rng, instrumented),
      history: [...makeHistory(rng, susceptibility, !incidentsLoaded), ...ctx.events].sort((a, b) => a.date.localeCompare(b.date)),
      freshness: {
        sensor: new Date(GAME_EPOCH - rangeInt(rng, 1, 30) * 60_000).toISOString(),
        rainfall: new Date(GAME_EPOCH - rangeInt(rng, 2, 15) * 60_000).toISOString(),
        geometry: isoDaysAgo(rangeInt(rng, 5, 900)),
        inspection: isoDaysAgo(rangeInt(rng, 10, 720)),
        simulation: new Date(GAME_EPOCH - rangeInt(rng, 10, 2000) * 60_000).toISOString(),
        record: isoDaysAgo(rangeInt(rng, 1, 60)),
      },
      susceptibility,
      populationNearby:
        ctx.populationNearby ??
        Math.round(Math.exp(range(rng, Math.log(15), Math.log(1800))) + nearby.filter((a) => a.kind === "building").length * range(rng, 80, 400)),
      hasData,
      isSynthetic: true, // hazard state is synthetic; geometry & registration are CEDD
      works: ctx.works,
      census: ctx.census,
      entliPerKm2: ctx.entliPerKm2,
      realIncidents: ctx.realIncidents,
      nearestGauge: ctx.nearestGauge,
    });
  }
  return slopes;
}

/** Largest vertex distance from the centroid, in metres — the disc the polygon is guaranteed to fit in. */
function boundingRadiusM(centroid: [number, number], polygon: [number, number][]): number {
  let r = 0;
  for (const p of polygon) r = Math.max(r, distanceM(centroid, p));
  return r;
}

/**
 * Spatial hash that keeps slope footprints apart: two slopes may not be closer (centre to centre)
 * than the sum of their bounding radii plus a clear gap, so no polygon ever overlaps another.
 */
class SlopePacker {
  private static readonly GAP_M = 12;
  private static readonly CELL_DEG = 0.004; // ≈ 420 m, larger than any slope diameter + gap
  private cells = new Map<string, { p: [number, number]; r: number }[]>();

  private key(cx: number, cy: number): string {
    return `${cx}:${cy}`;
  }

  private cellOf(p: [number, number]): [number, number] {
    return [Math.floor(p[0] / SlopePacker.CELL_DEG), Math.floor(p[1] / SlopePacker.CELL_DEG)];
  }

  fits(p: [number, number], r: number): boolean {
    const [cx, cy] = this.cellOf(p);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = this.cells.get(this.key(cx + dx, cy + dy));
        if (!bucket) continue;
        for (const o of bucket) {
          if (distanceM(p, o.p) < r + o.r + SlopePacker.GAP_M) return false;
        }
      }
    }
    return true;
  }

  add(p: [number, number], r: number): void {
    const [cx, cy] = this.cellOf(p);
    const k = this.key(cx, cy);
    const bucket = this.cells.get(k);
    if (bucket) bucket.push({ p, r });
    else this.cells.set(k, [{ p, r }]);
  }
}

function isoDaysAgo(days: number): string {
  return new Date(GAME_EPOCH - days * 86400_000).toISOString();
}

function slopeIdFor(cluster: HillCluster, idx: number, rng: () => number): string {
  const sheet = rangeInt(rng, 2, 16);
  const quad = pick(rng, ["NW", "NE", "SW", "SE"]);
  const feat = pick(rng, ["C", "F", "R", "CR"]);
  return `${sheet}${quad}-${feat}/${String(idx).padStart(4, "0")}`;
}

function makePolygon(centroid: [number, number], aspectDeg: number, areaM2: number, rng: () => number): [number, number][] {
  // Irregular octagon elongated across the aspect direction (slope wider than long).
  const widthM = Math.sqrt(areaM2) * range(rng, 1.2, 1.8);
  const depthM = areaM2 / widthM;
  const theta = ((90 - aspectDeg) * Math.PI) / 180; // aspect → math angle of downhill
  const across = [Math.cos(theta + Math.PI / 2), Math.sin(theta + Math.PI / 2)];
  const down = [Math.cos(theta), Math.sin(theta)];
  const pts: [number, number][] = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const rW = (widthM / 2) * (0.75 + rng() * 0.5);
    const rD = (depthM / 2) * (0.75 + rng() * 0.5);
    const e = Math.cos(ang) * rW * across[0] + Math.sin(ang) * rD * down[0];
    const nn = Math.cos(ang) * rW * across[1] + Math.sin(ang) * rD * down[1];
    pts.push(offsetM(centroid, e, nn));
  }
  pts.push(pts[0]);
  return pts;
}

function makeMitigations(rng: () => number, susceptibility: number, realBarriers: Barrier[] | null = null): Mitigation[] {
  const out: Mitigation[] = [];
  // once the real CEDD register of debris barriers is loaded, no synthetic barriers are invented
  const candidates: MitigationType[] = realBarriers
    ? ["soil-nails", "retaining-wall", "surface-drainage", "shotcrete", "rock-mesh"]
    : ["soil-nails", "retaining-wall", "debris-barrier", "surface-drainage", "shotcrete", "rock-mesh"];
  const count = rng() < 0.25 ? 0 : rangeInt(rng, 1, susceptibility > 0.6 ? 3 : 2);
  for (let i = 0; i < count; i++) {
    out.push({
      type: pick(rng, candidates),
      installedYear: rangeInt(rng, 1998, 2025),
      condition: clamp(range(rng, 0.45, 1), 0, 1),
    });
  }
  // REAL: CEDD-registered natural terrain hazard mitigation measures within 200 m (Catalogue of Slopes ND / NS).
  // Their existence, footprint and maintainer are published; year and condition are not, so condition stays synthetic.
  for (const b of realBarriers ?? []) {
    const d = b.slopes.find(([sid]) => sid)?.[1];
    out.push({
      type: b.cls === "ND" ? "debris-barrier" : "natural-terrain-stabilisation",
      installedYear: 0,
      condition: clamp(range(rng, 0.65, 1), 0, 1),
      real: true,
      ref: b.id,
      note: `${b.cls === "ND" ? "Defence measure" : "Stabilisation measure"} · footprint ${b.lengthM} m × ${b.widthM} m · maintained by ${b.maint || "—"}${d !== undefined ? ` · ${d} m from this slope` : ""}`,
    });
  }
  return out;
}

function makeSensors(slopeId: string, rng: () => number, instrumented: boolean): SensorMeta[] {
  if (!instrumented) return [];
  const kinds = SENSOR_KINDS.filter(() => rng() < 0.62);
  if (kinds.length === 0) kinds.push("rainfall");
  return kinds.map((kind, i) => ({
    id: `${slopeId}-S${i + 1}`,
    kind,
    installedYear: rangeInt(rng, 2016, 2025),
    online: rng() > 0.06,
    anomalous: rng() < 0.05,
  }));
}

function makeHistory(rng: () => number, susceptibility: number, allowSyntheticIncident = true): SlopeEvent[] {
  const events: SlopeEvent[] = [];
  const templates: { kind: SlopeEvent["kind"]; label: string }[] = [
    { kind: "inspection", label: "Routine engineer inspection" },
    { kind: "maintenance", label: "Drainage maintenance / clearing" },
    { kind: "uav-survey", label: "UAV photogrammetry survey" },
    { kind: "lidar-survey", label: "LiDAR survey" },
    { kind: "works", label: "Stabilization works package" },
    { kind: "extreme-rainfall", label: "Extreme rainfall event recorded" },
    { kind: "sensor-anomaly", label: "Sensor anomaly investigated" },
    { kind: "minor-movement", label: "Minor movement detected" },
  ];
  const n = rangeInt(rng, 4, 9);
  for (let i = 0; i < n; i++) {
    const t = pick(rng, templates);
    const daysAgo = rangeInt(rng, 10, 2900);
    events.push({ date: isoDaysAgo(daysAgo), kind: t.kind, label: t.label });
  }
  if (allowSyntheticIncident && susceptibility > 0.72 && rng() < 0.5) {
    events.push({
      date: isoDaysAgo(rangeInt(rng, 200, 2200)),
      kind: "incident",
      label: "Historical landslide incident (synthetic)",
      detail: "Recorded failure with debris reaching downslope catchment.",
    });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

export interface Dataset {
  slopes: Slope[];
  assets: Asset[];
  activeIncidents: Incident[];
  historicalIncidents: Incident[];
  validation: ValidationRecord[];
}

function generateAssetsFor(cluster: HillCluster, ci: number): Asset[] {
  const rng = rngFor("assets", cluster.name);
  const assets: Asset[] = [];
  const roadNames = ["Hillside Road", "Peak Drive", "Valley Access Rd", "Reservoir Rd", "Ridge Path Rd"];
  const nRoads = rangeInt(rng, 2, 4);
  for (let r = 0; r < nRoads; r++) {
    // road stays on land: random walk constrained to the massif footprint
    const line = walkInsideCluster(cluster, rng, 7, 450);
    assets.push({
      id: `RD-${ci}-${r}`,
      kind: "road",
      name: `${pick(rng, roadNames)} ${ci}${r} (synthetic)`,
      location: line[Math.floor(line.length / 2)],
      line,
      populationServed: rangeInt(rng, 800, 20000),
      criticality: range(rng, 0.3, 0.9),
    });
  }
  const bldKinds: AssetKind[] = ["building", "building", "building", "building", "school", "hospital", "railway", "drainage", "utility", "emergency-route"];
  const nB = rangeInt(rng, 10, 18);
  for (let b = 0; b < nB; b++) {
    const kind = pick(rng, bldKinds);
    const loc = samplePointInCluster(cluster, rng); // on land only
    const namePrefix: Record<string, string> = {
      building: "Residential Block",
      school: "School",
      hospital: "Hospital",
      railway: "Rail Segment",
      drainage: "Drainage Culvert",
      utility: "Utility Substation",
      "emergency-route": "Emergency Route",
    };
    assets.push({
      id: `AS-${ci}-${b}`,
      kind,
      name: `${namePrefix[kind] ?? "Asset"} ${cluster.district} ${b} (synthetic)`,
      location: loc,
      populationServed:
        kind === "hospital" ? rangeInt(rng, 10000, 40000) : kind === "school" ? rangeInt(rng, 500, 1800) : kind === "building" ? rangeInt(rng, 300, 4000) : rangeInt(rng, 1000, 15000),
      criticality: kind === "hospital" || kind === "emergency-route" ? range(rng, 0.8, 1) : range(rng, 0.2, 0.8),
    });
  }
  return assets;
}

export function generateDataset(): Dataset {
  const totalWeight = HILL_CLUSTERS.reduce((s, c) => s + c.weight, 0);
  const slopes: Slope[] = [];
  let assets: Asset[] = [];
  let nearbyReal: Map<string, string[]> | undefined;

  if (realShells?.length && realAssetData) {
    // REAL exposure: facilities + LandsD buildings/roads joined to each registered slope
    const built = buildRealAssets(realShells.map((s) => ({ id: s.id, centroid: s.centroid })), realAssetData);
    assets = built.assets;
    nearbyReal = built.nearby;
  } else {
    HILL_CLUSTERS.forEach((cluster, ci) => {
      assets.push(...generateAssetsFor(cluster, ci));
    });
  }

  // Preferred path: real CEDD slope polygons (prepared by prepareRealSlopes() at boot).
  if (realShells?.length) {
    slopes.push(...slopesFromShells(realShells, assets, nearbyReal));
  }

  let counter = 0;
  const packer = new SlopePacker();
  if (!slopes.length) HILL_CLUSTERS.forEach((cluster, ci) => {
    const clusterAssets = assets.filter((a) => a.id.includes(`-${ci}-`));
    const n = Math.round((cluster.weight / totalWeight) * SLOPE_COUNT);
    const grid = TERRAIN_BY_NAME.get(cluster.name);
    const terrain = grid ? new TerrainSampler(grid, cluster.footprint) : null;
    const onTerrain = !!terrain && terrain.usable;
    for (let i = 0; i < n; i++) {
      counter++;
      const rng = rngFor("slope", cluster.name, i);
      const id = slopeIdFor(cluster, counter, rng);
      // Slope feature footprint, log-uniform 600–15,000 m² (median ≈ 3,000): large enough to read on the
      // map at district zoom, small enough that the packer can keep them all apart.
      let areaM2 = Math.exp(range(rng, Math.log(600), Math.log(15000)));

      // Placement: a real hillside cell from the DEM grid (steep ground, weighted steeper), the polygon
      // laid along the contour with its downhill side on the DEM aspect; never overlapping a placed slope.
      // Falls back to footprint sampling only if a massif has no baked terrain.
      let centroid: [number, number] | null = null;
      let polygon: [number, number][] = [];
      let aspectDeg = range(rng, 0, 360);
      let demSlope = range(rng, 18, 40);
      let elevationM = cluster.baseElevation * range(rng, 0.25, 1);
      for (let attempt = 0; attempt < 90 && !centroid; attempt++) {
        let cand: [number, number];
        if (onTerrain) {
          const t = terrain!.sample(rng);
          if (!pointInRing(t.p, cluster.footprint)) continue;
          cand = t.p;
          aspectDeg = t.aspectDeg;
          demSlope = t.slopeDeg;
          elevationM = t.elevM;
        } else {
          cand = attempt < 12 ? samplePointInCluster(cluster, rng) : sampleUniformInCluster(cluster, rng);
        }
        const poly = makePolygon(cand, aspectDeg, areaM2, rng);
        const radiusM = boundingRadiusM(cand, poly);
        if (packer.fits(cand, radiusM)) {
          packer.add(cand, radiusM);
          centroid = cand;
          polygon = poly;
        } else if (attempt % 30 === 29) {
          areaM2 *= 0.7; // crowded massif: try a smaller feature before giving up
        }
      }
      if (!centroid) continue; // footprint is full — skip rather than overlap

      // engineered faces are steeper than the surrounding natural ground
      const slopeAngleDeg = clamp(demSlope + range(rng, 6, 24), 22, 65);
      const heightM = clamp(Math.sqrt(areaM2) * Math.tan((slopeAngleDeg * Math.PI) / 180) * range(rng, 0.3, 0.7), 4, 120);
      const susceptibilityRaw =
        0.28 * (slopeAngleDeg - 22) / 40 +
        0.22 * rng() +
        0.2 * rng() * rng() +
        0.15 * (heightM / 180) +
        0.15 * rng();
      const susceptibility = clamp(susceptibilityRaw, 0.03, 0.97);
      const instrumented = rng() < 0.55 || susceptibility > 0.65;
      const hasData = rng() > 0.07; // ~7% grey: insufficient data
      const slopeType = pick(rng, SLOPE_TYPES);
      const nearby = clusterAssets.filter(() => rng() < 0.22).slice(0, 4);
      const ctx = realContextFor(id, centroid, heightM); // census / ENTLI / gauge by location (ids are synthetic, so no works or incidents)

      slopes.push({
        id,
        name: `${cluster.name} slope ${i + 1}`,
        region: cluster.region,
        district: cluster.district,
        centroid,
        polygon,
        elevationM: Math.round(elevationM),
        heightM: Math.round(heightM),
        slopeAngleDeg: Math.round(slopeAngleDeg),
        areaM2: Math.round(areaM2),
        aspectDeg: Math.round(aspectDeg),
        slopeType,
        geology: pick(rng, GEOLOGIES),
        soil: {
          cohesionKPa: Math.round(range(rng, 2, 24)),
          frictionAngleDeg: Math.round(range(rng, 26, 42)),
          permeability: pick(rng, ["low", "medium", "high"] as const),
          saturationBase: range(rng, 0.25, 0.6),
        },
        drainage: {
          type: pick(rng, ["surface-channels", "raking-drains", "catchpits", "none"] as const),
          condition: range(rng, 0.35, 1),
          lastCleared: isoDaysAgo(rangeInt(rng, 20, 700)),
        },
        vegetationCover: range(rng, 0.05, 0.95),
        mitigations: makeMitigations(rng, susceptibility),
        nearbyAssetIds: nearby.map((a) => a.id),
        sensors: makeSensors(id, rng, instrumented),
        history: makeHistory(rng, susceptibility),
        freshness: {
          sensor: new Date(GAME_EPOCH - rangeInt(rng, 1, 30) * 60_000).toISOString(),
          rainfall: new Date(GAME_EPOCH - rangeInt(rng, 2, 15) * 60_000).toISOString(),
          geometry: isoDaysAgo(rangeInt(rng, 5, 900)),
          inspection: isoDaysAgo(rangeInt(rng, 10, 720)),
          simulation: new Date(GAME_EPOCH - rangeInt(rng, 10, 2000) * 60_000).toISOString(),
          record: isoDaysAgo(rangeInt(rng, 1, 60)),
        },
        susceptibility,
        // residents within the slope's reach (log-uniform 15–1,800, denser where residential blocks are linked);
        // asset service catchments are NOT counted here — they are indirect exposure, shown separately
        populationNearby:
          ctx.populationNearby ??
          Math.round(Math.exp(range(rng, Math.log(15), Math.log(1800))) + nearby.filter((a) => a.kind === "building").length * range(rng, 80, 400)),
        hasData,
        isSynthetic: true,
        census: ctx.census,
        entliPerKm2: ctx.entliPerKm2,
        realIncidents: [],
        nearestGauge: ctx.nearestGauge,
      });
    }
  });

  // Active incidents on some of the most susceptible slopes
  const bySusc = [...slopes].sort((a, b) => b.susceptibility - a.susceptibility);
  const activeIncidents: Incident[] = bySusc.slice(0, 60).filter((_, i) => i % 10 === 0).map((s, i) => {
    const rng = rngFor("incident", s.id);
    const kinds: Incident["kind"][] = ["landslide", "rockfall", "debris-flow", "road-blockage", "flooding"];
    return {
      id: `INC-${1000 + i}`,
      slopeId: s.id,
      kind: pick(rng, kinds),
      location: s.centroid,
      startedAt: new Date(GAME_EPOCH - rangeInt(rng, 20, 400) * 60_000).toISOString(),
      status: pick(rng, ["active", "responding"] as const),
      severity: pick(rng, [1, 2, 2, 3] as const),
      description: "Synthetic incident generated for demonstration.",
    };
  });

  // Historical incidents → validation records
  const historicalIncidents: Incident[] = [];
  const validation: ValidationRecord[] = [];
  bySusc.slice(0, 120).forEach((s, i) => {
    if (i % 4 !== 0) return;
    const rng = rngFor("hist-incident", s.id);
    const date = isoDaysAgo(rangeInt(rng, 60, 2600));
    const inc: Incident = {
      id: `HIST-${2000 + i}`,
      slopeId: s.id,
      kind: pick(rng, ["landslide", "debris-flow", "rockfall"] as const),
      location: s.centroid,
      startedAt: date,
      status: "resolved",
      severity: pick(rng, [1, 2, 3] as const),
      description: "Synthetic historical incident used for model validation demo.",
    };
    historicalIncidents.push(inc);
    const obsFail = range(rng, 2, 30);
    const obsRunout = range(rng, 20, 320);
    const obsDisp = range(rng, 15, 220);
    const obsArea = range(rng, 400, 16000);
    // model error shrinks for more recent model versions
    const ageDays = (GAME_EPOCH - Date.parse(date)) / 86400_000;
    const version = ageDays > 1600 ? "v1.0" : ageDays > 800 ? "v2.0" : "v3.1";
    const errScale = version === "v1.0" ? 0.5 : version === "v2.0" ? 0.3 : 0.15;
    const err = () => 1 + range(rng, -errScale, errScale);
    validation.push({
      incidentId: inc.id,
      slopeId: s.id,
      date,
      modelVersion: version,
      predicted: {
        failureTimeH: +(obsFail * err()).toFixed(1),
        runoutM: Math.round(obsRunout * err()),
        displacementMm: Math.round(obsDisp * err()),
        areaM2: Math.round(obsArea * err()),
      },
      observed: {
        failureTimeH: +obsFail.toFixed(1),
        runoutM: Math.round(obsRunout),
        displacementMm: Math.round(obsDisp),
        areaM2: Math.round(obsArea),
      },
    });
  });

  return { slopes, assets, activeIncidents, historicalIncidents, validation };
}

let cached: Dataset | null = null;
export function getDataset(): Dataset {
  if (!cached) cached = generateDataset();
  return cached;
}

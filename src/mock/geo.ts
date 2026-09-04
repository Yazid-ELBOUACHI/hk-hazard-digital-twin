// Hong Kong hill-massif footprints for plausible synthetic slope placement.
//
// Each cluster carries a coarse LAND FOOTPRINT polygon (lon/lat ring) drawn conservatively
// inside the real coastline of that upland area. Slopes and assets are only ever sampled
// inside these footprints, so nothing synthetic is placed over the harbour or open sea.
// Footprints are approximate and deliberately shrunk; everything generated inside them is synthetic.

import type { Region } from "@/core/types";

export type LonLat = [number, number];

export interface HillCluster {
  name: string;
  region: Region;
  district: string;
  lon: number; // approximate massif centre (used for gaussian weighting only)
  lat: number;
  spreadDeg: number; // gaussian-ish spread before clipping to the footprint
  weight: number; // relative share of slopes
  baseElevation: number;
  footprint: LonLat[]; // land-only ring, conservative
}

export const HILL_CLUSTERS: HillCluster[] = [
  {
    name: "Victoria Peak", region: "HK Island", district: "Central & Western", lon: 114.150, lat: 22.271, spreadDeg: 0.012, weight: 7, baseElevation: 320,
    footprint: [[114.131, 22.270], [114.136, 22.279], [114.150, 22.282], [114.165, 22.280], [114.172, 22.272], [114.165, 22.262], [114.150, 22.259], [114.136, 22.263]],
  },
  {
    name: "Mount Parker / Quarry Bay", region: "HK Island", district: "Eastern", lon: 114.212, lat: 22.270, spreadDeg: 0.011, weight: 7, baseElevation: 280,
    footprint: [[114.195, 22.275], [114.200, 22.283], [114.215, 22.284], [114.227, 22.278], [114.229, 22.266], [114.220, 22.256], [114.205, 22.258], [114.195, 22.265]],
  },
  {
    name: "Pok Fu Lam Uplands", region: "HK Island", district: "Southern", lon: 114.145, lat: 22.255, spreadDeg: 0.009, weight: 3, baseElevation: 210,
    footprint: [[114.133, 22.256], [114.140, 22.262], [114.150, 22.259], [114.158, 22.254], [114.155, 22.250], [114.145, 22.248], [114.136, 22.250]],
  },
  {
    name: "Lion Rock", region: "Kowloon", district: "Wong Tai Sin", lon: 114.188, lat: 22.351, spreadDeg: 0.011, weight: 6, baseElevation: 300,
    footprint: [[114.170, 22.345], [114.175, 22.358], [114.190, 22.362], [114.205, 22.358], [114.205, 22.345], [114.190, 22.340], [114.175, 22.340]],
  },
  {
    name: "Kowloon Peak", region: "Kowloon", district: "Kwun Tong", lon: 114.222, lat: 22.336, spreadDeg: 0.011, weight: 7, baseElevation: 340,
    footprint: [[114.205, 22.330], [114.208, 22.345], [114.222, 22.350], [114.235, 22.345], [114.238, 22.332], [114.228, 22.322], [114.212, 22.322]],
  },
  {
    name: "Beacon Hill", region: "Kowloon", district: "Sham Shui Po", lon: 114.164, lat: 22.349, spreadDeg: 0.010, weight: 4, baseElevation: 260,
    footprint: [[114.150, 22.343], [114.153, 22.355], [114.165, 22.360], [114.178, 22.355], [114.178, 22.343], [114.165, 22.338], [114.152, 22.338]],
  },
  {
    name: "Tai Mo Shan South", region: "NT West", district: "Tsuen Wan", lon: 114.120, lat: 22.397, spreadDeg: 0.020, weight: 13, baseElevation: 520,
    footprint: [[114.090, 22.380], [114.095, 22.405], [114.110, 22.420], [114.135, 22.422], [114.150, 22.410], [114.150, 22.385], [114.130, 22.372], [114.105, 22.372]],
  },
  {
    name: "Castle Peak", region: "NT West", district: "Tuen Mun", lon: 113.955, lat: 22.394, spreadDeg: 0.013, weight: 7, baseElevation: 380,
    footprint: [[113.938, 22.380], [113.940, 22.400], [113.952, 22.412], [113.968, 22.408], [113.972, 22.392], [113.965, 22.378], [113.950, 22.376]],
  },
  {
    name: "Kam Tin Hills", region: "NT West", district: "Yuen Long", lon: 114.067, lat: 22.439, spreadDeg: 0.016, weight: 8, baseElevation: 220,
    footprint: [[114.040, 22.425], [114.045, 22.450], [114.065, 22.460], [114.090, 22.455], [114.095, 22.435], [114.080, 22.420], [114.055, 22.418]],
  },
  {
    name: "Ma On Shan", region: "NT East", district: "Sha Tin", lon: 114.247, lat: 22.397, spreadDeg: 0.014, weight: 8, baseElevation: 480,
    footprint: [[114.225, 22.385], [114.228, 22.400], [114.238, 22.415], [114.255, 22.418], [114.268, 22.405], [114.265, 22.388], [114.250, 22.378], [114.235, 22.375]],
  },
  {
    name: "Pat Sin Leng", region: "NT East", district: "North", lon: 114.215, lat: 22.485, spreadDeg: 0.015, weight: 6, baseElevation: 420,
    footprint: [[114.190, 22.478], [114.195, 22.494], [114.215, 22.499], [114.235, 22.494], [114.238, 22.485], [114.225, 22.474], [114.205, 22.470]],
  },
  {
    name: "Sai Kung Peninsula", region: "NT East", district: "Sai Kung", lon: 114.325, lat: 22.415, spreadDeg: 0.022, weight: 11, baseElevation: 300,
    footprint: [[114.292, 22.402], [114.296, 22.420], [114.315, 22.432], [114.345, 22.430], [114.360, 22.415], [114.352, 22.402], [114.330, 22.400], [114.310, 22.400]],
  },
  {
    name: "Tai Po Uplands", region: "NT East", district: "Tai Po", lon: 114.158, lat: 22.454, spreadDeg: 0.014, weight: 8, baseElevation: 280,
    footprint: [[114.135, 22.440], [114.138, 22.462], [114.155, 22.472], [114.178, 22.468], [114.182, 22.452], [114.170, 22.440], [114.150, 22.436]],
  },
  {
    name: "Lantau Peak", region: "Lantau", district: "Islands", lon: 113.935, lat: 22.256, spreadDeg: 0.018, weight: 9, baseElevation: 560,
    footprint: [[113.905, 22.245], [113.912, 22.262], [113.930, 22.275], [113.955, 22.272], [113.965, 22.258], [113.960, 22.244], [113.940, 22.238], [113.920, 22.238]],
  },
  {
    name: "Sunset Peak", region: "Lantau", district: "Islands", lon: 113.977, lat: 22.259, spreadDeg: 0.013, weight: 6, baseElevation: 500,
    footprint: [[113.960, 22.248], [113.962, 22.268], [113.975, 22.278], [113.990, 22.272], [113.993, 22.258], [113.988, 22.246], [113.972, 22.243]],
  },
];

export const HK_CENTER: LonLat = [114.13, 22.36];
export const HK_BOUNDS: [LonLat, LonLat] = [
  [113.8, 22.13],
  [114.45, 22.58],
];

const M_PER_DEG_LAT = 110_574;
export function mPerDegLon(lat: number): number {
  return 111_320 * Math.cos((lat * Math.PI) / 180);
}

/** Offset a lon/lat point by meters east/north. */
export function offsetM(p: LonLat, eastM: number, northM: number): LonLat {
  return [p[0] + eastM / mPerDegLon(p[1]), p[1] + northM / M_PER_DEG_LAT];
}

export function distanceM(a: LonLat, b: LonLat): number {
  const dx = (a[0] - b[0]) * mPerDegLon((a[1] + b[1]) / 2);
  const dy = (a[1] - b[1]) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/** Ray-casting point-in-polygon (ring need not be closed). */
export function pointInRing(p: LonLat, ring: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi + 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function bbox(ring: LonLat[]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function ringCentroid(ring: LonLat[]): LonLat {
  let x = 0;
  let y = 0;
  for (const [px, py] of ring) {
    x += px;
    y += py;
  }
  return [x / ring.length, y / ring.length];
}

/**
 * Sample a point on land inside the cluster footprint. Gaussian-ish around the massif centre
 * first (keeps the natural "hill cluster" look), falling back to uniform-in-footprint so the
 * result is always inside the land ring. Deterministic given the rng.
 */
export function samplePointInCluster(cluster: HillCluster, rng: () => number): LonLat {
  const ring = cluster.footprint;
  const g = () => (rng() + rng() + rng() - 1.5) / 1.5;
  for (let i = 0; i < 24; i++) {
    const p: LonLat = [cluster.lon + g() * cluster.spreadDeg, cluster.lat + g() * cluster.spreadDeg * 0.85];
    if (pointInRing(p, ring)) return p;
  }
  const [minX, minY, maxX, maxY] = bbox(ring);
  for (let i = 0; i < 200; i++) {
    const p: LonLat = [minX + rng() * (maxX - minX), minY + rng() * (maxY - minY)];
    if (pointInRing(p, ring)) return p;
  }
  return ringCentroid(ring);
}

/**
 * Walk a polyline of `steps` segments of `stepM` metres that stays inside the footprint:
 * when a step would leave land the heading is bent back toward the massif centre.
 */
export function walkInsideCluster(cluster: HillCluster, rng: () => number, steps: number, stepM: number): LonLat[] {
  const start = samplePointInCluster(cluster, rng);
  const line: LonLat[] = [start];
  let heading = rng() * Math.PI * 2;
  for (let s = 0; s < steps; s++) {
    heading += rng() - 0.5;
    let next = offsetM(line[line.length - 1], Math.cos(heading) * stepM, Math.sin(heading) * stepM);
    let tries = 0;
    while (!pointInRing(next, cluster.footprint) && tries < 8) {
      const cur = line[line.length - 1];
      const toCentre = Math.atan2(cluster.lat - cur[1], (cluster.lon - cur[0]) * Math.cos((cur[1] * Math.PI) / 180));
      heading = toCentre + (rng() - 0.5) * 0.8;
      next = offsetM(cur, Math.cos(heading) * stepM, Math.sin(heading) * stepM);
      tries++;
    }
    if (!pointInRing(next, cluster.footprint)) break;
    line.push(next);
  }
  return line;
}

/** Uniform sample inside the footprint (no centre bias) — used when packing slopes without overlap. */
export function sampleUniformInCluster(cluster: HillCluster, rng: () => number): LonLat {
  const ring = cluster.footprint;
  const [minX, minY, maxX, maxY] = bbox(ring);
  for (let i = 0; i < 200; i++) {
    const p: LonLat = [minX + rng() * (maxX - minX), minY + rng() * (maxY - minY)];
    if (pointInRing(p, ring)) return p;
  }
  return ringCentroid(ring);
}

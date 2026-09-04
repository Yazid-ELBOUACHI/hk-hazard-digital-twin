// Pure geodesic helpers for UI code (no mock imports).

export type LonLat = [number, number];

const M_PER_DEG_LAT = 110_574;

export function mPerDegLon(lat: number): number {
  return 111_320 * Math.cos((lat * Math.PI) / 180);
}

/** Approximate planar distance in metres between two lon/lat points (fine at HK scale). */
export function distanceM(a: LonLat, b: LonLat): number {
  const dx = (a[0] - b[0]) * mPerDegLon((a[1] + b[1]) / 2);
  const dy = (a[1] - b[1]) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/** Nearest distance from a point to a polyline, in metres. */
export function distanceToLineM(p: LonLat, line: LonLat[]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    best = Math.min(best, segDist(p, line[i], line[i + 1]));
  }
  return best === Infinity ? distanceM(p, line[0]) : best;
}

function segDist(p: LonLat, a: LonLat, b: LonLat): number {
  const k = mPerDegLon(p[1]);
  const px = (p[0] - a[0]) * k;
  const py = (p[1] - a[1]) * M_PER_DEG_LAT;
  const bx = (b[0] - a[0]) * k;
  const by = (b[1] - a[1]) * M_PER_DEG_LAT;
  const len2 = bx * bx + by * by || 1e-9;
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  return Math.hypot(px - t * bx, py - t * by);
}

export function fmtDistance(m: number): string {
  return m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

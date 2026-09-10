import type { SimulationResult, Slope } from "./types";

type XY = [number, number];

/** Fit the complete site, including the width of the deposit, on small and large maps. */
export function simulationBounds(result: SimulationResult, slope?: Slope): [XY, XY] {
  const points = [...result.runoutPath, ...(slope?.polygon ?? [])];
  const west = Math.min(...points.map(p => p[0])), east = Math.max(...points.map(p => p[0]));
  const south = Math.min(...points.map(p => p[1])), north = Math.max(...points.map(p => p[1]));
  const dy = 55 / 111320, dx = dy / Math.cos((south + north) * Math.PI / 360);
  return [[west - dx, south - dy], [east + dx, north + dy]];
}

/** Interpolate by model time, so pausing and seeking do not depend on wall-clock time. */
export function simulationMoment(result: SimulationResult, time: number) {
  const frames = result.frames;
  const t = Math.max(frames[0].tSec, Math.min(frames[frames.length - 1].tSec, time));
  const i = frames.findIndex(f => f.tSec >= t);
  const b = frames[i], a = frames[Math.max(0, i - 1)];
  const mix = b.tSec === a.tSec ? 0 : (t - a.tSec) / (b.tSec - a.tSec);
  return { ...((t === b.tSec) ? b : a), tSec: t, debrisFrontM: result.failureLikely ? a.debrisFrontM + (b.debrisFrontM - a.debrisFrontM) * mix : 0 };
}

/** Clip whole road segments to the local scene; endpoints may both lie outside it. */
export function clipSceneRoad(points: XY[], reach: number): XY[][] {
  const out: XY[][] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    let lo = 0, hi = 1;
    let valid = true;
    for (const [p, q] of [[-dx, a[0] + reach], [dx, reach - a[0]], [-dy, a[1] + reach], [dy, reach - a[1]]]) {
      if (p === 0) { if (q < 0) valid = false; continue; }
      const r = q / p;
      if (p < 0) lo = Math.max(lo, r); else hi = Math.min(hi, r);
    }
    if (!valid || lo >= hi) continue;
    const start: XY = [a[0] + dx * lo, a[1] + dy * lo];
    const end: XY = [a[0] + dx * hi, a[1] + dy * hi];
    const prev = out[out.length - 1];
    if (prev && Math.hypot(prev[prev.length - 1][0] - start[0], prev[prev.length - 1][1] - start[1]) < 0.01) prev.push(end);
    else out.push([start, end]);
  }
  return out;
}

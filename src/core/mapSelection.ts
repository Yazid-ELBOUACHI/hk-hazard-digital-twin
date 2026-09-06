import type { Slope } from "./types";

/** Geometry-based camera target, independent of window size and floating panels. */
export function slopeCamera(slope: Slope, width: number, height: number) {
  let [west, south] = slope.centroid;
  let [east, north] = slope.centroid;
  for (const [lon, lat] of slope.polygon) {
    west = Math.min(west, lon); east = Math.max(east, lon);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  return {
    bounds: [[west, south], [east, north]] as [[number, number], [number, number]],
    options: {
      padding: Math.max(0, Math.min(80, width * 0.15, height * 0.15)),
      maxZoom: 19.5, pitch: 40, bearing: 0,
    },
  };
}

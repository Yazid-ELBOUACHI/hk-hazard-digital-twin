// Rain falling in 3D over the terrain: a deck.gl overlay of short vertical streaks, driven by the
// same mm/hr the top bar shows (HKO live when available, plus the storm scenario). The drops are
// synthetic; only the intensity is real. Nothing runs while it is dry or the view is zoomed out.

import { MapboxOverlay } from "@deck.gl/mapbox";
import { LineLayer } from "@deck.gl/layers";
import type maplibregl from "maplibre-gl";
import { useStore } from "@/state/store";

export interface Rain3d {
  setEnabled(on: boolean): void;
  setIntensity(mmHr: number): void;
  dispose(): void;
}

const MIN_ZOOM = 12.5; // further out the streaks are sub-pixel noise
const MAX_DROPS = 9000;
const CEILING_M = 420; // spawn height above the ground under each drop
const WIND_E_MS = 1.5;

export function attachRain3d(map: maplibregl.Map): Rain3d {
  // interleaved: drawn inside maplibre's own context — one canvas, depth-tested against buildings and terrain
  const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
  map.addControl(overlay as unknown as maplibregl.IControl);

  const src = new Float32Array(MAX_DROPS * 3);
  const tgt = new Float32Array(MAX_DROPS * 3);
  const vel = new Float32Array(MAX_DROPS);
  const ground = new Float32Array(MAX_DROPS);
  let enabled = false;
  let mmHr = 0;
  let count = 0;
  let raf = 0;
  let last = 0;
  let drawn = false;
  let west = 0, south = 0, east = 0, north = 0;

  const active = () => enabled && mmHr > 0 && map.getZoom() >= MIN_ZOOM && document.visibilityState === "visible";
  const streak = () => 4 + Math.min(mmHr, 40) * 0.2;

  const readBounds = () => {
    const b = map.getBounds();
    const mx = (b.getEast() - b.getWest()) * 0.1, my = (b.getNorth() - b.getSouth()) * 0.1;
    west = b.getWest() - mx; east = b.getEast() + mx; south = b.getSouth() - my; north = b.getNorth() + my;
  };

  const spawn = (i: number, fromTop: boolean) => {
    const lon = west + Math.random() * (east - west), lat = south + Math.random() * (north - south);
    const g = map.queryTerrainElevation({ lng: lon, lat }) ?? 0;
    const z = g + (fromTop ? CEILING_M * (0.85 + Math.random() * 0.15) : Math.random() * CEILING_M);
    const o = i * 3;
    src[o] = lon; src[o + 1] = lat; src[o + 2] = z;
    tgt[o] = lon; tgt[o + 1] = lat; tgt[o + 2] = z + streak();
    vel[i] = 7 + Math.random() * 4;
    ground[i] = g;
  };

  const clear = () => {
    if (!drawn) return;
    drawn = false;
    overlay.setProps({ layers: [] });
  };

  const frame = (t: number) => {
    raf = 0;
    if (!active()) {
      clear();
      return;
    }
    const dt = Math.min((t - last) / 1000, 0.05); // a tab returning from the background must not teleport the drops
    last = t;
    readBounds();
    const len = streak();
    const dLonPerM = 1 / (111_320 * Math.cos((((south + north) / 2) * Math.PI) / 180));
    for (let i = 0; i < count; i++) {
      const o = i * 3;
      const z = src[o + 2] - vel[i] * dt;
      const lon = src[o] + WIND_E_MS * dt * dLonPerM;
      if (z < ground[i] || lon < west || lon > east || src[o + 1] < south || src[o + 1] > north) {
        spawn(i, true);
        continue;
      }
      src[o] = lon; tgt[o] = lon;
      src[o + 2] = z; tgt[o + 2] = z + len;
    }
    const alpha = 110 + Math.min(mmHr, 40) * 3;
    const light = useStore.getState().basemap === "light";
    overlay.setProps({
      layers: [
        new LineLayer({
          id: "rain3d",
          // a fresh data object each frame is what tells deck the (in-place mutated) buffers changed
          data: { length: count, attributes: { getSourcePosition: { value: src, size: 3 }, getTargetPosition: { value: tgt, size: 3 } } },
          getColor: light ? [70, 100, 145, alpha] : [190, 215, 245, alpha], // must read on the pale positron basemap too
          getWidth: 1.5,
          widthUnits: "pixels",
          pickable: false,
        }),
      ],
    });
    drawn = true;
    raf = requestAnimationFrame(frame);
  };

  // listeners only schedule a frame; all real work (and anything that could throw) stays out of maplibre's event dispatch
  const sync = () => {
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };
  map.on("zoomend", sync);
  document.addEventListener("visibilitychange", sync);

  return {
    setEnabled(on) {
      enabled = on;
      sync();
    },
    setIntensity(v) {
      const next = Math.max(0, v);
      if (Math.abs(next - mmHr) < 0.05) return;
      mmHr = next;
      const c = mmHr <= 0 ? 0 : Math.min(MAX_DROPS, Math.max(400, Math.round(mmHr * 300)));
      if (c > count) {
        readBounds();
        for (let i = count; i < c; i++) spawn(i, false);
      }
      count = c;
      sync();
    },
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      map.off("zoomend", sync);
      document.removeEventListener("visibilitychange", sync);
      try {
        map.removeControl(overlay as unknown as maplibregl.IControl);
      } catch {
        /* map already removed */
      }
    },
  };
}

// One deck.gl overlay per map, shared by every 3D effect (rain, debris flow, …). Interleaved:
// deck draws inside maplibre's own WebGL context, so there is a single canvas and deck geometry
// depth-tests against the buildings and terrain. Each effect owns a named slot of layers.

import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer } from "@deck.gl/core";
import type maplibregl from "maplibre-gl";

export interface DeckSlots {
  setLayers(slot: string, layers: Layer[]): void;
  remove(slot: string): void;
}

const overlays = new WeakMap<maplibregl.Map, { overlay: MapboxOverlay; slots: Map<string, Layer[]> }>();

export function getDeckOverlay(map: maplibregl.Map): DeckSlots {
  let entry = overlays.get(map);
  if (!entry) {
    const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
    map.addControl(overlay as unknown as maplibregl.IControl);
    entry = { overlay, slots: new Map() };
    overlays.set(map, entry);
  }
  const e = entry;
  const flush = () => e.overlay.setProps({ layers: [...e.slots.values()].flat() });
  return {
    setLayers(slot, layers) {
      e.slots.set(slot, layers);
      flush();
    },
    remove(slot) {
      if (!e.slots.delete(slot)) return;
      flush();
    },
  };
}

export function disposeDeckOverlay(map: maplibregl.Map) {
  const entry = overlays.get(map);
  if (!entry) return;
  overlays.delete(map);
  try {
    map.removeControl(entry.overlay as unknown as maplibregl.IControl);
  } catch {
    /* map already removed */
  }
}

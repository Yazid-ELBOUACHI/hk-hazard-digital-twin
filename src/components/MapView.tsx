// 3D geospatial twin view. Real HK geography (basemap + AWS terrarium DEM, key-free public
// services); every overlay painted on top is synthetic.
//
// Two basemaps: a dark OpenFreeMap vector style (default, with 3D building extrusions) and
// Esri World Imagery. Switching styles keeps all twin sources/layers via `transformStyle`.

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { StyleSpecification, LayerSpecification } from "maplibre-gl";
import { useStore, BasemapId } from "@/state/store";
import { registry } from "@/core/registry";
import { HK_CENTER } from "@/mock/geo";
import { RISK_COLORS, Slope, RiskAssessment, RiskCategory, Asset, Incident, SimulationResult } from "@/core/types";
import { offsetM } from "@/mock/geo";
import { fetchSlopesInBbox, fetchBlackspots, fetchLandslides, fetchLpmWorks, fetchEntliInBbox, fetchRoadsInBbox } from "@/live/csdi";
import type { LiveRain } from "@/live/hko";
import { setMapInteracting, yieldForMap } from "@/core/schedule";
import { slopeCamera } from "@/core/mapSelection";
import { rainRateAt } from "@/mock/signals";
import type { Rain3d } from "@/map/rain3d";
import type { Debris3d } from "@/map/debris3d";
import { disposeDeckOverlay } from "@/map/deckOverlay";

const DARK_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
const LIGHT_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    basemap: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 18,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics · Terrain: Mapzen/AWS",
    },
    labels: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 18,
      attribution: "",
    },
    // the same OpenMapTiles vector source the vector basemaps use, so 3D building blocks stand on the imagery too
    openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#07090d" } },
    {
      id: "basemap",
      type: "raster",
      source: "basemap",
      paint: { "raster-opacity": 0.92, "raster-saturation": -0.35, "raster-brightness-max": 0.75, "raster-contrast": 0.08 },
    },
    { id: "labels", type: "raster", source: "labels", paint: { "raster-opacity": 0.85 } },
  ],
};

const DEM_TILES = ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"];

/** Layers that belong to the twin (kept across basemap switches). */
const OWN_SOURCE_IDS = [
  "dem", "dem-hillshade", "slopes", "slopes-blobs", "slopes-pts", "roads", "buildings", "drainage", "incidents", "sensors", "mitigated", "historical", "rainfall-pts", "flood",
  "runout", "runout-front", "selected", "csdi-slopes", "csdi-blackspots", "csdi-landslides",
  "csdi-lpm", "csdi-lpm-pts", "entli-grid", "csdi-entli-crowns", "csdi-entli-trails", "live-rain", "csdi-roads", "facilities-local", "building-blocks",
];
const OWN_LAYER_IDS = [
  "flood-fill", "flood-line", "rain-heat", "entli-grid-fill", "csdi-slopes-fill", "csdi-slopes-line", "csdi-lpm-fill", "csdi-lpm-line",
  "slopes-blobs-fill", "slopes-pt", "slopes-fill", "slopes-line", "uncertainty-fill", "csdi-roads-line", "roads-line",
  "building-blocks-pt", "facilities-local-pt", "buildings-pt", "drainage-pt", "mitigated-pt", "historical-pt", "sensors-pt", "incidents-pt", "csdi-landslides-pt", "csdi-blackspots-pt",
  "csdi-lpm-pt", "csdi-entli-trails-line", "csdi-entli-crowns-pt", "live-rain-pt",
  "runout-fill", "runout-line", "runout-front-pt", "selected-fill", "selected-halo", "selected-line",
];

/** Terrain relief tuned per basemap: soft grey shadows on the light map, deep shadows on dark/satellite. */
function hillshadeFor(b: BasemapId): LayerSpecification {
  const light = b === "light";
  return {
    id: "hillshade",
    type: "hillshade",
    // not terrain's "dem": sharing one source while terrain is toggled per drag can wedge maplibre's render queue
    source: "dem-hillshade",
    maxzoom: 14, // relief shading is invisible under buildings and costs a full pass per frame
    paint: light
      ? { "hillshade-exaggeration": 0.38, "hillshade-shadow-color": "#5d6878", "hillshade-highlight-color": "#ffffff", "hillshade-accent-color": "#c9d0da" }
      : { "hillshade-exaggeration": 0.55, "hillshade-shadow-color": "#05070b", "hillshade-highlight-color": "#6b7f9c", "hillshade-accent-color": "#1c2634" },
  };
}

/** 3D buildings from the OpenMapTiles `building` layer (vector basemaps only). */
function buildings3dFor(b: BasemapId): LayerSpecification {
  const light = b === "light";
  return {
    id: "buildings-3d",
    type: "fill-extrusion",
    source: "openmaptiles",
    "source-layer": "building",
    minzoom: 14,
    paint: {
      "fill-extrusion-color": light
        ? ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 12], 0, "#dfe3ea", 60, "#c6cdd8", 200, "#aab4c4"]
        : b === "satellite"
          ? ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 12], 0, "#b9b6ae", 60, "#a8a7a3", 200, "#96999f"] // concrete over imagery
          : ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 12], 0, "#232b38", 60, "#34405a", 200, "#4a5a80"],
      "fill-extrusion-height": ["coalesce", ["get", "render_height"], 12],
      "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      "fill-extrusion-opacity": 1, // opaque: translucent extrusions cost a second pass on every frame
    },
  };
}

function styleFor(b: BasemapId): string | StyleSpecification {
  return b === "dark" ? DARK_STYLE_URL : b === "light" ? LIGHT_STYLE_URL : SATELLITE_STYLE;
}

/** Vendor style tweaks so the basemap sits back and the risk colours lead. */
function tuneStyle(b: BasemapId, style: StyleSpecification): StyleSpecification {
  if (b === "satellite") return style;
  const layers = style.layers.map((l) => {
    if (b === "dark") {
      if (l.type === "background") return { ...l, paint: { ...(l.paint as object), "background-color": "#161d29" } } as LayerSpecification;
      if (l.id === "water") return { ...l, paint: { ...(l.paint as object), "fill-color": "#0b1a30" } } as LayerSpecification;
      if (l.type === "symbol") return { ...l, paint: { ...(l.paint as object), "text-opacity": 0.85 } } as LayerSpecification;
    } else {
      // positron: slightly bluer sea so coastlines read against the pale land
      if (l.id === "water") return { ...l, paint: { ...(l.paint as object), "fill-color": "#c3d3e2" } } as LayerSpecification;
    }
    return l;
  });
  return { ...style, layers };
}

/**
 * Static slope geometry + registration properties, uploaded to the map once. Risk colour, score and
 * confidence live in feature-state (applyRiskState) so a refresh touches only the slopes whose band
 * changed instead of re-uploading ~2 MB of GeoJSON.
 */
function slopeFC(slopes: Slope[]): any {
  return {
    type: "FeatureCollection",
    features: slopes.map((s) => ({
      type: "Feature",
      id: s.id,
      geometry: { type: "Polygon", coordinates: [s.polygon] },
      properties: {
        id: s.id,
        district: s.district,
        hasMit: s.mitigations.length > 0 ? 1 : 0,
        hasHist: s.history.some((e) => e.kind === "incident") ? 1 : 0,
      },
    })),
  };
}

// ---------- territory-zoom risk surface: soft patches per slope cluster, draped on the terrain ----------
// Registered slopes are 20–100 m features — invisible from a territory view. Below zoom 12.5 the map shows
// the worst risk band of each ~280 m cell as two overlapping octagons (an outer faint ring and an inner
// stronger one) so clusters merge into organic coloured hillsides instead of a field of dots.
const BLOB_LON = 0.0027, BLOB_LAT = 0.0025; // ≈ 280 m cells
const slopeCell = new Map<string, string>(); // slope id -> cell key
const cellSlopes = new Map<string, string[]>(); // cell key -> slope ids
const cellSig = new Map<string, string>();
const CAT_RANK: Record<RiskCategory, number> = { critical: 5, high: 4, elevated: 3, moderate: 2, low: 1, "no-data": 0 };

function octagon(c: [number, number], rM: number): [number, number][] {
  const kx = rM / (111_320 * Math.cos((c[1] * Math.PI) / 180)), ky = rM / 111_320;
  const ring: [number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    ring.push([c[0] + Math.cos(a) * kx, c[1] + Math.sin(a) * ky]);
  }
  ring.push(ring[0]);
  return ring;
}

function riskBlobFC(slopes: Slope[]): any {
  slopeCell.clear();
  cellSlopes.clear();
  const sum = new Map<string, [number, number]>();
  for (const s of slopes) {
    const key = `${Math.floor(s.centroid[0] / BLOB_LON)}:${Math.floor(s.centroid[1] / BLOB_LAT)}`;
    slopeCell.set(s.id, key);
    (cellSlopes.get(key) ?? cellSlopes.set(key, []).get(key)!).push(s.id);
    const a = sum.get(key) ?? [0, 0];
    a[0] += s.centroid[0]; a[1] += s.centroid[1];
    sum.set(key, a);
  }
  const features: any[] = [];
  for (const [key, ids] of cellSlopes) {
    const a = sum.get(key)!;
    const c: [number, number] = [a[0] / ids.length, a[1] / ids.length];
    const n = ids.length;
    // bigger clusters get slightly bigger patches; rings overlap with the neighbours so hillsides read as one surface
    const rOuter = 240 + Math.min(120, n * 12), rInner = 150 + Math.min(70, n * 7);
    features.push({ type: "Feature", id: `${key}|o`, geometry: { type: "Polygon", coordinates: [octagon(c, rOuter)] }, properties: { id: `${key}|o`, cell: key, ring: "o", n } });
    features.push({ type: "Feature", id: `${key}|i`, geometry: { type: "Polygon", coordinates: [octagon(c, rInner)] }, properties: { id: `${key}|i`, cell: key, ring: "i", n } });
  }
  return { type: "FeatureCollection", features };
}

/** After per-slope state is known, colour each cell by its worst visible band. */
function applyBlobState(map: maplibregl.Map, force = false) {
  if (!map.getSource("slopes-blobs")) return;
  if (force) cellSig.clear();
  for (const [key, ids] of cellSlopes) {
    let worst: RiskCategory = "no-data";
    let any = false;
    for (const id of ids) {
      const cat = riskCat.get(id);
      if (!cat || hiddenCats.has(cat)) continue;
      any = true;
      if (CAT_RANK[cat] > CAT_RANK[worst]) worst = cat;
    }
    const sig = any ? worst : "-";
    if (cellSig.get(key) === sig) continue;
    cellSig.set(key, sig);
    const state = { color: RISK_COLORS[worst], hidden: !any };
    map.setFeatureState({ source: "slopes-blobs", id: `${key}|o` }, state);
    map.setFeatureState({ source: "slopes-blobs", id: `${key}|i` }, state);
  }
}

// last applied risk state per slope ("cat|score|conf") and the category behind the legend filter
const riskSig = new Map<string, string>();
const riskCat = new Map<string, RiskCategory>();
let hiddenCats = new Set<string>();

/** Push risk colours into feature-state for the slopes whose assessment changed (all of them when `force`). */
const riskPasses = new WeakMap<maplibregl.Map, number>();
async function applyRiskState(map: maplibregl.Map, slopes: Slope[], assessments: Map<string, RiskAssessment>, stormMode: boolean, stormHorizonH: number, gameTime: number, force = false) {
  if (!map.getSource("slopes")) return;
  const pass = (riskPasses.get(map) ?? 0) + 1;
  riskPasses.set(map, pass);
  if (force) riskSig.clear();
  for (let i = 0; i < slopes.length; i++) {
    if (i % 64 === 0) {
      await yieldForMap();
      if (riskPasses.get(map) !== pass) return;
    }
    const s = slopes[i];
    const a = assessments.get(s.id);
    let score = a?.score ?? 0;
    let cat: RiskCategory = a?.category ?? "no-data";
    if (stormMode && a && s.hasData) {
      const p = registry.risk.projectScore(s, gameTime, stormHorizonH);
      score = p.score;
      cat = p.category;
    }
    const conf = a?.confidence ?? 0;
    const sig = `${cat}|${score}|${conf.toFixed(2)}`;
    if (riskSig.get(s.id) === sig) continue;
    riskSig.set(s.id, sig);
    riskCat.set(s.id, cat);
    const state = { cat, color: RISK_COLORS[cat], score, conf, hidden: hiddenCats.has(cat) };
    map.setFeatureState({ source: "slopes", id: s.id }, state);
    map.setFeatureState({ source: "slopes-pts", id: s.id }, state);
  }
  applyBlobState(map, force);
}

function centroidFC(slopes: Slope[], filter: (s: Slope) => boolean, props: (s: Slope) => any = () => ({})): any {
  return {
    type: "FeatureCollection",
    features: slopes.filter(filter).map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: s.centroid },
      properties: { id: s.id, ...props(s) },
    })),
  };
}

function assetFC(assets: Asset[], kinds: string[]): any {
  return {
    type: "FeatureCollection",
    features: assets
      .filter((a) => kinds.includes(a.kind))
      .map((a) => ({
        type: "Feature",
        geometry: a.line ? { type: "LineString", coordinates: a.line } : { type: "Point", coordinates: a.location },
        properties: { id: a.id, kind: a.kind, name: a.name, sub: a.sub ?? "", real: a.real ? 1 : 0, height: a.heightM ?? 0 },
      })),
  };
}

function incidentFC(incidents: Incident[]): any {
  return {
    type: "FeatureCollection",
    features: incidents.map((i) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: i.location },
      properties: { id: i.id, kind: i.kind, severity: i.severity },
    })),
  };
}

const EMPTY_FC: any = { type: "FeatureCollection", features: [] };

/** HKO rain-gauge stations with their latest past-hour reading (REAL). */
function liveRainFC(live: LiveRain | null): any {
  if (!live) return EMPTY_FC;
  return {
    type: "FeatureCollection",
    features: live.stations.map((st) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [st.lon, st.lat] },
      properties: { id: st.id, name: st.name, mmHr: st.mmHr, mm24: st.mm24 ?? -1, hoursCounted: st.hoursCounted ?? 0, obsTime: live.obsTime },
    })),
  };
}

/** Centroid points of a polygon collection (low-zoom representation of small polygons). */
function polygonCentroidFC(fc: any): any {
  return {
    type: "FeatureCollection",
    features: fc.features
      .map((f: any) => {
        const ring: number[][] | undefined = f.geometry?.type === "Polygon" ? f.geometry.coordinates[0] : f.geometry?.type === "MultiPolygon" ? f.geometry.coordinates[0]?.[0] : undefined;
        if (!ring?.length) return null;
        let x = 0, y = 0;
        for (const v of ring) { x += v[0]; y += v[1]; }
        return { type: "Feature", geometry: { type: "Point", coordinates: [x / ring.length, y / ring.length] }, properties: f.properties };
      })
      .filter(Boolean),
  };
}

/** Centroid version of the slope collection, carrying the same colour/category properties. */
function slopePointFC(polyFC: any, slopes: Slope[]): any {
  const byId = new Map(slopes.map((s) => [s.id, s.centroid]));
  return {
    type: "FeatureCollection",
    features: polyFC.features.map((f: any) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: byId.get(f.properties.id) },
      properties: f.properties,
    })),
  };
}

/** Add terrain sources, hillshade (+3D buildings on vector basemaps) and every twin source/layer. */
function mountOwnLayers(map: maplibregl.Map) {
  const st = useStore.getState();

  map.addSource("dem", { type: "raster-dem", tiles: DEM_TILES, encoding: "terrarium", tileSize: 256, maxzoom: 13 });
  map.addSource("dem-hillshade", { type: "raster-dem", tiles: DEM_TILES, encoding: "terrarium", tileSize: 256, maxzoom: 13 });
  if (st.map3d) map.setTerrain({ source: "dem", exaggeration: 1.5 });

  // basemap-relative anchors: relief and 3D buildings sit under labels
  const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
  map.addLayer(hillshadeFor(st.basemap), firstSymbol);
  if (map.getSource("openmaptiles")) map.addLayer(buildings3dFor(st.basemap), firstSymbol);
  setBasemapBuildingFills(map, !st.map3d);
  applyMapMode(map, st.map3d);

  const slopesFc = slopeFC(st.slopes);
  map.addSource("slopes", { type: "geojson", promoteId: "id", data: slopesFc });
  map.addSource("slopes-pts", { type: "geojson", promoteId: "id", data: slopePointFC(slopesFc, st.slopes) });
  map.addSource("slopes-blobs", { type: "geojson", promoteId: "id", data: riskBlobFC(st.slopes) });
  // real road centrelines come from LandsD per viewport (csdi-roads); the asset table only keeps each slope's nearest road
  map.addSource("roads", { type: "geojson", data: assetFC(st.assets, ["emergency-route"]) });
  map.addSource("csdi-roads", { type: "geojson", data: EMPTY_FC });
  // exposure points in three sources so MapLibre only loads/draws each class from its own zoom
  map.addSource("buildings", { type: "geojson", data: assetFC(st.assets, ["hospital", "fire-station", "police", "railway"]) });
  map.addSource("facilities-local", { type: "geojson", data: assetFC(st.assets, ["school", "kindergarten", "clinic"]) });
  map.addSource("building-blocks", { type: "geojson", data: assetFC(st.assets, ["building"]) });
  map.addSource("drainage", { type: "geojson", data: assetFC(st.assets, ["drainage", "utility"]) });
  map.addSource("incidents", { type: "geojson", data: incidentFC(st.incidents) });
  map.addSource("sensors", { type: "geojson", data: centroidFC(st.slopes, (s) => s.sensors.length > 0, (s) => ({ n: s.sensors.length })) });
  map.addSource("mitigated", { type: "geojson", data: centroidFC(st.slopes, (s) => s.mitigations.length > 0) });
  map.addSource("historical", { type: "geojson", data: centroidFC(st.slopes, (s) => s.history.some((e) => e.kind === "incident")) });
  map.addSource("rainfall-pts", {
    type: "geojson",
    data: centroidFC(st.slopes, () => true, (s) => ({ w: registry.weather.regionalFactor(s.centroid[0], s.centroid[1]) })),
  });
  map.addSource("flood", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: st.assets
        .filter((a) => a.kind === "drainage")
        .map((a) => ({
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              Array.from({ length: 17 }, (_, i) => {
                const ang = (i / 16) * Math.PI * 2;
                return offsetM(a.location, Math.cos(ang) * 260, Math.sin(ang) * 200);
              }),
            ],
          },
          properties: { id: a.id },
        })),
    },
  });
  map.addSource("runout", { type: "geojson", data: EMPTY_FC });
  map.addSource("runout-front", { type: "geojson", data: EMPTY_FC });
  map.addSource("selected", { type: "geojson", data: EMPTY_FC });

  // live CSDI sources (real HK government data, loaded on demand)
  map.addSource("csdi-slopes", { type: "geojson", data: EMPTY_FC });
  map.addSource("csdi-blackspots", { type: "geojson", data: EMPTY_FC });
  map.addSource("csdi-landslides", { type: "geojson", data: EMPTY_FC });
  map.addSource("csdi-lpm", { type: "geojson", data: EMPTY_FC });
  map.addSource("csdi-lpm-pts", { type: "geojson", data: EMPTY_FC });
  map.addSource("entli-grid", { type: "geojson", data: EMPTY_FC });
  map.addSource("csdi-entli-crowns", { type: "geojson", data: EMPTY_FC });
  map.addSource("csdi-entli-trails", { type: "geojson", data: EMPTY_FC });
  map.addSource("live-rain", { type: "geojson", data: liveRainFC(st.liveRain) });

  map.addLayer({ id: "flood-fill", type: "fill", source: "flood", layout: { visibility: "none" }, paint: { "fill-color": "#2470c2", "fill-opacity": 0.22 } });
  map.addLayer({ id: "flood-line", type: "line", source: "flood", layout: { visibility: "none" }, paint: { "line-color": "#3d8bfd", "line-opacity": 0.5, "line-dasharray": [2, 2] } });

  // ENTLI landslide density (baked 250 m grid) — territory-wide picture far out; live crowns take over at zoom 12
  map.addLayer({
    id: "entli-grid-fill", type: "fill", source: "entli-grid", layout: { visibility: "none" }, maxzoom: 13.5,
    paint: {
      "fill-color": ["interpolate", ["linear"], ["get", "d"], 1, "#f7dcc3", 4, "#f2a25f", 12, "#df5a2b", 30, "#8e1d12"],
      "fill-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0.6, 13.5, 0.15],
    },
  });

  // CEDD registered man-made slopes — real catalogue polygons, drawn under the synthetic risk layers
  map.addLayer({
    id: "csdi-slopes-fill", type: "fill", source: "csdi-slopes", layout: { visibility: "none" },
    paint: { "fill-color": "#18b8a6", "fill-opacity": 0.16 },
  });
  map.addLayer({
    id: "csdi-slopes-line", type: "line", source: "csdi-slopes", layout: { visibility: "none" },
    paint: { "line-color": "#18b8a6", "line-opacity": 0.8, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.6, 16, 1.6] },
  });

  // CEDD LPMitP works programme — real polygons of slopes (amber) and hillside catchments (gold) under upgrading contracts
  const lpmColor: any = ["match", ["get", "kind"], "catchment", "#c9a227", "#e8862e"];
  map.addLayer({
    id: "csdi-lpm-fill", type: "fill", source: "csdi-lpm", layout: { visibility: "none" },
    paint: { "fill-color": lpmColor, "fill-opacity": 0.35 },
  });
  map.addLayer({
    id: "csdi-lpm-line", type: "line", source: "csdi-lpm", layout: { visibility: "none" },
    paint: { "line-color": lpmColor, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 15, 2.2], "line-opacity": 0.95 },
  });

  map.addLayer({
    id: "rain-heat", type: "heatmap", source: "rainfall-pts", layout: { visibility: "none" },
    paint: {
      "heatmap-weight": ["get", "w"],
      "heatmap-radius": 46,
      "heatmap-intensity": 0.75,
      "heatmap-opacity": 0.5,
      "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,60,0)", 0.4, "rgba(40,90,200,0.5)", 0.7, "rgba(50,140,255,0.7)", 1, "rgba(140,200,255,0.9)"],
    },
  });

  // Risk colour/score/confidence come from feature-state; `hidden` implements the legend filter.
  const stateColor: any = ["coalesce", ["feature-state", "color"], RISK_COLORS["no-data"]];
  const shown: any = ["case", ["boolean", ["feature-state", "hidden"], false], 0, 1];
  // Far out, individual slope features are sub-pixel: show the risk surface (soft patches per cluster, draped on the
  // terrain) until zoom 12.5, then hand over to the true polygons (drawn from zoom 11.5 so the two cross-fade).
  map.addLayer({
    id: "slopes-blobs-fill", type: "fill", source: "slopes-blobs", maxzoom: 12.5,
    paint: {
      "fill-color": stateColor,
      "fill-antialias": false,
      "fill-opacity": ["interpolate", ["linear"], ["zoom"], 8, ["*", shown, ["match", ["get", "ring"], "o", 0.3, 0.62]], 11.5, ["*", shown, ["match", ["get", "ring"], "o", 0.3, 0.62]], 12.5, 0],
    },
  });
  // invisible hit targets so a click on a cluster still opens its most at-risk slope
  map.addLayer({
    id: "slopes-pt", type: "circle", source: "slopes-pts", maxzoom: 12.5,
    paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 5, 12.5, 8], "circle-opacity": 0, "circle-stroke-width": 0 },
  });
  map.addLayer({
    id: "slopes-fill", type: "fill", source: "slopes", minzoom: 11.5,
    paint: { "fill-color": stateColor, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 11.5, ["*", shown, 0.2], 12.5, ["*", shown, 0.62], 15, ["*", shown, 0.5]] },
  });
  map.addLayer({
    id: "slopes-line", type: "line", source: "slopes", minzoom: 11.5,
    paint: { "line-color": stateColor, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.8, 15, 1.8], "line-opacity": ["*", shown, 0.95] },
  });
  map.addLayer({
    id: "uncertainty-fill", type: "fill", source: "slopes", layout: { visibility: "none" },
    paint: {
      "fill-color": ["interpolate", ["linear"], ["coalesce", ["feature-state", "conf"], 0.9], 0.2, "rgba(186,85,255,0.75)", 0.55, "rgba(186,85,255,0.35)", 0.9, "rgba(186,85,255,0.04)"],
      "fill-opacity": shown,
    },
  });

  // LandsD road centrelines (live, zoom ≥ 13): width by street class
  map.addLayer({
    id: "csdi-roads-line", type: "line", source: "csdi-roads", minzoom: 13,
    paint: {
      "line-color": ["match", ["get", "STREETTYPE"], "Expressway", "#ff9f0a", "Trunk Road", "#ffb84d", "Primary Road", "#6ea8ff", "#5b7ea8"],
      "line-width": ["match", ["get", "STREETTYPE"], "Expressway", 3, "Trunk Road", 2.4, "Primary Road", 2, 1.3],
      "line-opacity": 0.8,
    },
  }, "slopes-pt");
  map.addLayer({
    id: "roads-line", type: "line", source: "roads",
    paint: { "line-color": "#5b7ea8", "line-width": 1.6, "line-opacity": 0.75 },
  }, "slopes-pt");
  map.addLayer({
    id: "buildings-pt", type: "circle", source: "buildings", minzoom: 12,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, ["match", ["get", "kind"], "hospital", 3.5, "fire-station", 3.2, "police", 3, "school", 2.5, "clinic", 2.2, 1.8], 14, ["match", ["get", "kind"], "hospital", 7, "fire-station", 6.5, "police", 6, "school", 5.5, "clinic", 5, 4]],
      "circle-color": ["match", ["get", "kind"], "hospital", "#e56db1", "fire-station", "#ff6b3d", "police", "#b9a9f5", "railway", "#9a86e8", "#8fa2ba"],
      "circle-opacity": 0.9, "circle-stroke-width": 1, "circle-stroke-color": "#0c1017",
    },
  }, "slopes-pt"); // beneath the slope layers: exposure context, not the subject
  // schools / kindergartens / clinics from zoom 12, LandsD building blocks from zoom 13 — separate sources, so nothing is
  // uploaded or drawn below those zooms (the 16k points would otherwise cost every 3D frame)
  map.addLayer({
    id: "facilities-local-pt", type: "circle", source: "facilities-local", minzoom: 12,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, ["match", ["get", "kind"], "school", 2.5, "clinic", 2.2, 1.8], 14, ["match", ["get", "kind"], "school", 5.5, "clinic", 5, 4]],
      "circle-color": ["match", ["get", "kind"], "school", "#7db4ff", "kindergarten", "#9ec5ff", "#66d4cf"],
      "circle-opacity": 0.9, "circle-stroke-width": 1, "circle-stroke-color": "#0c1017",
    },
  }, "slopes-pt");
  map.addLayer({
    id: "building-blocks-pt", type: "circle", source: "building-blocks", minzoom: 13,
    paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 2, 16, 4.5], "circle-color": "#8fa2ba", "circle-opacity": 0.85, "circle-stroke-width": 1, "circle-stroke-color": "#0c1017" },
  }, "slopes-pt");
  map.addLayer({
    id: "drainage-pt", type: "circle", source: "drainage", layout: { visibility: "none" },
    paint: { "circle-radius": 3.5, "circle-color": "#38b6d8", "circle-opacity": 0.85 },
  });
  map.addLayer({
    id: "mitigated-pt", type: "circle", source: "mitigated", layout: { visibility: "none" },
    paint: { "circle-radius": 3.5, "circle-color": "#43d19a", "circle-stroke-width": 1, "circle-stroke-color": "#0c1017" },
  });
  map.addLayer({
    id: "historical-pt", type: "circle", source: "historical", layout: { visibility: "none" },
    paint: { "circle-radius": 4, "circle-color": "#71241c", "circle-stroke-width": 1.5, "circle-stroke-color": "#e04a3a" },
  });
  map.addLayer({
    id: "sensors-pt", type: "circle", source: "sensors", layout: { visibility: "none" },
    paint: { "circle-radius": 2.6, "circle-color": "#ffd76b", "circle-opacity": 0.9 },
  });
  map.addLayer({
    id: "incidents-pt", type: "circle", source: "incidents",
    paint: {
      "circle-radius": ["*", ["get", "severity"], 4],
      "circle-color": "#ff3b2a", "circle-opacity": 0.35,
      "circle-stroke-width": 2, "circle-stroke-color": "#ff6b5b",
    },
  });

  // CEDD landslide incident history — ~11k real points, small warm dots
  map.addLayer({
    id: "csdi-landslides-pt", type: "circle", source: "csdi-landslides", layout: { visibility: "none" },
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 1.4, 13, 3, 16, 5],
      "circle-color": "#ff9d42", "circle-opacity": 0.55,
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 12, 0, 14, 0.8], "circle-stroke-color": "#b55b12",
    },
  });
  // DSD flooding blackspots — few points, drawn prominent
  map.addLayer({
    id: "csdi-blackspots-pt", type: "circle", source: "csdi-blackspots", layout: { visibility: "none" },
    paint: {
      "circle-radius": 8, "circle-color": "#2470c2", "circle-opacity": 0.45,
      "circle-stroke-width": 2.5, "circle-stroke-color": "#63b3ff",
    },
  });

  // LPM works as points far out (the polygons are sub-pixel below zoom ~13)
  map.addLayer({
    id: "csdi-lpm-pt", type: "circle", source: "csdi-lpm-pts", layout: { visibility: "none" }, maxzoom: 13,
    paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3, 13, 6], "circle-color": lpmColor, "circle-opacity": 0.9, "circle-stroke-width": 1, "circle-stroke-color": "#3a2408" },
  });
  // ENTLI runout trails and crowns (live, viewport-scoped, zoom ≥ 12): rust = dated recent, tan = relict
  const entliColor: any = ["match", ["get", "SLIDE_TYPE"], "R", "#b08968", "#df5a2b"];
  map.addLayer({
    id: "csdi-entli-trails-line", type: "line", source: "csdi-entli-trails", layout: { visibility: "none" },
    paint: { "line-color": entliColor, "line-width": ["interpolate", ["linear"], ["zoom"], 13, 0.8, 16, 2], "line-opacity": 0.8 },
  });
  map.addLayer({
    id: "csdi-entli-crowns-pt", type: "circle", source: "csdi-entli-crowns", layout: { visibility: "none" },
    paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 2, 16, 4.5], "circle-color": entliColor, "circle-opacity": 0.85, "circle-stroke-width": 0.6, "circle-stroke-color": "#2b1a10" },
  });
  // HKO rain-gauge stations: radius and colour follow the past-hour reading
  map.addLayer({
    id: "live-rain-pt", type: "circle", source: "live-rain", layout: { visibility: "none" },
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["get", "mmHr"], 0, 5, 10, 10, 40, 18, 100, 26],
      "circle-color": ["interpolate", ["linear"], ["get", "mmHr"], 0, "#9ec5ff", 10, "#3d8bfd", 30, "#1d4fd6", 70, "#4b0fa8"],
      "circle-opacity": 0.55, "circle-stroke-width": 1.5, "circle-stroke-color": "#dbe9ff",
    },
  });

  map.addLayer({
    id: "runout-fill", type: "fill", source: "runout",
    paint: { "fill-color": "#a0522d", "fill-opacity": 0.6 },
  });
  map.addLayer({
    id: "runout-line", type: "line", source: "runout",
    paint: { "line-color": "#ff8c42", "line-width": 2 },
  });
  map.addLayer({
    id: "runout-front-pt", type: "circle", source: "runout-front",
    paint: { "circle-radius": 7, "circle-color": "#ff5a2a", "circle-blur": 0.4, "circle-stroke-width": 2, "circle-stroke-color": "#ffd76b" },
  });

  // Selection stays visible even when risk layers/classes are switched off.
  map.addLayer({ id: "selected-fill", type: "fill", source: "selected", paint: { "fill-color": "#00d9ff", "fill-opacity": 0.28 } });
  map.addLayer({ id: "selected-halo", type: "line", source: "selected", paint: { "line-color": "#072333", "line-width": 7 } });
  map.addLayer({ id: "selected-line", type: "line", source: "selected", paint: { "line-color": "#5cecff", "line-width": 3 } });
  void applyRiskState(map, st.slopes, st.assessments, st.stormMode, st.stormHorizonH, st.gameTime, true);
}

function showSelection(map: maplibregl.Map, slope: Slope | undefined) {
  const src = map.getSource("selected") as maplibregl.GeoJSONSource | undefined;
  src?.setData(slope ? {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [slope.polygon] }, properties: { id: slope.id } }],
  } : EMPTY_FC);
}

/** Fit actual geometry in the map's own viewport; the inspector has its own layout space. */
function focusSlope(map: maplibregl.Map, slope: Slope, duration = 550) {
  map.resize();
  const { bounds, options } = slopeCamera(slope, map.getContainer().clientWidth, map.getContainer().clientHeight);
  map.fitBounds(bounds, { ...options, pitch: useStore.getState().map3d ? 40 : 0, duration });
}

/** The vector basemap's flat building fills are redundant (and a draw pass) under our 3D extrusions. */
function setBasemapBuildingFills(map: maplibregl.Map, visible: boolean) {
  for (const l of map.getStyle()?.layers ?? []) {
    if (l.id === "buildings-3d") continue;
    if ((l as any)["source-layer"] === "building" && map.getLayer(l.id)) map.setLayoutProperty(l.id, "visibility", visible ? "visible" : "none");
  }
}

function applyMapMode(map: maplibregl.Map, enabled: boolean) {
  setBasemapBuildingFills(map, !enabled);
  // integrated GPUs: 3D terrain at 1× is the difference between 30 and 55 fps. Only touch it when it differs —
  // setPixelRatio resizes the map, and a resize cancels whatever camera ease is in flight.
  if (map.getPixelRatio() !== 1) map.setPixelRatio(1);
  map.setTerrain(enabled ? { source: "dem", exaggeration: 1.5 } : null);
  if (map.getLayer("hillshade")) map.setLayoutProperty("hillshade", "visibility", enabled ? "visible" : "none");
  if (map.getLayer("buildings-3d")) map.setLayoutProperty("buildings-3d", "visibility", enabled && useStore.getState().layers.buildings ? "visible" : "none");
}

/**
 * maplibre's render task queue (camera ease frames + input handler frames) never resets its
 * "running" flag when a task throws, so one exception anywhere in that path makes every redraw after
 * it throw "Attempting to run(), but is already running" — the map goes black and stays black.
 * Wrap each queued task so a throw is logged with its stack and the queue keeps running.
 */
function armRenderQueueRecovery(map: maplibregl.Map) {
  const queue = (map as any)._renderTaskQueue;
  if (!queue || queue.__recoveryArmed) return;
  queue.__recoveryArmed = true;
  const add = queue.add.bind(queue);
  queue.add = (task: (ts: number) => void) =>
    add((ts: number) => {
      try {
        task(ts);
      } catch (err) {
        console.error("map render task threw (recovered, frame dropped):", err);
      }
    });
}

export default function MapView() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const selectionMarkerRef = useRef<maplibregl.Marker | null>(null);
  const lastRunoutRef = useRef<{ result: typeof simResult; frame: number } | null>(null);
  const basemapRef = useRef<BasemapId>(useStore.getState().basemap);
  const rain3dRef = useRef<Rain3d | null>(null);
  const debris3dRef = useRef<Debris3d | null>(null);
  const sim3dResultRef = useRef<SimulationResult | null>(null);
  const sim3dLastTRef = useRef(0);

  const slopes = useStore((s) => s.slopes);
  const assets = useStore((s) => s.assets);
  const incidents = useStore((s) => s.incidents);
  const assessments = useStore((s) => s.assessments);
  const layers = useStore((s) => s.layers);
  const stormMode = useStore((s) => s.stormMode);
  const stormHorizonH = useStore((s) => s.stormHorizonH);
  const flyTo = useStore((s) => s.flyTo);
  const commandCenterOpen = useStore((s) => s.commandCenterOpen);
  const selectedSlopeId = useStore((s) => s.selectedSlopeId);
  const simResult = useStore((s) => s.simResult);
  const animTimeSec = useStore((s) => s.animTimeSec);
  const riskFilter = useStore((s) => s.riskFilter);
  const viewCmd = useStore((s) => s.viewCmd);
  const basemap = useStore((s) => s.basemap);
  const liveRain = useStore((s) => s.liveRain);
  const mapLoaded = useStore((s) => s.mapLoaded);
  const map3d = useStore((s) => s.map3d);
  const sim3dActive = useStore((s) => s.sim3dActive);

  // ---- init map ----
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const container = containerRef.current;
    const initial = useStore.getState().basemap;
    let cancelled = false;
    let viewportTimer: ReturnType<typeof setTimeout> | undefined;
    let resizeFrame = 0;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => mapRef.current?.resize());
    });
    resizeObserver.observe(container);

    // the 3D rain follows the same intensity the top bar shows; only re-tell it on a real change
    let lastRain = -1;
    const unsubRain = useStore.subscribe((s) => {
      const rate = Math.round(rainRateAt(s.gameTime) * 10) / 10;
      if (rate === lastRain) return;
      lastRain = rate;
      rain3dRef.current?.setIntensity(rate);
    });

    // The dark basemap is tuned (navy water, dimmer labels) before the map is created,
    // so fetch its style JSON first; satellite is a local style object.
    const initialStyle: Promise<StyleSpecification> =
      initial === "satellite"
        ? Promise.resolve(SATELLITE_STYLE)
        : fetch(styleFor(initial) as string)
            .then((r) => r.json() as Promise<StyleSpecification>)
            .then((s) => tuneStyle(initial, s))
            .catch(() => SATELLITE_STYLE);

    void initialStyle.then((style) => {
      if (cancelled || mapRef.current) return;
      // first view: close on Central / Mid-Levels — the CBD with the registered slopes on the hillside behind it
      const map = new maplibregl.Map({
        container,
        style,
        center: [114.158, 22.28],
        zoom: 14.6,
        pitch: useStore.getState().map3d ? 56 : 0,
        bearing: -24,
        maxPitch: 62, // beyond this the horizon pulls in far more terrain-draped tiles than the view is worth
        maxZoom: 17.5, // beyond this the camera dips under the exaggerated terrain and the frame goes black
        minZoom: 9, // this is a Hong Kong twin, not a world map — never let the view (or an accidental scroll) leave the territory
        maxBounds: [
          [113.7, 22.05],
          [114.55, 22.65],
        ], // HK territory + a margin; keeps every pan/tile-load inside the one region this app has data for
        pixelRatio: 1,
        renderWorldCopies: false,
        fadeDuration: 0,
        cancelPendingTileRequestsWhileZooming: true,
        attributionControl: false, // credits live in the caption under the toolbar (App.tsx), not on the map
      });
      mapRef.current = map;
      (window as any).__twinMap = map; // dev diagnostics (Data Sources / console)
      armRenderQueueRecovery(map);
      map.on("error", (e) => console.error("maplibre:", (e as any)?.error ?? e));
      wireMap(map);
    });

    const wireMap = (map: maplibregl.Map) => {
    map.on("movestart", () => {
      setMapInteracting(true);
      clearTimeout(viewportTimer);
      popupRef.current?.remove();
      container.closest(".main")?.classList.add("map-moving");
    });
    map.on("moveend", () => {
      setMapInteracting(false);
      container.closest(".main")?.classList.remove("map-moving");
    });
    // some vendor style layers reference sprite patterns we do not ship; provide a blank pixel instead of a warning
    map.on("styleimagemissing", (e) => {
      if (!map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    map.on("load", () => {
      try {
      csdiSlopesState.bbox = null;
      csdiSlopesState.seq++;
      entliState.bbox = null;
      entliState.seq++;
      mountOwnLayers(map);
      void import("@/map/rain3d").then(({ attachRain3d }) => {
        if (cancelled || mapRef.current !== map) return;
        const rain = attachRain3d(map);
        rain3dRef.current = rain;
        const s = useStore.getState();
        rain.setEnabled(s.layers.rain3d && s.map3d);
        rain.setIntensity(rainRateAt(s.gameTime));
      });
      void import("@/map/debris3d").then(({ attachDebris3d }) => {
        if (cancelled || mapRef.current !== map) return;
        const debris = attachDebris3d(map, (i) => useStore.getState().setSim3dImpact(i));
        debris3dRef.current = debris;
        // a playback that was running when the map was rebuilt (basemap switch, hot reload) carries on
        const s = useStore.getState();
        if (s.sim3dActive && s.simResult?.failureLikely && s.map3d) {
          sim3dResultRef.current = s.simResult;
          debris.show(s.simResult, s.slopes.find((sl) => sl.id === s.simResult!.slopeId));
          debris.setTime(s.animTimeSec);
          rain3dRef.current?.setOverride(s.simResult.params.rainfallMm / Math.max(1, s.simResult.params.rainfallDurationH));
        }
      });

      // interactions
      map.on("click", "slopes-fill", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const id = f.properties?.id as string;
        useStore.getState().selectSlope(id);
        useStore.getState().flyToSlope(id);
      });
      map.on("click", "slopes-blobs-fill", (e) => {
        const cell = e.features?.[0]?.properties?.cell as string | undefined;
        const ids = cell ? cellSlopes.get(cell) : undefined;
        if (!ids?.length) return;
        const st = useStore.getState();
        const best = ids.reduce((b, id) => ((st.assessments.get(id)?.score ?? -1) > (st.assessments.get(b)?.score ?? -1) ? id : b), ids[0]);
        st.selectSlope(best);
        st.flyToSlope(best);
      });
      map.on("mousemove", "slopes-blobs-fill", (e) => {
        if (map.isMoving()) return;
        const f = e.features?.[0];
        if (!f) return;
        map.getCanvas().style.cursor = "pointer";
        const n = f.properties?.n ?? 0;
        popupRef.current ??= new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
        popupRef.current
          .setLngLat(e.lngLat)
          .setHTML(`<div style="font-weight:600">${n} registered slope${n === 1 ? "" : "s"} here</div><div style="color:#6d7a8c;font-size:10px">coloured by the worst current band · click to open the highest-risk one · zoom in for individual slopes</div>`)
          .addTo(map);
      });
      map.on("mouseleave", "slopes-blobs-fill", () => {
        map.getCanvas().style.cursor = "";
        popupRef.current?.remove();
      });
      map.on("click", "slopes-pt", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const id = f.properties?.id as string;
        useStore.getState().selectSlope(id);
        useStore.getState().flyToSlope(id);
      });
      for (const hoverLayer of ["slopes-fill", "slopes-pt"]) map.on("mousemove", hoverLayer, (e) => {
        if (map.isMoving()) return;
        map.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as any;
        const st = ((f as any).state ?? {}) as { cat?: string; color?: string; score?: number; conf?: number };
        if (!popupRef.current) {
          popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
        }
        popupRef.current
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-family:var(--mono);font-weight:600">${p.id}</div>` +
              `<div style="color:${st.color ?? "#7c8794"};font-weight:700;text-transform:uppercase;font-size:10px;letter-spacing:1px">${st.cat ?? "no-data"} · ${st.score ?? 0}/100</div>` +
              `<div style="color:#6d7a8c;font-size:10px">${p.district} · confidence ${Math.round((st.conf ?? 0) * 100)}% · synthetic risk · CEDD geometry</div>`
          )
          .addTo(map);
      });
      for (const hoverLayer of ["slopes-fill", "slopes-pt"]) map.on("mouseleave", hoverLayer, () => {
        map.getCanvas().style.cursor = "";
        popupRef.current?.remove();
      });

      // asset + incident markers: explain what the dot is
      const KIND_LABEL: Record<string, string> = {
        hospital: "Hospital",
        school: "School",
        kindergarten: "Kindergarten",
        clinic: "Clinic",
        "fire-station": "Fire station",
        police: "Police station",
        railway: "Rail segment",
        building: "Building block",
        landslide: "Landslide",
        rockfall: "Rockfall",
        "debris-flow": "Debris flow",
        "road-blockage": "Road blockage",
        flooding: "Flooding",
      };
      for (const layerId of ["buildings-pt", "facilities-local-pt", "building-blocks-pt", "incidents-pt"]) {
        map.on("mousemove", layerId, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          map.getCanvas().style.cursor = "pointer";
          const p = f.properties as any;
          if (!popupRef.current) popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
          const label = KIND_LABEL[p.kind] ?? p.kind;
          const isIncident = layerId === "incidents-pt";
          const title = isIncident ? `${label} · severity ${p.severity}` : String(p.name ?? label);
          const sub = isIncident ? `active incident · ${p.id} · synthetic` : `${label}${p.sub ? ` · ${p.sub}` : ""}${p.height ? ` · ${p.height} m` : ""}`;
          const foot = isIncident ? "" : p.real ? `<div style="color:#18a08f;font-size:9px;letter-spacing:0.6px;font-weight:700">REAL · ${p.kind === "building" ? "LandsD" : "CSDI"} open data</div>` : `<div style="color:#6d7a8c;font-size:9px">synthetic</div>`;
          popupRef.current
            .setLngLat(e.lngLat)
            .setHTML(`<div style="font-weight:600">${title}</div><div style="color:#6d7a8c;font-size:10px">${sub}</div>${foot}`)
            .addTo(map);
        });
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
          popupRef.current?.remove();
        });
      }

      // live CSDI layers: popups, viewport-scoped slope loading, initial sync
      wireCsdiPopups(map, () => {
        popupRef.current ??= new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
        return popupRef.current;
      });
      map.on("moveend", () => {
        if (cancelled) return;
        clearTimeout(viewportTimer);
        viewportTimer = setTimeout(() => {
          refreshCsdiSlopes(map);
          refreshEntli(map);
          refreshRoads(map);
        }, 180);
      });
      syncCsdiData(map, useStore.getState().layers);

      loadedRef.current = true;
      applyVisibility(map, useStore.getState().layers);
      applyRiskFilter(map, useStore.getState().riskFilter);
      const state = useStore.getState();
      showSelection(map, state.slopes.find((s) => s.id === state.selectedSlopeId));
      useStore.getState().setMapLoaded(true);
      } catch (err) {
        // never leave the app stuck on "Loading terrain…": surface the failure and carry on
        console.error("Map layers failed to mount:", err);
        (window as any).__twinMapError = String((err as Error)?.stack ?? err);
        loadedRef.current = true;
        useStore.getState().setMapLoaded(true);
      }
    });
    };

    return () => {
      cancelled = true;
      csdiSlopesState.seq++;
      entliState.seq++;
      resizeObserver.disconnect();
      cancelAnimationFrame(resizeFrame);
      clearTimeout(viewportTimer);
      setMapInteracting(false);
      if (mapRef.current) riskPasses.set(mapRef.current, -1);
      selectionMarkerRef.current?.remove();
      selectionMarkerRef.current = null;
      popupRef.current?.remove();
      loadedRef.current = false;
      useStore.getState().setMapLoaded(false);
      unsubRain();
      rain3dRef.current?.dispose();
      rain3dRef.current = null;
      debris3dRef.current?.dispose();
      debris3dRef.current = null;
      if (mapRef.current) disposeDeckOverlay(mapRef.current);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // ---- basemap switch: swap the base style, keep every twin source/layer and the terrain ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || basemapRef.current === basemap) return;
    basemapRef.current = basemap;
    riskPasses.set(map, -1);
    map.setStyle(styleFor(basemap), {
      transformStyle: (prev, nextRaw) => {
        const next = tuneStyle(basemap, nextRaw);
        const prevSources = prev?.sources ?? {};
        const prevLayers = prev?.layers ?? [];
        const sources: StyleSpecification["sources"] = { ...next.sources };
        for (const id of OWN_SOURCE_IDS) if (prevSources[id]) sources[id] = prevSources[id];

        const own = OWN_LAYER_IDS.map((id) => prevLayers.find((l) => l.id === id)).filter(Boolean) as LayerSpecification[];
        const base = [...next.layers];
        const firstSymbolIdx = base.findIndex((l) => l.type === "symbol");
        const under: LayerSpecification[] = [hillshadeFor(basemap)];
        if (next.sources["openmaptiles"]) under.push(buildings3dFor(basemap));
        if (firstSymbolIdx >= 0) base.splice(firstSymbolIdx, 0, ...under);
        else base.push(...under);

        return { ...next, sources, layers: [...base, ...own], terrain: useStore.getState().map3d ? { source: "dem", exaggeration: 1.5 } : undefined };
      },
    });
    // feature-state does not survive a style swap: re-apply every slope once the new style is in
    map.once("style.load", () => {
      const s = useStore.getState();
      applyMapMode(map, s.map3d);
      void applyRiskState(map, s.slopes, s.assessments, s.stormMode, s.stormHorizonH, s.gameTime, true);
      showSelection(map, s.slopes.find((slope) => slope.id === s.selectedSlopeId));
    });
  }, [basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    applyMapMode(map, map3d);
    map.easeTo({ pitch: map3d ? 45 : 0, duration: 250 });
  }, [map3d, mapLoaded]);

  // ---- update slope colors on assessment/storm changes (feature-state diff, no GeoJSON re-upload) ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const timer = setTimeout(() => {
      void applyRiskState(map, slopes, assessments, stormMode, stormHorizonH, useStore.getState().gameTime);
    }, 60);
    return () => clearTimeout(timer);
  }, [slopes, assessments, stormMode, stormHorizonH]);

  // ---- layer visibility (+ lazy-load live CSDI data for layers just toggled on) ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    applyVisibility(map, layers);
    syncCsdiData(map, layers);
  }, [layers]);

  // ---- legend-driven risk class filter ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    applyRiskFilter(map, riskFilter);
  }, [riskFilter]);

  // ---- camera commands (zoom / rotate / tilt / reset) from the HUD ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !viewCmd) return;
    switch (viewCmd.type) {
      case "rotate":
        map.easeTo({ bearing: map.getBearing() + (viewCmd.delta ?? 30), duration: 500 });
        break;
      case "tilt":
        map.easeTo({ pitch: Math.max(0, Math.min(62, map.getPitch() + (viewCmd.delta ?? 15))), duration: 400 });
        break;
      case "north":
        map.easeTo({ bearing: 0, duration: 500 });
        break;
      case "zoom":
        map.easeTo({ zoom: map.getZoom() + (viewCmd.delta ?? 1), duration: 160 });
        break;
      case "home":
        map.easeTo({ center: HK_CENTER, zoom: 10.4, pitch: useStore.getState().map3d ? 52 : 0, bearing: -12, duration: 400 });
        break;
    }
  }, [viewCmd]);

  // ---- fly to ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !flyTo) return;
    const frame = requestAnimationFrame(() => {
      const slope = slopes.find((s) => s.id === selectedSlopeId);
      if (slope) focusSlope(map, slope);
      else map.easeTo({ center: flyTo.center, zoom: flyTo.zoom, padding: 0, duration: 550 });
    });
    return () => cancelAnimationFrame(frame);
  }, [flyTo, commandCenterOpen, mapLoaded]);

  // ---- selected outline ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const s = slopes.find((x) => x.id === selectedSlopeId);
    showSelection(map, s);
    selectionMarkerRef.current?.remove();
    selectionMarkerRef.current = null;
    if (s) {
      const label = document.createElement("div");
      label.className = "selected-slope-marker";
      label.textContent = s.id;
      selectionMarkerRef.current = new maplibregl.Marker({ element: label, anchor: "bottom", offset: [0, -28] })
        .setLngLat(s.centroid).addTo(map);
    }
  }, [selectedSlopeId, slopes, mapLoaded]);

  // ---- runout animation over terrain ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const runoutSrc = map.getSource("runout") as maplibregl.GeoJSONSource | undefined;
    const frontSrc = map.getSource("runout-front") as maplibregl.GeoJSONSource | undefined;
    if (!runoutSrc || !frontSrc) return;
    if (!simResult || !simResult.failureLikely) {
      if (lastRunoutRef.current?.result === null) return;
      runoutSrc.setData(EMPTY_FC);
      frontSrc.setData(EMPTY_FC);
      lastRunoutRef.current = { result: null, frame: -1 };
      return;
    }
    const frame = simResult.frames.reduce((best, f) => (f.tSec <= animTimeSec ? f : best), simResult.frames[0]);
    if (lastRunoutRef.current?.result === simResult && lastRunoutRef.current.frame === frame.tSec) return;
    lastRunoutRef.current = { result: simResult, frame: frame.tSec };
    const frac = Math.min(1, frame.debrisFrontM / Math.max(1, simResult.runoutDistanceM));
    const path = simResult.runoutPath;
    const n = Math.max(2, Math.ceil(frac * path.length));
    const active = path.slice(0, n);
    if (active.length < 2 || frac <= 0.01) {
      runoutSrc.setData(EMPTY_FC);
      frontSrc.setData(EMPTY_FC);
      return;
    }
    // corridor polygon widening downslope
    const left: [number, number][] = [];
    const right: [number, number][] = [];
    for (let i = 0; i < active.length; i++) {
      const prev = active[Math.max(0, i - 1)];
      const next = active[Math.min(active.length - 1, i + 1)];
      const dx = next[0] - prev[0];
      const dy = next[1] - prev[1];
      const len = Math.hypot(dx, dy) || 1e-9;
      const px = -dy / len;
      const py = dx / len;
      const w = (18 + 55 * (i / path.length)) / 111_000; // deg approx
      left.push([active[i][0] + px * w, active[i][1] + py * w]);
      right.push([active[i][0] - px * w, active[i][1] - py * w]);
    }
    const ring = [...left, ...right.reverse(), left[0]];
    runoutSrc.setData({
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} }],
    });
    frontSrc.setData({
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "Point", coordinates: active[active.length - 1] }, properties: {} }],
    });
  }, [simResult, animTimeSec]);

  // keep sources fresh if incidents/assets change (rare)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    (map.getSource("incidents") as maplibregl.GeoJSONSource | undefined)?.setData(incidentFC(incidents));
  }, [incidents]);

  // ---- HKO live rainfall stations (refreshed every 5 min by the store) ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    setSrcData(map, "live-rain", liveRainFC(liveRain));
  }, [liveRain]);

  useEffect(() => {
    rain3dRef.current?.setEnabled(layers.rain3d && map3d);
  }, [layers.rain3d, map3d, mapLoaded]);

  // ---- 3D scenario playback: the engine's result as a debris flow over the terrain ----
  useEffect(() => {
    const d = debris3dRef.current;
    if (!d) return;
    const show = sim3dActive && !!simResult?.failureLikely && map3d;
    if (!show) {
      if (sim3dResultRef.current) {
        sim3dResultRef.current = null;
        d.hide();
        rain3dRef.current?.setOverride(null);
      }
      return;
    }
    if (sim3dResultRef.current !== simResult) {
      sim3dResultRef.current = simResult;
      d.show(simResult, slopes.find((s) => s.id === simResult.slopeId));
      rain3dRef.current?.setOverride(simResult.params.rainfallMm / Math.max(1, simResult.params.rainfallDurationH));
    } else if (animTimeSec < sim3dLastTRef.current - 1) {
      d.reset(); // rewind / restart: fresh people, vehicles and hit state
    }
    sim3dLastTRef.current = animTimeSec;
    d.setTime(animTimeSec);
  }, [sim3dActive, simResult, animTimeSec, map3d, mapLoaded]);

  // `assets` only feed sources at mount; referenced here so the dependency is explicit
  void assets;

  return <div ref={containerRef} className="map-container" />;
}

function applyVisibility(map: maplibregl.Map, layers: ReturnType<typeof useStore.getState>["layers"]) {
  const vis = (on: boolean) => (on ? "visible" : "none");
  const safe = (id: string, on: boolean) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis(on));
  };
  safe("slopes-pt", layers.slopeRisk);
  safe("slopes-blobs-fill", layers.slopeRisk);
  safe("slopes-fill", layers.slopeRisk);
  safe("slopes-line", layers.slopeRisk);
  safe("uncertainty-fill", layers.uncertainty);
  safe("rain-heat", layers.rainfall);
  safe("roads-line", layers.roads);
  safe("csdi-roads-line", layers.roads);
  safe("buildings-pt", layers.buildings);
  safe("facilities-local-pt", layers.buildings);
  safe("building-blocks-pt", layers.buildings);
  safe("buildings-3d", layers.buildings && useStore.getState().map3d);
  safe("drainage-pt", layers.drainage);
  safe("mitigated-pt", layers.mitigations);
  safe("historical-pt", layers.historicalLandslides);
  safe("sensors-pt", layers.sensors);
  safe("incidents-pt", layers.incidents);
  safe("flood-fill", layers.floodZones);
  safe("flood-line", layers.floodZones);
  safe("csdi-slopes-fill", layers.csdiSlopes);
  safe("csdi-slopes-line", layers.csdiSlopes);
  safe("csdi-blackspots-pt", layers.csdiBlackspots);
  safe("csdi-landslides-pt", layers.csdiLandslides);
  safe("csdi-lpm-fill", layers.csdiLpm);
  safe("csdi-lpm-line", layers.csdiLpm);
  safe("csdi-lpm-pt", layers.csdiLpm);
  safe("entli-grid-fill", layers.csdiEntli);
  safe("csdi-entli-trails-line", layers.csdiEntli);
  safe("csdi-entli-crowns-pt", layers.csdiEntli);
  safe("live-rain-pt", layers.liveRain);
}

// ---------- live CSDI data wiring (real HK government layers) ----------

const CSDI_SLOPES_MIN_ZOOM = 12; // 61k polygons: only fetch the viewport once zoomed in

// last successfully fetched slope envelope; skip refetch while the view stays inside it
const csdiSlopesState = { bbox: null as null | [number, number, number, number], truncated: false, seq: 0 };

function setSrcData(map: maplibregl.Map, id: string, fc: any) {
  // async loaders may resolve after the map was removed (view switched) — maplibre then throws on getSource
  try {
    (map.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(fc);
  } catch {
    /* map gone */
  }
}

/** Fetch CEDD registered slopes for the current viewport (debounced by bbox containment). */
function refreshCsdiSlopes(map: maplibregl.Map) {
  if (!useStore.getState().layers.csdiSlopes) return;
  if (map.getZoom() < CSDI_SLOPES_MIN_ZOOM) {
    csdiSlopesState.seq++;
    csdiSlopesState.bbox = null;
    setSrcData(map, "csdi-slopes", EMPTY_FC);
    return;
  }
  const b = map.getBounds();
  const w = b.getWest(), s = b.getSouth(), e = b.getEast(), n = b.getNorth();
  const prev = csdiSlopesState.bbox;
  if (prev && !csdiSlopesState.truncated && w >= prev[0] && s >= prev[1] && e <= prev[2] && n <= prev[3]) return;
  // fetch a margin beyond the viewport so small pans don't refetch
  const mx = (e - w) * 0.25, my = (n - s) * 0.25;
  const box: [number, number, number, number] = [w - mx, s - my, e + mx, n + my];
  const seq = ++csdiSlopesState.seq;
  fetchSlopesInBbox(...box)
    .then(({ fc, truncated }) => {
      if (seq !== csdiSlopesState.seq) return; // superseded by a later pan
      csdiSlopesState.bbox = box;
      csdiSlopesState.truncated = truncated;
      setSrcData(map, "csdi-slopes", fc);
    })
    .catch((err) => console.warn("CSDI slopes fetch failed:", err));
}

const ENTLI_MIN_ZOOM = 13; // 226k features: crowns/trails only per viewport (dense hills hit the 3,000 cap below this); the baked grid covers lower zooms
const entliState = { bbox: null as null | [number, number, number, number], truncated: false, seq: 0 };

/** Fetch ENTLI crowns + trails for the current viewport (same bbox-containment debounce as the slopes). */
function refreshEntli(map: maplibregl.Map) {
  if (!useStore.getState().layers.csdiEntli) return;
  if (map.getZoom() < ENTLI_MIN_ZOOM) {
    entliState.seq++;
    entliState.bbox = null;
    setSrcData(map, "csdi-entli-crowns", EMPTY_FC);
    setSrcData(map, "csdi-entli-trails", EMPTY_FC);
    return;
  }
  const b = map.getBounds();
  const w = b.getWest(), s = b.getSouth(), e = b.getEast(), n = b.getNorth();
  const prev = entliState.bbox;
  if (prev && !entliState.truncated && w >= prev[0] && s >= prev[1] && e <= prev[2] && n <= prev[3]) return;
  const mx = (e - w) * 0.25, my = (n - s) * 0.25;
  const box: [number, number, number, number] = [w - mx, s - my, e + mx, n + my];
  const seq = ++entliState.seq;
  fetchEntliInBbox(...box)
    .then(({ crowns, trails, truncated }) => {
      if (seq !== entliState.seq) return;
      entliState.bbox = box;
      entliState.truncated = truncated;
      setSrcData(map, "csdi-entli-crowns", crowns);
      setSrcData(map, "csdi-entli-trails", trails);
    })
    .catch((err) => console.warn("CSDI ENTLI fetch failed:", err));
}

const ROADS_MIN_ZOOM = 13; // 40k centrelines: per viewport only; below this the basemap's own roads suffice
const roadsState = { bbox: null as null | [number, number, number, number], truncated: false, seq: 0 };

/** Fetch LandsD road centrelines for the current viewport (bbox-containment debounce). */
function refreshRoads(map: maplibregl.Map) {
  if (!useStore.getState().layers.roads) return;
  if (map.getZoom() < ROADS_MIN_ZOOM) {
    roadsState.bbox = null;
    setSrcData(map, "csdi-roads", EMPTY_FC);
    return;
  }
  const b = map.getBounds();
  const w = b.getWest(), s = b.getSouth(), e = b.getEast(), n = b.getNorth();
  const prev = roadsState.bbox;
  if (prev && !roadsState.truncated && w >= prev[0] && s >= prev[1] && e <= prev[2] && n <= prev[3]) return;
  const mx = (e - w) * 0.3, my = (n - s) * 0.3;
  const box: [number, number, number, number] = [w - mx, s - my, e + mx, n + my];
  const seq = ++roadsState.seq;
  fetchRoadsInBbox(...box)
    .then(({ fc, truncated }) => {
      if (seq !== roadsState.seq) return;
      roadsState.bbox = box;
      roadsState.truncated = truncated;
      setSrcData(map, "csdi-roads", fc);
    })
    .catch((err) => console.warn("LandsD roads fetch failed:", err));
}

let entliGridFC: any | null = null;

/** Build the ENTLI density grid once from the baked chunk (lazy import — only paid when the layer is toggled on). */
async function ensureEntliGrid(map: maplibregl.Map) {
  if (!entliGridFC) {
    const [{ ENTLI_GRID: g }, { u16 }] = await Promise.all([import("@/live/baked/entliGrid"), import("@/live/baked/decode")]);
    const cells = u16(g.cells), rc = u16(g.recent), rl = u16(g.relict);
    const features: any[] = [];
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k];
      const q = i % g.cols, r = Math.floor(i / g.cols);
      const x0 = g.lon0 + q * g.dLon, y0 = g.lat0 + r * g.dLat;
      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [[[x0, y0], [x0 + g.dLon, y0], [x0 + g.dLon, y0 + g.dLat], [x0, y0 + g.dLat], [x0, y0]]] },
        properties: { d: rc[k] + rl[k], recent: rc[k], relict: rl[k] },
      });
    }
    entliGridFC = { type: "FeatureCollection", features };
  }
  setSrcData(map, "entli-grid", entliGridFC);
}

/** Load whichever CSDI layers are toggled on (cached after first load). */
function syncCsdiData(map: maplibregl.Map, layers: ReturnType<typeof useStore.getState>["layers"]) {
  if (layers.csdiBlackspots) {
    fetchBlackspots()
      .then((fc) => setSrcData(map, "csdi-blackspots", fc))
      .catch((err) => console.warn("CSDI blackspots fetch failed:", err));
  }
  if (layers.csdiLandslides) {
    fetchLandslides()
      .then((fc) => setSrcData(map, "csdi-landslides", fc))
      .catch((err) => console.warn("CSDI landslides fetch failed:", err));
  }
  if (layers.csdiLpm) {
    fetchLpmWorks()
      .then((w) => {
        setSrcData(map, "csdi-lpm", w.fc);
        setSrcData(map, "csdi-lpm-pts", polygonCentroidFC(w.fc));
      })
      .catch((err) => console.warn("CSDI LPM works fetch failed:", err));
  }
  if (layers.csdiEntli) {
    ensureEntliGrid(map).catch((err) => console.warn("ENTLI grid unavailable:", err));
    refreshEntli(map);
  }
  if (layers.roads) refreshRoads(map);
  refreshCsdiSlopes(map);
}

/** Hover popups for the live layers — labelled as real data, unlike the synthetic overlays. */
function wireCsdiPopups(map: maplibregl.Map, popupFor: () => maplibregl.Popup) {
  const wire = (layerId: string, html: (p: any) => string) => {
    map.on("mousemove", layerId, (e) => {
      const f = e.features?.[0];
      if (!f) return;
      map.getCanvas().style.cursor = "pointer";
      popupFor().setLngLat(e.lngLat).setHTML(html(f.properties)).addTo(map);
    });
    map.on("mouseleave", layerId, () => {
      map.getCanvas().style.cursor = "";
      popupFor().remove();
    });
  };
  const foot = (src: string) => `<div style="color:#18a08f;font-size:9px;letter-spacing:0.6px;font-weight:700">LIVE DATA · ${src} via CSDI</div>`;
  wire("csdi-slopes-fill", (p) => {
    const ht = p.OVERALL_HT > 0 ? `${p.OVERALL_HT} m` : "—";
    const an = p.OVERALL_AN > 0 ? ` · ${p.OVERALL_AN}°` : "";
    return (
      `<div style="font-family:var(--mono);font-weight:600">${p.SLOPE_NO}</div>` +
      `<div style="font-size:10px">Registered man-made slope · ${ht}${an}</div>` +
      `<div style="color:#6d7a8c;font-size:10px">${p.LOCATION ?? ""}</div>` +
      `<div style="color:#6d7a8c;font-size:10px">Maintenance: ${p.MAINT_PART ?? "—"}</div>` +
      foot("CEDD")
    );
  });
  wire("csdi-blackspots-pt", (p) => (
    `<div style="font-weight:600">Flooding blackspot · scale ${p.FLOODING_BLACKSPOT_SCALE ?? "—"}</div>` +
    `<div style="font-size:10px">${p.LOCATION_EN ?? ""} · ${p.DISTRICT_EN ?? ""}</div>` +
    `<div style="color:#6d7a8c;font-size:10px;max-width:260px;white-space:pre-line">${p.CAUSE_OF_FLOODING_EN ?? ""}</div>` +
    foot("DSD")
  ));
  wire("csdi-landslides-pt", (p) => {
    const d = p.FAILDATE ? new Date(p.FAILDATE).toISOString().slice(0, 10) : "date unknown";
    const slopeRef = p.SLOPENUM && p.SLOPENUM !== "-" ? ` · slope ${p.SLOPENUM}` : "";
    return (
      `<div style="font-weight:600">Landslide incident · ${d}</div>` +
      `<div style="font-size:10px">${p.FEATTYPE ?? ""}${slopeRef}</div>` +
      `<div style="color:#6d7a8c;font-size:10px">${p.LOCATION ?? ""} · ref ${p.INCID}</div>` +
      foot("CEDD")
    );
  });
  const lpmHtml = (p: any) =>
    `<div style="font-family:var(--mono);font-weight:600">${p.slopeNo}</div>` +
    `<div style="font-size:10px">LPM ${p.kind === "catchment" ? "natural hillside catchment" : "substandard slope"} · contract ${p.contract}</div>` +
    `<div style="color:#6d7a8c;font-size:10px">${p.location ?? ""}</div>` +
    `<div style="color:#6d7a8c;font-size:10px">Works ${p.startLabel} → ${p.completionLabel}</div>` +
    foot("CEDD LPMitP");
  wire("csdi-lpm-fill", lpmHtml);
  wire("csdi-roads-line", (p) => (
    `<div style="font-weight:600">${p.ENGLISHSTREETNAME || "Unnamed road"}</div>` +
    `<div style="font-size:10px">${p.STREETTYPE ?? "Road"} · road centreline</div>` +
    foot("LandsD")
  ));
  wire("csdi-lpm-pt", lpmHtml);
  const ENTLI_TYPE: Record<string, string> = { R: "relict (pre-1963 baseline)", C: "recent · channelised", O: "recent · open hillslope", S: "recent · other" };
  wire("csdi-entli-crowns-pt", (p) => (
    `<div style="font-family:var(--mono);font-weight:600">${p.ENTLI_NO}</div>` +
    `<div style="font-size:10px">Natural terrain landslide · ${ENTLI_TYPE[p.SLIDE_TYPE] ?? p.SLIDE_TYPE}${p.YEAR_1 ? ` · ${p.YEAR_1}` : ""}</div>` +
    `<div style="color:#6d7a8c;font-size:10px">width ${p.M_WIDTH ?? "—"} m · length ${p.S_LENGTH ?? "—"} m · slope ${p.SLOPE ?? "—"}° · drop ${p.ELE_DIFF ?? "—"} m</div>` +
    foot("CEDD ENTLI")
  ));
  wire("entli-grid-fill", (p) => (
    `<div style="font-weight:600">${p.d} landslide crown${p.d === 1 ? "" : "s"} in this 250 m cell</div>` +
    `<div style="color:#6d7a8c;font-size:10px">${p.recent} recent (dated) · ${p.relict} relict · ≈ ${Math.round(p.d / 0.0625)} per km²</div>` +
    foot("CEDD ENTLI")
  ));
  wire("live-rain-pt", (p) => (
    `<div style="font-weight:600">${p.name} <span style="font-family:var(--mono);color:#6d7a8c">${p.id}</span></div>` +
    `<div style="font-size:12px"><b>${p.mmHr} mm</b> in the past hour · obs ${String(p.obsTime).slice(11, 16)} HKT</div>` +
    `<div style="color:#6d7a8c;font-size:10px">${p.mm24 >= 0 ? `${p.mm24} mm over the last ${p.hoursCounted} h` : "24-h total not available (direct HKO mode)"}</div>` +
    `<div style="color:#3d8bfd;font-size:9px;letter-spacing:0.6px;font-weight:700">LIVE DATA · HKO Open Data API</div>`
  ));
}

/** Legend filter: hide whole risk classes through feature-state (filters cannot read feature-state). */
function applyRiskFilter(map: maplibregl.Map, filter: ReturnType<typeof useStore.getState>["riskFilter"]) {
  hiddenCats = new Set(
    Object.entries(filter)
      .filter(([, on]) => !on)
      .map(([c]) => c)
  );
  if (!map.getSource("slopes")) return;
  for (const [id, cat] of riskCat) {
    const hidden = hiddenCats.has(cat);
    map.setFeatureState({ source: "slopes", id }, { hidden });
    map.setFeatureState({ source: "slopes-pts", id }, { hidden });
  }
  applyBlobState(map, true);
}

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
import { RISK_COLORS, Slope, RiskAssessment, Asset, Incident } from "@/core/types";
import { offsetM } from "@/mock/geo";
import { fetchSlopesInBbox, fetchBlackspots, fetchLandslides } from "@/live/csdi";

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
  "dem", "hillshadeDem", "slopes", "slopes-pts", "roads", "buildings", "drainage", "incidents", "sensors", "mitigated", "historical", "rainfall-pts", "flood",
  "runout", "runout-front", "selected", "csdi-slopes", "csdi-blackspots", "csdi-landslides",
];
const OWN_LAYER_IDS = [
  "flood-fill", "flood-line", "rain-heat", "csdi-slopes-fill", "csdi-slopes-line", "slopes-pt", "slopes-fill", "slopes-line", "uncertainty-fill", "roads-line",
  "buildings-pt", "drainage-pt", "mitigated-pt", "historical-pt", "sensors-pt", "incidents-pt", "csdi-landslides-pt", "csdi-blackspots-pt",
  "selected-line", "runout-fill", "runout-line", "runout-front-pt",
];

/** Terrain relief tuned per basemap: soft grey shadows on the light map, deep shadows on dark/satellite. */
function hillshadeFor(b: BasemapId): LayerSpecification {
  const light = b === "light";
  return {
    id: "hillshade",
    type: "hillshade",
    source: "hillshadeDem",
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
    minzoom: 13,
    paint: {
      "fill-extrusion-color": light
        ? ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 12], 0, "#dfe3ea", 60, "#c6cdd8", 200, "#aab4c4"]
        : ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 12], 0, "#232b38", 60, "#34405a", 200, "#4a5a80"],
      "fill-extrusion-height": ["coalesce", ["get", "render_height"], 12],
      "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      "fill-extrusion-opacity": light ? 0.85 : 0.78,
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

function slopeFC(slopes: Slope[], assessments: Map<string, RiskAssessment>, stormMode: boolean, stormHorizonH: number, gameTime: number): any {
  return {
    type: "FeatureCollection",
    features: slopes.map((s) => {
      let a = assessments.get(s.id);
      if (stormMode && a && s.hasData) {
        a = registry.risk.projectUnderStorm(s, gameTime, stormHorizonH);
      }
      const cat = a?.category ?? "no-data";
      return {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [s.polygon] },
        properties: {
          id: s.id,
          cat,
          color: RISK_COLORS[cat],
          score: a?.score ?? 0,
          conf: a?.confidence ?? 0,
          district: s.district,
          hasMit: s.mitigations.length > 0 ? 1 : 0,
          hasHist: s.history.some((e) => e.kind === "incident") ? 1 : 0,
          rain: a ? 1 : 0,
        },
      };
    }),
  };
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
        properties: { id: a.id, kind: a.kind, name: a.name },
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
  map.addSource("hillshadeDem", { type: "raster-dem", tiles: DEM_TILES, encoding: "terrarium", tileSize: 256, maxzoom: 13 });
  map.setTerrain({ source: "dem", exaggeration: 1.5 });

  // basemap-relative anchors: relief and 3D buildings sit under labels
  const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
  map.addLayer(hillshadeFor(st.basemap), firstSymbol);
  if (map.getSource("openmaptiles")) map.addLayer(buildings3dFor(st.basemap), firstSymbol);

  map.addSource("slopes", { type: "geojson", data: slopeFC(st.slopes, st.assessments, st.stormMode, st.stormHorizonH, st.gameTime) });
  map.addSource("slopes-pts", { type: "geojson", data: slopePointFC(slopeFC(st.slopes, st.assessments, st.stormMode, st.stormHorizonH, st.gameTime), st.slopes) });
  map.addSource("roads", { type: "geojson", data: assetFC(st.assets, ["road", "emergency-route"]) });
  map.addSource("buildings", { type: "geojson", data: assetFC(st.assets, ["building", "hospital", "school", "railway"]) });
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

  map.addLayer({ id: "flood-fill", type: "fill", source: "flood", layout: { visibility: "none" }, paint: { "fill-color": "#2470c2", "fill-opacity": 0.22 } });
  map.addLayer({ id: "flood-line", type: "line", source: "flood", layout: { visibility: "none" }, paint: { "line-color": "#3d8bfd", "line-opacity": 0.5, "line-dasharray": [2, 2] } });

  // CEDD registered man-made slopes — real catalogue polygons, drawn under the synthetic risk layers
  map.addLayer({
    id: "csdi-slopes-fill", type: "fill", source: "csdi-slopes", layout: { visibility: "none" },
    paint: { "fill-color": "#18b8a6", "fill-opacity": 0.16 },
  });
  map.addLayer({
    id: "csdi-slopes-line", type: "line", source: "csdi-slopes", layout: { visibility: "none" },
    paint: { "line-color": "#18b8a6", "line-opacity": 0.8, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.6, 16, 1.6] },
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

  // Far out, individual slope features are sub-pixel: show them as risk-coloured points until
  // zoom 12.5, then hand over to the true polygons (which are drawn from zoom 11.5 so the two cross-fade).
  map.addLayer({
    id: "slopes-pt", type: "circle", source: "slopes-pts", maxzoom: 12.5,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 2.6, 11, 4, 12.5, 6],
      "circle-color": ["get", "color"],
      "circle-opacity": ["interpolate", ["linear"], ["zoom"], 11.5, 0.9, 12.5, 0],
      "circle-stroke-width": 0.6, "circle-stroke-color": "rgba(0,0,0,0.35)",
    },
  });
  map.addLayer({
    id: "slopes-fill", type: "fill", source: "slopes", minzoom: 11.5,
    paint: { "fill-color": ["get", "color"], "fill-opacity": ["interpolate", ["linear"], ["zoom"], 11.5, 0.2, 12.5, 0.62, 15, 0.5] },
  });
  map.addLayer({
    id: "slopes-line", type: "line", source: "slopes", minzoom: 11.5,
    paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.8, 15, 1.8], "line-opacity": 0.95 },
  });
  map.addLayer({
    id: "uncertainty-fill", type: "fill", source: "slopes", layout: { visibility: "none" },
    paint: {
      "fill-color": ["interpolate", ["linear"], ["get", "conf"], 0.2, "rgba(186,85,255,0.75)", 0.55, "rgba(186,85,255,0.35)", 0.9, "rgba(186,85,255,0.04)"],
    },
  });

  map.addLayer({
    id: "roads-line", type: "line", source: "roads",
    paint: { "line-color": "#5b7ea8", "line-width": 1.6, "line-opacity": 0.75 },
  });
  map.addLayer({
    id: "buildings-pt", type: "circle", source: "buildings",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, ["match", ["get", "kind"], "hospital", 3.5, "school", 2.5, 1.8], 14, ["match", ["get", "kind"], "hospital", 7, "school", 5.5, 4]],
      "circle-color": ["match", ["get", "kind"], "hospital", "#e56db1", "school", "#7db4ff", "railway", "#9a86e8", "#8fa2ba"],
      "circle-opacity": 0.85, "circle-stroke-width": 1, "circle-stroke-color": "#0c1017",
    },
  });
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

  map.addLayer({
    id: "selected-line", type: "line", source: "selected",
    paint: { "line-color": "#ffffff", "line-width": 2.5 },
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
}

export default function MapView() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const basemapRef = useRef<BasemapId>(useStore.getState().basemap);

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

  // ---- init map ----
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const container = containerRef.current;
    const initial = useStore.getState().basemap;
    let cancelled = false;

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
      const map = new maplibregl.Map({
        container,
        style,
        center: HK_CENTER,
        zoom: 10.4,
        pitch: 52,
        bearing: -12,
        maxPitch: 72,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      wireMap(map);
    });

    const wireMap = (map: maplibregl.Map) => {
    // some vendor style layers reference sprite patterns we do not ship; provide a blank pixel instead of a warning
    map.on("styleimagemissing", (e) => {
      if (!map.hasImage(e.id)) map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    map.on("load", () => {
      mountOwnLayers(map);

      // interactions
      map.on("click", "slopes-fill", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const id = f.properties?.id as string;
        useStore.getState().selectSlope(id);
        useStore.getState().flyToSlope(id);
      });
      map.on("click", "slopes-pt", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const id = f.properties?.id as string;
        useStore.getState().selectSlope(id);
        useStore.getState().flyToSlope(id);
      });
      for (const hoverLayer of ["slopes-fill", "slopes-pt"]) map.on("mousemove", hoverLayer, (e) => {
        map.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as any;
        if (!popupRef.current) {
          popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
        }
        popupRef.current
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-family:var(--mono);font-weight:600">${p.id}</div>` +
              `<div style="color:${p.color};font-weight:700;text-transform:uppercase;font-size:10px;letter-spacing:1px">${p.cat} · ${p.score}/100</div>` +
              `<div style="color:#6d7a8c;font-size:10px">${p.district} · confidence ${Math.round(p.conf * 100)}% · synthetic</div>`
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
        railway: "Rail segment",
        building: "Residential block",
        landslide: "Landslide",
        rockfall: "Rockfall",
        "debris-flow": "Debris flow",
        "road-blockage": "Road blockage",
        flooding: "Flooding",
      };
      for (const layerId of ["buildings-pt", "incidents-pt"]) {
        map.on("mousemove", layerId, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          map.getCanvas().style.cursor = "pointer";
          const p = f.properties as any;
          if (!popupRef.current) popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
          const label = KIND_LABEL[p.kind] ?? p.kind;
          const title = layerId === "incidents-pt" ? `${label} · severity ${p.severity}` : label;
          const sub = layerId === "incidents-pt" ? `active incident · ${p.id}` : String(p.name ?? "").replace(" (synthetic)", "");
          popupRef.current
            .setLngLat(e.lngLat)
            .setHTML(`<div style="font-weight:600">${title}</div><div style="color:#6d7a8c;font-size:10px">${sub} · synthetic</div>`)
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
      map.on("moveend", () => refreshCsdiSlopes(map));
      syncCsdiData(map, useStore.getState().layers);

      loadedRef.current = true;
      applyVisibility(map, useStore.getState().layers);
      applyRiskFilter(map, useStore.getState().riskFilter);
      useStore.getState().setMapLoaded(true);
    });
    };

    return () => {
      cancelled = true;
      loadedRef.current = false;
      useStore.getState().setMapLoaded(false);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // ---- basemap switch: swap the base style, keep every twin source/layer and the terrain ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || basemapRef.current === basemap) return;
    basemapRef.current = basemap;
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

        return { ...next, sources, layers: [...base, ...own], terrain: prev?.terrain ?? { source: "dem", exaggeration: 1.5 } };
      },
    });
  }, [basemap]);

  // ---- update slope colors on assessment/storm changes ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const fc = slopeFC(slopes, assessments, stormMode, stormHorizonH, useStore.getState().gameTime);
    const src = map.getSource("slopes") as maplibregl.GeoJSONSource | undefined;
    src?.setData(fc);
    (map.getSource("slopes-pts") as maplibregl.GeoJSONSource | undefined)?.setData(slopePointFC(fc, slopes));
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
        map.easeTo({ pitch: Math.max(0, Math.min(72, map.getPitch() + (viewCmd.delta ?? 15))), duration: 400 });
        break;
      case "north":
        map.easeTo({ bearing: 0, duration: 500 });
        break;
      case "zoom":
        map.easeTo({ zoom: map.getZoom() + (viewCmd.delta ?? 1), duration: 350 });
        break;
      case "home":
        map.easeTo({ center: HK_CENTER, zoom: 10.4, pitch: 52, bearing: -12, duration: 1200 });
        break;
    }
  }, [viewCmd]);

  // ---- fly to ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    map.easeTo({
      center: flyTo.center,
      zoom: flyTo.zoom,
      pitch: 58,
      duration: 1400,
      padding: { left: commandCenterOpen ? Math.min(window.innerWidth * 0.58, window.innerWidth - 380) : 0, top: 0, right: 0, bottom: 0 },
    });
  }, [flyTo, commandCenterOpen]);

  // ---- selected outline ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const src = map.getSource("selected") as maplibregl.GeoJSONSource | undefined;
    const s = slopes.find((x) => x.id === selectedSlopeId);
    src?.setData(
      s ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [s.polygon] }, properties: {} }] } : EMPTY_FC
    );
  }, [selectedSlopeId, slopes]);

  // ---- runout animation over terrain ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const runoutSrc = map.getSource("runout") as maplibregl.GeoJSONSource | undefined;
    const frontSrc = map.getSource("runout-front") as maplibregl.GeoJSONSource | undefined;
    if (!runoutSrc || !frontSrc) return;
    if (!simResult || !simResult.failureLikely) {
      runoutSrc.setData(EMPTY_FC);
      frontSrc.setData(EMPTY_FC);
      return;
    }
    const frame = simResult.frames.reduce((best, f) => (f.tSec <= animTimeSec ? f : best), simResult.frames[0]);
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
  safe("slopes-fill", layers.slopeRisk);
  safe("slopes-line", layers.slopeRisk);
  safe("uncertainty-fill", layers.uncertainty);
  safe("rain-heat", layers.rainfall);
  safe("roads-line", layers.roads);
  safe("buildings-pt", layers.buildings);
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
}

// ---------- live CSDI data wiring (real HK government layers) ----------

const CSDI_SLOPES_MIN_ZOOM = 12; // 61k polygons: only fetch the viewport once zoomed in

// last successfully fetched slope envelope; skip refetch while the view stays inside it
const csdiSlopesState = { bbox: null as null | [number, number, number, number], truncated: false, seq: 0 };

function setSrcData(map: maplibregl.Map, id: string, fc: any) {
  (map.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(fc);
}

/** Fetch CEDD registered slopes for the current viewport (debounced by bbox containment). */
function refreshCsdiSlopes(map: maplibregl.Map) {
  if (!useStore.getState().layers.csdiSlopes) return;
  if (map.getZoom() < CSDI_SLOPES_MIN_ZOOM) {
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
}

function applyRiskFilter(map: maplibregl.Map, filter: ReturnType<typeof useStore.getState>["riskFilter"]) {
  const cats = Object.entries(filter)
    .filter(([, on]) => on)
    .map(([c]) => c);
  const expr: any = ["in", ["get", "cat"], ["literal", cats]];
  for (const id of ["slopes-pt", "slopes-fill", "slopes-line", "uncertainty-fill"]) {
    if (map.getLayer(id)) map.setFilter(id, expr);
  }
}

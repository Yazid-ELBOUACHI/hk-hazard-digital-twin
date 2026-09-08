// REAL natural terrain hazard mitigation measures from CEDD's Catalogue of Slopes (baked by
// scripts/build-live-data.mjs → src/live/baked/barriers.ts):
//   • ND — defence measures: debris-resisting barriers (rigid check dams, flexible nets), earth bunds, boulder fences
//   • NS — stabilisation measures on natural hillsides: soil nails, buttresses, raking drains
// The open layer gives footprint, location and maintenance party only. Barrier type, height and design retention
// volume are not published, so anything the twin shows about them is an indicative assumption, labelled as such.

import type { Barrier } from "@/live/baked/barriers";
import { reportSource } from "@/core/dataSources";
import { normSlopeNo } from "./csdi";

export type { Barrier };

export interface RealBarrierData {
  all: Barrier[];
  /** ND + NS measures within 200 m of an inventory slope, keyed by normalised slope number. */
  bySlope: Map<string, Barrier[]>;
}

/** Indicative wall height for a defence measure — GEO's standardised debris-resisting barrier modules are a few metres tall. */
export const ND_INDICATIVE_HEIGHT_M = 4;

export const BARRIER_CLASS_LABEL: Record<Barrier["cls"], string> = {
  ND: "defence measure — debris-resisting barrier, bund or boulder fence",
  NS: "stabilisation measure — nails, buttress or drains on natural hillside",
};

let cache: Promise<RealBarrierData | null> | null = null;

export function loadRealBarriers(): Promise<RealBarrierData | null> {
  cache ??= import("@/live/baked/barriers")
    .then((m) => {
      const all = m.BARRIERS;
      const bySlope = new Map<string, Barrier[]>();
      for (const b of all) {
        for (const [sid] of b.slopes) {
          const k = normSlopeNo(sid);
          (bySlope.get(k) ?? bySlope.set(k, []).get(k)!).push(b);
        }
      }
      const nd = all.filter((b) => b.cls === "ND").length;
      reportSource("cedd-ntmm", { ok: true, count: all.length, note: `${nd} ND defence · ${all.length - nd} NS stabilisation · ${bySlope.size} inventory slopes within 200 m` });
      return { all, bySlope };
    })
    .catch((err) => {
      reportSource("cedd-ntmm", { ok: false, note: String((err as Error)?.message ?? err) });
      return null;
    });
  return cache;
}

type FC = GeoJSON.FeatureCollection;

const props = (b: Barrier) => ({
  id: b.id,
  cls: b.cls,
  loc: b.loc,
  maint: b.maint,
  district: b.district,
  lengthM: b.lengthM,
  widthM: b.widthM,
  areaM2: b.areaM2,
  nSlopes: b.slopes.length,
  nearest: b.slopes[0] ? `${b.slopes[0][0]} · ${b.slopes[0][1]} m` : "",
});

/** Footprint polygons for the map layer. */
export function barrierPolygonFC(d: RealBarrierData): FC {
  return {
    type: "FeatureCollection",
    features: d.all.map((b) => ({ type: "Feature", properties: props(b), geometry: { type: "Polygon", coordinates: [b.ring] } })),
  };
}

/** Centroids for the far-out point rendering (the strips are sub-pixel below zoom ~14). */
export function barrierPointFC(d: RealBarrierData): FC {
  return {
    type: "FeatureCollection",
    features: d.all.map((b) => ({ type: "Feature", properties: props(b), geometry: { type: "Point", coordinates: [b.lon, b.lat] } })),
  };
}

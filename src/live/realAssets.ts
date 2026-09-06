// REAL exposure assets for the twin, from baked government open data (see scripts/build-live-data.mjs):
//   • facilities — HA hospitals, EDB schools & kindergartens, FSD fire stations, police stations, DH clinics
//   • per-slope neighbours — LandsD building blocks within 150 m and the nearest LandsD road centreline
// Population-served and criticality have no published source, so they are kind-based estimates and
// are labelled as such in the UI (`Asset.estimated`).

import type { Asset, AssetKind } from "@/core/types";
import type { Facility } from "@/live/baked/facilities";
import type { SlopeAssets } from "@/live/baked/slopeAssets";
import { reportSource } from "@/core/dataSources";
import { normSlopeNo } from "./csdi";

export interface RealAssetData {
  facilities: Facility[];
  slopeAssets: Record<string, SlopeAssets>;
}

let cache: Promise<RealAssetData | null> | null = null;

/** Lazy-import the two baked chunks; null when either is missing. */
export function loadRealAssets(): Promise<RealAssetData | null> {
  cache ??= Promise.all([import("@/live/baked/facilities"), import("@/live/baked/slopeAssets")])
    .then(([f, s]) => {
      const data = { facilities: f.FACILITIES, slopeAssets: s.SLOPE_ASSETS };
      const kinds = data.facilities.reduce<Record<string, number>>((a, x) => ((a[x.kind] = (a[x.kind] ?? 0) + 1), a), {});
      reportSource("facilities", { ok: true, count: data.facilities.length, note: Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(" · ") });
      reportSource("landsd-neighbours", { ok: true, count: Object.keys(data.slopeAssets).length, note: "slopes with building / road neighbours" });
      return data;
    })
    .catch((err) => {
      reportSource("facilities", { ok: false, note: String((err as Error)?.message ?? err) });
      return null;
    });
  return cache;
}

// indicative service populations & criticality per kind (no open dataset publishes these)
const EST: Record<AssetKind, { served: number; criticality: number }> = {
  hospital: { served: 60_000, criticality: 0.95 },
  clinic: { served: 8_000, criticality: 0.6 },
  school: { served: 800, criticality: 0.7 },
  kindergarten: { served: 150, criticality: 0.65 },
  "fire-station": { served: 40_000, criticality: 0.9 },
  police: { served: 40_000, criticality: 0.75 },
  building: { served: 300, criticality: 0.4 },
  road: { served: 5_000, criticality: 0.5 },
  railway: { served: 20_000, criticality: 0.8 },
  drainage: { served: 2_000, criticality: 0.5 },
  utility: { served: 5_000, criticality: 0.6 },
  "emergency-route": { served: 10_000, criticality: 0.9 },
};

const ROAD_CRIT: Record<string, number> = { Expressway: 0.95, "Trunk Road": 0.9, "Primary Road": 0.8, "Secondary Road": 0.6, "Local Road": 0.45 };
const ROAD_SERVED: Record<string, number> = { Expressway: 80_000, "Trunk Road": 40_000, "Primary Road": 20_000, "Secondary Road": 8_000, "Local Road": 2_000 };

const FAC_KIND: Record<Facility["kind"], AssetKind> = {
  hospital: "hospital",
  school: "school",
  kindergarten: "kindergarten",
  "fire-station": "fire-station",
  police: "police",
  clinic: "clinic",
};

/** Residents in a block from its height: ~3 m per storey, ~8 residents per storey for a residential tower. */
const residentsFromHeight = (heightM: number, type: string | null) => (type && /tower|residential|block/i.test(type) ? Math.round((heightM / 3) * 8) : Math.round((heightM / 3) * 3));

/**
 * Build the asset table and each slope's neighbour list from the baked data.
 * `slopes`: [slope number, centroid lon/lat] of the twin inventory.
 */
export function buildRealAssets(slopes: { id: string; centroid: [number, number] }[], data: RealAssetData): { assets: Asset[]; nearby: Map<string, string[]> } {
  const assets: Asset[] = [];
  const nearby = new Map<string, string[]>();

  // facilities: one asset each, indexed on a ~500 m grid for the per-slope join
  const CELL = 0.005;
  const grid = new Map<string, number[]>();
  data.facilities.forEach((f, i) => {
    const id = `FAC-${i}`;
    const kind = FAC_KIND[f.kind];
    assets.push({ id, kind, name: f.name, location: [f.lon, f.lat], populationServed: EST[kind].served, criticality: EST[kind].criticality, sub: f.sub, real: true, estimated: true });
    const k = `${Math.floor(f.lon / CELL)}:${Math.floor(f.lat / CELL)}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  });

  for (const s of slopes) {
    const key = normSlopeNo(s.id);
    const ids: string[] = [];
    const [lon, lat] = s.centroid;
    const kx = 111_320 * Math.cos((lat * Math.PI) / 180);

    // buildings within 150 m + nearest road (LandsD)
    const near = data.slopeAssets[key];
    if (near) {
      near.b.forEach((b, j) => {
        const [name, type, heightM, distM, blon, blat] = b;
        const id = `BLD-${key}-${j}`;
        assets.push({
          id,
          kind: "building",
          name: name ?? `${type ?? "Building"} block · ${heightM} m`,
          location: [blon, blat],
          populationServed: Math.max(10, residentsFromHeight(heightM, type)),
          criticality: EST.building.criticality,
          sub: type ?? undefined,
          heightM,
          distM,
          real: true,
          estimated: true,
        });
        ids.push(id);
      });
      if (near.r) {
        const [name, type, distM, seg] = near.r;
        const id = `RD-${key}`;
        assets.push({
          id,
          kind: "road",
          name: name ?? `${type ?? "Road"} (unnamed)`,
          location: [(seg[0][0] + seg[1][0]) / 2, (seg[0][1] + seg[1][1]) / 2],
          line: seg,
          populationServed: ROAD_SERVED[type ?? ""] ?? EST.road.served,
          criticality: ROAD_CRIT[type ?? ""] ?? EST.road.criticality,
          sub: type ?? undefined,
          distM,
          real: true,
          estimated: true,
        });
        ids.push(id);
      }
    }

    // facilities within 500 m
    const cx = Math.floor(lon / CELL), cy = Math.floor(lat / CELL);
    const found: { id: string; d: number }[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const i of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
          const f = data.facilities[i];
          const d = Math.hypot((f.lon - lon) * kx, (f.lat - lat) * 111_320);
          if (d <= 500) found.push({ id: `FAC-${i}`, d });
        }
      }
    }
    found.sort((a, b) => a.d - b.d);
    ids.push(...found.slice(0, 5).map((x) => x.id));
    nearby.set(key, ids);
  }
  return { assets, nearby };
}

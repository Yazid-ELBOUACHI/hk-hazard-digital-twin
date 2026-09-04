// Live Hong Kong government data from CSDI (Common Spatial Data Infrastructure,
// portal.csdi.gov.hk). These are REAL datasets served by the CSDI ArcGIS REST API —
// unlike the synthetic twin layers, nothing here is generated.
//
//   Registered Man-made Slopes   CEDD  61k+ polygons (Catalogue of Slopes)
//   Flooding Blackspots          DSD   current blackspot points
//   Landslide Incidents          CEDD  ~11k historical incident points
//
// CSDI sends permissive CORS headers, so the browser talks to the API directly;
// no server proxy or API key is needed. Endpoints discovered via the geoportal
// metadata API (rest/metadata/item/<dataset_id>).

import type { Region } from "@/core/types";

const CSDI = "https://portal.csdi.gov.hk/server/rest/services/common";

const SLOPES_LAYER = `${CSDI}/cedd_rcd_1636517655915_91216/MapServer/0`;
const BLACKSPOTS_LAYER = `${CSDI}/dsd_rcd_1728891975004_392/FeatureServer/0`;
const LANDSLIDES_LAYER = `${CSDI}/cedd_rcd_1640249280153_17521/FeatureServer/0`;

const PAGE = 3000; // server maxRecordCount

export type FC = { type: "FeatureCollection"; features: any[] };
export const EMPTY_FC: FC = { type: "FeatureCollection", features: [] };

function query(layer: string, params: Record<string, string>): Promise<FC> {
  const qs = new URLSearchParams({
    where: "1=1",
    outSR: "4326",
    f: "geojson",
    ...params,
  });
  return fetch(`${layer}/query?${qs}`).then((r) => {
    if (!r.ok) throw new Error(`CSDI ${r.status}`);
    return r.json() as Promise<FC>;
  });
}

// ---------- Registered man-made slopes (viewport-scoped: 61k polygons total) ----------

export interface SlopeBboxResult {
  fc: FC;
  truncated: boolean; // hit the 3000-record page cap for this viewport
}

/** Fetch registered slope polygons intersecting a lon/lat envelope (first 3000). */
export async function fetchSlopesInBbox(w: number, s: number, e: number, n: number): Promise<SlopeBboxResult> {
  const fc = await query(SLOPES_LAYER, {
    geometry: `${w},${s},${e},${n}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "SLOPE_NO,DISTRICT,LOCATION,MAINT_PART,OVERALL_HT,OVERALL_AN,CTL_CAT",
    resultRecordCount: String(PAGE),
  });
  return { fc, truncated: fc.features.length >= PAGE };
}

// ---------- Twin inventory: real slope shells (geometry + registration attributes) ----------
//
// The twin's slope inventory is built from REAL Catalogue-of-Slopes polygons: every registered
// man-made slope of overall height >= 20 m (~4,000 features). Geometry is server-simplified
// (maxAllowableOffset ~3 m) so the whole inventory is ~2 MB over two paged requests.
// Everything hazard-related layered on top (sensors, risk, history) stays synthetic.

/** CEDD district codes -> display name + twin region. */
const DISTRICT_BY_CODE: Record<string, { name: string; region: Region }> = {
  CWD: { name: "Central & Western", region: "HK Island" },
  WCD: { name: "Wan Chai", region: "HK Island" },
  ED: { name: "Eastern", region: "HK Island" },
  SOUD: { name: "Southern", region: "HK Island" },
  YTMD: { name: "Yau Tsim Mong", region: "Kowloon" },
  SSPOD: { name: "Sham Shui Po", region: "Kowloon" },
  KCD: { name: "Kowloon City", region: "Kowloon" },
  WTSD: { name: "Wong Tai Sin", region: "Kowloon" },
  KTD: { name: "Kwun Tong", region: "Kowloon" },
  KWTD: { name: "Kwai Tsing", region: "NT West" },
  TWD: { name: "Tsuen Wan", region: "NT West" },
  TMD: { name: "Tuen Mun", region: "NT West" },
  YLD: { name: "Yuen Long", region: "NT West" },
  ND: { name: "North", region: "NT East" },
  TPD: { name: "Tai Po", region: "NT East" },
  STD: { name: "Sha Tin", region: "NT East" },
  SKD: { name: "Sai Kung", region: "NT East" },
  ISD: { name: "Islands", region: "Lantau" },
};

export interface RealSlopeShell {
  id: string; // registered slope number, e.g. "11SW-A/C 123"
  district: string;
  region: Region;
  location: string;
  maintParty: string;
  heightM: number; // OVERALL_HT (real)
  angleDeg: number; // OVERALL_AN (real, 0 = not recorded)
  areaM2: number;
  polygon: [number, number][]; // outer ring, lon/lat
  centroid: [number, number];
}

const MIN_INVENTORY_HEIGHT_M = 20;

function largestOuterRing(geom: any): [number, number][] | null {
  if (!geom) return null;
  const rings: [number, number][][] =
    geom.type === "Polygon" ? [geom.coordinates[0]] : geom.type === "MultiPolygon" ? geom.coordinates.map((p: any) => p[0]) : [];
  let best: [number, number][] | null = null;
  for (const r of rings) if (r && r.length >= 4 && (!best || r.length > best.length)) best = r;
  return best;
}

/** Fetch the full twin inventory of real slope shells (paged; ordered by feature id). */
export async function fetchRealSlopeShells(): Promise<RealSlopeShell[]> {
  const shells: RealSlopeShell[] = [];
  const seen = new Set<string>();
  for (let offset = 0; ; offset += PAGE) {
    const page = await query(SLOPES_LAYER, {
      where: `OVERALL_HT>=${MIN_INVENTORY_HEIGHT_M}`,
      outFields: "SLOPE_NO,DISTRICT,LOCATION,MAINT_PART,OVERALL_HT,OVERALL_AN,Shape_Area",
      orderByFields: "OBJECTID",
      maxAllowableOffset: "0.00003", // ~3 m: keeps polygon shape, cuts payload ~10x
      resultOffset: String(offset),
      resultRecordCount: String(PAGE),
    });
    for (const f of page.features) {
      const p = f.properties ?? {};
      const ring = largestOuterRing(f.geometry);
      if (!ring) continue;
      const id = String(p.SLOPE_NO ?? "").replace(/\s+/g, " ").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      let cx = 0, cy = 0;
      for (const v of ring) { cx += v[0]; cy += v[1]; }
      const d = DISTRICT_BY_CODE[String(p.DISTRICT ?? "").trim()];
      shells.push({
        id,
        district: d?.name ?? "Hong Kong",
        region: d?.region ?? "NT East",
        location: String(p.LOCATION ?? "").trim(),
        maintParty: String(p.MAINT_PART ?? "").trim(),
        heightM: Number(p.OVERALL_HT) || 0,
        angleDeg: Number(p.OVERALL_AN) || 0,
        areaM2: Math.max(50, Math.round(Number(p.Shape_Area) || 0)),
        polygon: ring as [number, number][],
        centroid: [cx / ring.length, cy / ring.length],
      });
    }
    if (page.features.length < PAGE) break;
    if (offset > 30_000) break; // hard stop, never loop forever
  }
  return shells;
}

// ---------- Flooding blackspots (tiny; fetched whole, cached) ----------

let blackspotsCache: Promise<FC> | null = null;

export function fetchBlackspots(): Promise<FC> {
  blackspotsCache ??= query(BLACKSPOTS_LAYER, { outFields: "*" }).catch((err) => {
    blackspotsCache = null; // allow retry on next toggle
    throw err;
  });
  return blackspotsCache;
}

// ---------- Landslide incidents (~11k points; fetched whole via paging, cached) ----------

let landslidesCache: Promise<FC> | null = null;

async function fetchAllLandslides(): Promise<FC> {
  const features: any[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await query(LANDSLIDES_LAYER, {
      outFields: "INCID,FAILDATE,LOCATION,FEATTYPE,SLOPENUM,SCALE",
      resultOffset: String(offset),
      resultRecordCount: String(PAGE),
    });
    features.push(...page.features);
    if (page.features.length < PAGE) break;
    if (offset > 60_000) break; // hard stop, never loop forever
  }
  return { type: "FeatureCollection", features };
}

export function fetchLandslides(): Promise<FC> {
  landslidesCache ??= fetchAllLandslides().catch((err) => {
    landslidesCache = null;
    throw err;
  });
  return landslidesCache;
}

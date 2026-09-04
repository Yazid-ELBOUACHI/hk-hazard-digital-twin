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

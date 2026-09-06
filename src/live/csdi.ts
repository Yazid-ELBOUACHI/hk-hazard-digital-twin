// Live Hong Kong government data from CSDI (Common Spatial Data Infrastructure,
// portal.csdi.gov.hk). These are REAL datasets served by the CSDI ArcGIS REST API —
// unlike the synthetic twin layers, nothing here is generated.
//
//   Registered Man-made Slopes        CEDD  61k+ polygons (Catalogue of Slopes)
//   LPMitP works programme            CEDD  386 substandard slopes + 113 hillside catchments under upgrading contracts
//   Flooding Blackspots               DSD   current blackspot points
//   Landslide Incidents               CEDD  ~11k historical incident points
//   Natural Terrain Landslides        CEDD  ENTLI: 113k crowns + 113k runout trails (1924–2023)
//
// CSDI sends permissive CORS headers, so the browser talks to the API directly; no server proxy
// or API key is needed. Endpoints discovered via the geoportal metadata API
// (rest/metadata/item/<dataset_id>). Every loader reports to the Data Sources registry.

import type { Region } from "@/core/types";
import { reportSource } from "@/core/dataSources";

const CSDI = "https://portal.csdi.gov.hk/server/rest/services/common";

const SLOPES_LAYER = `${CSDI}/cedd_rcd_1636517655915_91216/MapServer/0`;
const BLACKSPOTS_LAYER = `${CSDI}/dsd_rcd_1728891975004_392/FeatureServer/0`;
const LANDSLIDES_LAYER = `${CSDI}/cedd_rcd_1640249280153_17521/FeatureServer/0`;
const LPM_SLOPES_LAYER = `${CSDI}/cedd_rcd_1636520198665_14775/FeatureServer/0`;
const LPM_CATCHMENTS_LAYER = `${CSDI}/cedd_rcd_1636520077654_856/FeatureServer/0`;
const ENTLI_CROWN_LAYER = `${CSDI}/cedd_rcd_1636520697377_96152/FeatureServer/0`;
const ENTLI_TRAIL_LAYER = `${CSDI}/cedd_rcd_1636520697377_96152/FeatureServer/1`;
const ROADS_LAYER = `${CSDI}/landsd_rcd_1637310758814_80061/MapServer/0`;

const PAGE = 3000; // server maxRecordCount

export type FC = { type: "FeatureCollection"; features: any[] };
export const EMPTY_FC: FC = { type: "FeatureCollection", features: [] };

// Boot-time datasets (inventory pages, LPM programme) are kept in the browser's Cache Storage for a
// day: a repeat visit boots from disk in well under a second instead of re-downloading ~2 MB.
const CACHE_NAME = "hkdt-csdi-v1";
const DAY_MS = 24 * 3600_000;
let cacheHits = 0;

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches !== "undefined" ? await caches.open(CACHE_NAME) : null;
  } catch {
    return null;
  }
}

/** One ArcGIS REST query; the portal occasionally answers a transient 404/5xx, so retry twice with backoff. */
async function query(layer: string, params: Record<string, string>, tries = 3, cacheTtlMs = 0): Promise<FC> {
  const qs = new URLSearchParams({
    where: "1=1",
    outSR: "4326",
    f: "geojson",
    ...params,
  });
  const url = `${layer}/query?${qs}`;
  const cache = cacheTtlMs > 0 ? await openCache() : null;
  if (cache) {
    const hit = await cache.match(url).catch(() => undefined);
    if (hit && Date.now() - Number(hit.headers.get("x-cached-at") ?? 0) < cacheTtlMs) {
      cacheHits++;
      return (await hit.json()) as FC;
    }
  }
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`CSDI ${r.status}`);
      const text = await r.text();
      const j = JSON.parse(text) as FC & { error?: { message?: string } };
      if (j.error) throw new Error(`CSDI: ${j.error.message ?? "query error"}`);
      if (cache) {
        void cache
          .put(url, new Response(text, { headers: { "content-type": "application/json", "x-cached-at": String(Date.now()) } }))
          .catch(() => undefined);
      }
      return j;
    } catch (err) {
      lastErr = err;
      if (i < tries - 1) await new Promise((res) => setTimeout(res, 600 * (i + 1)));
    }
  }
  throw lastErr;
}

/** Slope-number key shared by every CEDD dataset: whitespace removed, upper-case ("11SW-A/C 123" → "11SW-A/C123"). */
export function normSlopeNo(s: string | null | undefined): string {
  return String(s ?? "").replace(/\s+/g, "").toUpperCase();
}

const bboxParams = (w: number, s: number, e: number, n: number) => ({
  geometry: `${w},${s},${e},${n}`,
  geometryType: "esriGeometryEnvelope",
  inSR: "4326",
  spatialRel: "esriSpatialRelIntersects",
});

// ---------- Registered man-made slopes (viewport-scoped: 61k polygons total) ----------

export interface SlopeBboxResult {
  fc: FC;
  truncated: boolean; // hit the 3000-record page cap for this viewport
}

/** Fetch registered slope polygons intersecting a lon/lat envelope (first 3000). */
export async function fetchSlopesInBbox(w: number, s: number, e: number, n: number): Promise<SlopeBboxResult> {
  const fc = await query(SLOPES_LAYER, {
    ...bboxParams(w, s, e, n),
    outFields: "SLOPE_NO,DISTRICT,LOCATION,MAINT_PART,OVERALL_HT,OVERALL_AN,CTL_CAT",
    resultRecordCount: String(PAGE),
  });
  return { fc, truncated: fc.features.length >= PAGE };
}

// ---------- Twin inventory: real slope shells (geometry + registration attributes) ----------
//
// The twin's slope inventory is built from REAL Catalogue-of-Slopes polygons: every registered
// man-made slope of overall height >= 20 m (~4,000 features), plus every slope in the LPM works
// programme regardless of height. Geometry is server-simplified (maxAllowableOffset ~3 m) so the
// whole inventory is ~2 MB over two paged requests. Everything hazard-related layered on top
// (sensors, risk) stays synthetic; works, census and incident context joined later are real.

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
const SHELL_FIELDS = "SLOPE_NO,DISTRICT,LOCATION,MAINT_PART,OVERALL_HT,OVERALL_AN,Shape_Area";

function largestOuterRing(geom: any): [number, number][] | null {
  if (!geom) return null;
  const rings: [number, number][][] =
    geom.type === "Polygon" ? [geom.coordinates[0]] : geom.type === "MultiPolygon" ? geom.coordinates.map((p: any) => p[0]) : [];
  let best: [number, number][] | null = null;
  for (const r of rings) if (r && r.length >= 4 && (!best || r.length > best.length)) best = r;
  return best;
}

function shellFromFeature(f: any): RealSlopeShell | null {
  const p = f.properties ?? {};
  const ring = largestOuterRing(f.geometry);
  if (!ring) return null;
  const id = String(p.SLOPE_NO ?? "").replace(/\s+/g, " ").trim();
  if (!id) return null;
  let cx = 0, cy = 0;
  for (const v of ring) { cx += v[0]; cy += v[1]; }
  const d = DISTRICT_BY_CODE[String(p.DISTRICT ?? "").trim()];
  return {
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
  };
}

/**
 * Fetch the full twin inventory of real slope shells (paged; ordered by feature id), then add any
 * `extraSlopeNos` (e.g. the LPM works programme) that the height filter did not already include.
 */
export async function fetchRealSlopeShells(extraSlopeNos: string[] = []): Promise<RealSlopeShell[]> {
  const shells: RealSlopeShell[] = [];
  const seen = new Set<string>();
  const push = (f: any) => {
    const sh = shellFromFeature(f);
    if (!sh || seen.has(normSlopeNo(sh.id))) return;
    seen.add(normSlopeNo(sh.id));
    shells.push(sh);
  };
  const pageAt = (offset: number) =>
    query(
      SLOPES_LAYER,
      {
        where: `OVERALL_HT>=${MIN_INVENTORY_HEIGHT_M}`,
        outFields: SHELL_FIELDS,
        orderByFields: "OBJECTID",
        maxAllowableOffset: "0.00003", // ~3 m: keeps polygon shape, cuts payload ~10x
        resultOffset: String(offset),
        resultRecordCount: String(PAGE),
      },
      3,
      DAY_MS
    );
  // the inventory is ~4,000 features = two pages: fetch both at once, then keep paging only if the second was full
  const first = await Promise.all([pageAt(0), pageAt(PAGE)]);
  first.forEach((p) => p.features.forEach(push));
  let last = first[1];
  for (let offset = 2 * PAGE; last.features.length >= PAGE && offset <= 30_000; offset += PAGE) {
    last = await pageAt(offset);
    last.features.forEach(push);
  }
  const tall = shells.length;

  // slopes referenced by another dataset but below the height cut — fetched by exact slope number
  const missing = [...new Set(extraSlopeNos.map((s) => s.trim()))].filter((s) => s && !seen.has(normSlopeNo(s)));
  const BATCH = 40; // keeps the IN(...) URL ~1 KB; longer lists intermittently 404 at the portal
  const batches: Promise<FC>[] = [];
  for (let i = 0; i < missing.length; i += BATCH) {
    const list = missing.slice(i, i + BATCH).map((s) => `'${s.replace(/'/g, "''")}'`).join(",");
    batches.push(query(SLOPES_LAYER, { where: `SLOPE_NO IN (${list})`, outFields: SHELL_FIELDS, maxAllowableOffset: "0.00003" }, 3, DAY_MS));
  }
  // a failed batch must not cost us the whole real inventory — keep what we have and say so
  const settled = await Promise.allSettled(batches);
  let failedBatches = 0;
  for (const r of settled) {
    if (r.status === "fulfilled") r.value.features.forEach(push);
    else {
      failedBatches++;
      console.warn("CSDI LPM slope batch failed:", r.reason);
    }
  }

  reportSource("cedd-slopes", {
    ok: true,
    count: shells.length,
    note: `${tall.toLocaleString()} slopes ≥ ${MIN_INVENTORY_HEIGHT_M} m + ${(shells.length - tall).toLocaleString()} from the LPM programme${failedBatches ? ` (${failedBatches} LPM batch${failedBatches > 1 ? "es" : ""} failed)` : ""}${cacheHits ? " · served from the 24-h browser cache" : ""}`,
  });
  return shells;
}

// ---------- LPMitP works programme (small; fetched whole at boot, cached) ----------

export interface LpmWork {
  kind: "slope" | "catchment";
  slopeNo: string; // as published, e.g. "10NE-B/C  314"
  key: string; // normSlopeNo(slopeNo)
  location: string;
  district: string;
  contract: string;
  startLabel: string; // "3rd Qtr of 2025"
  completionLabel: string;
}

export interface LpmWorks {
  slopes: LpmWork[];
  catchments: LpmWork[];
  fc: FC; // polygons of both, with `kind` and the fields above as properties
}

/** "3rd Qtr of 2025" → ISO date of the quarter's first day (null when unparseable). */
export function quarterLabelToIso(label: string | null | undefined): string | null {
  const m = String(label ?? "").match(/(\d)(?:st|nd|rd|th)\s+Qtr\s+of\s+(\d{4})/i);
  if (!m) return null;
  const q = Number(m[1]);
  if (q < 1 || q > 4) return null;
  return `${m[2]}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`;
}

let lpmCache: Promise<LpmWorks> | null = null;

async function fetchLpmWorksUncached(): Promise<LpmWorks> {
  const [slopesFc, catchFc] = await Promise.all([
    query(
      LPM_SLOPES_LAYER,
      {
        outFields: "LPMWORKS_SLOPE_NUM,LPMWORKS_LOCATION,LPMWORKS_D_BOARD2,LPMWORKS_CONTRACT,LPMWORKS_DATE_START_E,LPMWORKS_DATE_COMP_E",
        maxAllowableOffset: "0.00003",
      },
      3,
      DAY_MS
    ),
    query(
      LPM_CATCHMENTS_LAYER,
      {
        outFields: "SA_FEATURE,ST_LOCATIO,ST_DISTRIC,WC_CONTRAC,DATE_START,DATE_COMP_",
        maxAllowableOffset: "0.00005",
      },
      3,
      DAY_MS
    ),
  ]);
  const slopes: LpmWork[] = [];
  const catchments: LpmWork[] = [];
  const features: any[] = [];
  for (const f of slopesFc.features) {
    const p = f.properties ?? {};
    const w: LpmWork = {
      kind: "slope",
      slopeNo: String(p.LPMWORKS_SLOPE_NUM ?? "").trim(),
      key: normSlopeNo(p.LPMWORKS_SLOPE_NUM),
      location: String(p.LPMWORKS_LOCATION ?? "").trim(),
      district: String(p.LPMWORKS_D_BOARD2 ?? "").trim(),
      contract: String(p.LPMWORKS_CONTRACT ?? "").trim(),
      startLabel: String(p.LPMWORKS_DATE_START_E ?? "").trim(),
      completionLabel: String(p.LPMWORKS_DATE_COMP_E ?? "").trim(),
    };
    if (!w.key) continue;
    slopes.push(w);
    features.push({ type: "Feature", geometry: f.geometry, properties: { ...w } });
  }
  for (const f of catchFc.features) {
    const p = f.properties ?? {};
    const w: LpmWork = {
      kind: "catchment",
      slopeNo: String(p.SA_FEATURE ?? "").trim(),
      key: normSlopeNo(p.SA_FEATURE),
      location: String(p.ST_LOCATIO ?? "").trim(),
      district: String(p.ST_DISTRIC ?? "").trim(),
      contract: String(p.WC_CONTRAC ?? "").trim(),
      startLabel: String(p.DATE_START ?? "").trim(),
      completionLabel: String(p.DATE_COMP_ ?? "").trim(),
    };
    catchments.push(w);
    features.push({ type: "Feature", geometry: f.geometry, properties: { ...w } });
  }
  reportSource("cedd-lpm", { ok: true, count: slopes.length + catchments.length, note: `${slopes.length} slopes · ${catchments.length} catchments` });
  return { slopes, catchments, fc: { type: "FeatureCollection", features } };
}

export function fetchLpmWorks(): Promise<LpmWorks> {
  lpmCache ??= fetchLpmWorksUncached().catch((err) => {
    lpmCache = null; // allow retry
    reportSource("cedd-lpm", { ok: false, note: String(err?.message ?? err) });
    throw err;
  });
  return lpmCache;
}

// ---------- Flooding blackspots (tiny; fetched whole, cached) ----------

let blackspotsCache: Promise<FC> | null = null;

export function fetchBlackspots(): Promise<FC> {
  blackspotsCache ??= query(BLACKSPOTS_LAYER, { outFields: "*" })
    .then((fc) => {
      reportSource("dsd-blackspots", { ok: true, count: fc.features.length });
      return fc;
    })
    .catch((err) => {
      blackspotsCache = null; // allow retry on next toggle
      reportSource("dsd-blackspots", { ok: false, note: String(err?.message ?? err) });
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
  reportSource("cedd-incidents-map", { ok: true, count: features.length });
  return { type: "FeatureCollection", features };
}

export function fetchLandslides(): Promise<FC> {
  landslidesCache ??= fetchAllLandslides().catch((err) => {
    landslidesCache = null;
    reportSource("cedd-incidents-map", { ok: false, note: String(err?.message ?? err) });
    throw err;
  });
  return landslidesCache;
}

// ---------- ENTLI natural terrain landslides (226k features; viewport-scoped) ----------

export interface EntliBboxResult {
  crowns: FC;
  trails: FC;
  truncated: boolean;
}

/** Crowns (points) and runout trails (lines) intersecting an envelope — first 3000 of each. */
export async function fetchEntliInBbox(w: number, s: number, e: number, n: number): Promise<EntliBboxResult> {
  const [crowns, trails] = await Promise.all([
    query(ENTLI_CROWN_LAYER, {
      ...bboxParams(w, s, e, n),
      outFields: "ENTLI_NO,SLIDE_TYPE,YEAR_1,M_WIDTH,S_LENGTH,SLOPE,ELE_DIFF,CLASS",
      resultRecordCount: String(PAGE),
    }),
    query(ENTLI_TRAIL_LAYER, {
      ...bboxParams(w, s, e, n),
      outFields: "ENTLI_NO,SLIDE_TYPE,YEAR_1,S_LENGTH",
      maxAllowableOffset: "0.00003",
      resultRecordCount: String(PAGE),
    }),
  ]);
  const truncated = crowns.features.length >= PAGE || trails.features.length >= PAGE;
  reportSource("cedd-entli-live", { ok: true, count: crowns.features.length, note: `${crowns.features.length} crowns · ${trails.features.length} trails in view${truncated ? " (capped at 3,000 — zoom in)" : ""}` });
  return { crowns, trails, truncated };
}

// ---------- LandsD road centrelines (40k lines; viewport-scoped, zoom ≥ 13) ----------

export async function fetchRoadsInBbox(w: number, s: number, e: number, n: number): Promise<{ fc: FC; truncated: boolean }> {
  const fc = await query(ROADS_LAYER, {
    ...bboxParams(w, s, e, n),
    outFields: "ENGLISHSTREETNAME,STREETTYPE",
    maxAllowableOffset: "0.00005",
    resultRecordCount: String(PAGE),
  });
  const truncated = fc.features.length >= PAGE;
  reportSource("landsd-roads", { ok: true, count: fc.features.length, note: `${fc.features.length} centrelines in view${truncated ? " (capped)" : ""}` });
  return { fc, truncated };
}

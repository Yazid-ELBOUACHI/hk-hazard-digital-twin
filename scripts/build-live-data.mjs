// Bakes compact REAL Hong Kong government datasets (CSDI + HKO) into the bundle, so the twin
// can use them at boot without heavy live queries. Everything here is real open data — nothing
// synthetic is derived in this script.
//
//   node scripts/build-live-data.mjs            # bake everything
//   node scripts/build-live-data.mjs rain entli # bake a subset (census | rain | entli | hko | facilities | assets | barriers)
//
// Outputs (all GENERATED, do not edit):
//   src/live/baked/census.ts          2021 Population Census small-TPU polygons: population, age bands, households
//   src/live/baked/gauges.ts          GEO raingauge list (id, name, lon, lat, years) — small, loaded at boot
//   src/live/baked/rainfall.ts        GEO raingauge network 1984→present: gauges, per-gauge annual/monthly totals,
//                                     territory daily max/mean series, landslide incidents per day, top storms
//   src/live/baked/slopeIncidents.ts  CEDD landslide incidents cross-referenced to a registered slope number
//   src/live/baked/entliGrid.ts       Enhanced Natural Terrain Landslide Inventory density on a 250 m grid
//   src/live/baked/hkoStations.json   HKO automatic rain-gauge stations (id, name, lon, lat) for the live feed
//   src/live/baked/facilities.ts      Real facilities: HA hospitals, EDB schools & kindergartens, FSD fire stations,
//                                     police stations, DH clinics (point, name, address)
//   src/live/baked/slopeAssets.ts     Per registered slope: LandsD building blocks within 150 m and the nearest
//                                     LandsD road centreline (name, type, distance, a short segment)
//   src/live/baked/barriers.ts        CEDD natural terrain hazard mitigation measures: every ND (defence: debris-
//                                     resisting barriers, check dams, bunds, boulder fences) and NS (stabilisation)
//                                     feature in the Catalogue of Slopes, with footprint, long axis and nearby slopes
//
// Raw downloads are cached in scripts/.cache/ (gitignored) so re-runs are fast.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CACHE = path.join(__dirname, ".cache");
const OUT = path.join(ROOT, "src", "live", "baked");
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const CSDI = "https://portal.csdi.gov.hk/server/rest/services/common";
const LAYER = {
  census: `${CSDI}/censtatd_rcd_1635933193720_58660/FeatureServer/0`, // 2021 Census, small TPU groups
  raingauge: `${CSDI}/cedd_rcd_1636517963140_47030/FeatureServer/0`, // GEO raingauge daily data
  incidents: `${CSDI}/cedd_rcd_1640249280153_17521/FeatureServer/0`, // landslide incidents
  entliCrown: `${CSDI}/cedd_rcd_1636520697377_96152/FeatureServer/0`, // ENTLI crowns (points)
  hkoAws: `${CSDI}/hko_rcd_1666097185091_14408/FeatureServer/0`, // HKO AWS rainfall stations
  slopes: `${CSDI}/cedd_rcd_1636517655915_91216/MapServer/0`, // Catalogue of Slopes
  lpmSlopes: `${CSDI}/cedd_rcd_1636520198665_14775/FeatureServer/0`, // LPMitP slopes
  buildings: `${CSDI}/landsd_rcd_1637211194312_35158/MapServer/0`, // LandsD building blocks (342k)
  roads: `${CSDI}/landsd_rcd_1637310758814_80061/MapServer/0`, // LandsD road centrelines (40k)
};
// Real facilities: [kind, subtype, dataset id, name field, address field]
const FACILITY_LAYERS = [
  ["hospital", "Hospital Authority hospital", "fhb_rcd_1637028364270_14638", "NAME_EN", "ADDRESS_EN"],
  ["fire-station", "Fire station", "hkfsd_rcd_1634798867463_89696", "Name_ENG", "Address_ENG"],
  ["police", "Police station", "police_rcd_1639562064290_95464", "NAME_EN", "ADDRESS_EN"],
  ["clinic", "DH clinic / health centre", "dh_rcd_1629267205213_98466", "NameEN", "AddressEN"],
  ["school", "Government primary", "edb_rcd_1629267205213_74992", "NAME_EN", "ADDRESS_EN"],
  ["school", "Government secondary", "edb_rcd_1629267205213_92681", "NAME_EN", "ADDRESS_EN"],
  ["school", "Aided primary", "edb_rcd_1629267205213_6391", "NAME_EN", "ADDRESS_EN"],
  ["school", "Aided secondary", "edb_rcd_1629267205213_53323", "NAME_EN", "ADDRESS_EN"],
  ["school", "DSS primary", "edb_rcd_1629267205213_77942", "NAME_EN", "ADDRESS_EN"],
  ["school", "DSS secondary", "edb_rcd_1629267205213_87907", "NAME_EN", "ADDRESS_EN"],
  ["school", "Caput secondary", "edb_rcd_1629267205213_94310", "NAME_EN", "ADDRESS_EN"],
  ["school", "Private primary", "edb_rcd_1629267205213_95112", "NAME_EN", "ADDRESS_EN"],
  ["school", "Private secondary", "edb_rcd_1629267205213_23500", "NAME_EN", "ADDRESS_EN"],
  ["school", "International primary", "edb_rcd_1629267205213_1928", "NAME_EN", "ADDRESS_EN"],
  ["school", "International secondary", "edb_rcd_1629267205213_63457", "NAME_EN", "ADDRESS_EN"],
  ["school", "ESF primary", "edb_rcd_1629267205213_10118", "NAME_EN", "ADDRESS_EN"],
  ["school", "ESF secondary", "edb_rcd_1629267205213_1378", "NAME_EN", "ADDRESS_EN"],
  ["school", "Aided special", "edb_rcd_1629267205213_7733", "NAME_EN", "ADDRESS_EN"],
  ["kindergarten", "Kindergarten", "edb_rcd_1629267205213_46994", "NAME_EN", "ADDRESS_EN"],
];
const HKO_HOURLY = "https://data.weather.gov.hk/weatherAPI/opendata/hourlyRainfall.php?lang=en";

const only = new Set(process.argv.slice(2));
const want = (k) => only.size === 0 || only.has(k);
const stamp = new Date().toISOString().slice(0, 10);

// ---------- http ----------

async function getJson(url, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "hk-hazard-twin-bake/1.0" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (j.error) throw new Error(`ArcGIS: ${JSON.stringify(j.error).slice(0, 200)}`);
      return j;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

function query(layer, params) {
  const qs = new URLSearchParams({ where: "1=1", f: "json", outSR: "4326", ...params });
  return getJson(`${layer}/query?${qs}`);
}

async function count(layer, where = "1=1") {
  return (await query(layer, { where, returnCountOnly: "true" })).count;
}

/** Page through a whole layer (3,000 records per page), several pages in flight. */
async function pageAll(layer, params, label, concurrency = 6, page = 3000) {
  const n = await count(layer, params.where ?? "1=1");
  const offsets = [];
  for (let o = 0; o < n; o += page) offsets.push(o);
  const out = new Array(offsets.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < offsets.length) {
      const k = next++;
      const r = await query(layer, { ...params, orderByFields: "OBJECTID", resultOffset: String(offsets[k]), resultRecordCount: String(page) });
      out[k] = r.features;
      done++;
      if (done % 10 === 0 || done === offsets.length) process.stdout.write(`\r  ${label}: ${done}/${offsets.length} pages (${n.toLocaleString()} rows)`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  process.stdout.write("\n");
  return out.flat();
}

async function cached(name, fn) {
  const p = path.join(CACHE, `${name}.json`);
  if (fs.existsSync(p)) {
    console.log(`  (cache) ${name}`);
    return JSON.parse(fs.readFileSync(p, "utf8"));
  }
  const v = await fn();
  fs.writeFileSync(p, JSON.stringify(v));
  return v;
}

// ---------- helpers ----------

const r5 = (x) => Math.round(x * 1e5) / 1e5;
const b64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString("base64");
const writeTs = (file, header, body) => {
  const p = path.join(OUT, file);
  fs.writeFileSync(p, `// GENERATED by scripts/build-live-data.mjs on ${stamp} — do not edit.\n${header}\n\n${body}\n`);
  console.log(`  wrote ${path.relative(ROOT, p)} (${(fs.statSync(p).size / 1024).toFixed(0)} KB)`);
};

// ---------- 1. Census 2021 small TPU groups ----------

async function bakeCensus() {
  console.log("Census 2021 (C&SD small TPU groups)");
  const g = await cached("census", () =>
    query(LAYER.census, {
      outFields: "stpug_eng,t_pop,age_1,age_2,age_3,age_4,age_5,dh,Shape__Area",
      returnGeometry: "true",
      maxAllowableOffset: "0.0005", // ≈ 50 m: polygons are km-scale, plenty for point-in-polygon
      f: "geojson",
    })
  );
  const units = g.features.map((f) => {
    const p = f.properties;
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const rings = polys.map((poly) => poly[0].map(([x, y]) => [r5(x), r5(y)])); // outer rings only
    let bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (const ring of rings) for (const [x, y] of ring) bb = [Math.min(bb[0], x), Math.min(bb[1], y), Math.max(bb[2], x), Math.max(bb[3], y)];
    return {
      code: String(p.stpug_eng),
      pop: Math.round(p.t_pop || 0),
      age: [1, 2, 3, 4, 5].map((i) => Math.round(p[`age_${i}`] || 0)), // 0–14, 15–24, 25–44, 45–64, 65+
      hh: Math.round(p.dh || 0),
      areaM2: Math.round(p.Shape__Area),
      bbox: bb.map(r5),
      rings,
    };
  });
  const total = units.reduce((s, u) => s + u.pop, 0);
  console.log(`  ${units.length} units · population ${total.toLocaleString()}`);
  const stats = { units: units.length, population: total };
  writeTs(
    "census.ts",
    `// 2021 Population Census — Statistics and Boundaries of Small Tertiary Planning Unit Groups (C&SD via CSDI).
// ${units.length} polygons (outer rings, ≈50 m simplified) with total population, five age bands
// (0–14, 15–24, 25–44, 45–64, 65+) and domestic households. Territory total ${total.toLocaleString()}.

export interface CensusUnit {
  code: string;
  pop: number;
  age: [number, number, number, number, number];
  hh: number;
  areaM2: number;
  bbox: [number, number, number, number];
  rings: [number, number][][];
}`,
    `export const CENSUS_UNITS: CensusUnit[] = ${JSON.stringify(units)};`
  );
  return stats;
}

// ---------- 2. GEO raingauge network + landslide incidents ----------

const EPOCH_YEAR = 1984;
const EPOCH_MS = Date.UTC(EPOCH_YEAR, 0, 1);
const dayOf = (yyyymmdd) => (Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8)) - EPOCH_MS) / 86400_000;

async function fetchGauges() {
  const stats = JSON.stringify([
    { statisticType: "count", onStatisticField: "OBJECTID", outStatisticFieldName: "n" },
    { statisticType: "min", onStatisticField: "Date_", outStatisticFieldName: "d0" },
    { statisticType: "max", onStatisticField: "Date_", outStatisticFieldName: "d1" },
  ]);
  const grp = await query(LAYER.raingauge, { outStatistics: stats, groupByFieldsForStatistics: "Raingauge_No,Location", returnGeometry: "false" });
  const rows = grp.features.map((f) => f.attributes).sort((a, b) => a.Raingauge_No.localeCompare(b.Raingauge_No));
  const out = [];
  let i = 0;
  const worker = async () => {
    while (i < rows.length) {
      const r = rows[i++];
      const g = await query(LAYER.raingauge, { where: `Raingauge_No='${r.Raingauge_No}'`, outFields: "Raingauge_No", resultRecordCount: "1", f: "geojson" });
      const c = g.features[0]?.geometry?.coordinates ?? [0, 0];
      out.push({ id: r.Raingauge_No, name: r.Location, lon: r5(c[0]), lat: r5(c[1]), from: +r.d0.slice(0, 4), to: +r.d1.slice(0, 4) });
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

async function bakeRain() {
  console.log("GEO raingauge daily data 1984→present");
  const gauges = await cached("gauges", fetchGauges);
  const rows = await cached("raingauge", async () =>
    (await pageAll(LAYER.raingauge, { outFields: "Date_,Raingauge_No,Rainfall", returnGeometry: "false" }, "raingauge")).map((f) => [
      f.attributes.Date_,
      f.attributes.Raingauge_No,
      f.attributes.Rainfall,
    ])
  );
  const incidents = await cached("incidents", () =>
    pageAll(LAYER.incidents, { outFields: "INCID,FAILDATE,SLOPENUM,FEATTYPE,SCALE", returnGeometry: "false" }, "landslide incidents")
  );

  const gIdx = new Map(gauges.map((g, i) => [g.id, i]));
  const nG = gauges.length;
  let lastDate = "19840101";
  for (const [d] of rows) if (d > lastDate) lastDate = d;
  const nD = dayOf(lastDate) + 1;
  const nY = +lastDate.slice(0, 4) - EPOCH_YEAR + 1;
  const nM = nY * 12;

  const annualMax = new Uint16Array(nG * nY); // mm ×10
  const annualTotal = new Uint16Array(nG * nY); // mm
  const monthly = new Uint16Array(nG * nM); // mm ×10
  const dayMax = new Uint16Array(nD); // mm ×10
  const dayMaxGauge = new Uint8Array(nD);
  const daySum = new Float64Array(nD);
  const dayN = new Uint8Array(nD);
  let valid = 0;
  for (const [d, gid, rain] of rows) {
    const v = parseFloat(rain);
    if (!Number.isFinite(v) || v < 0) continue; // '***' = no record
    const g = gIdx.get(gid);
    if (g === undefined) continue;
    valid++;
    const day = dayOf(d);
    const y = +d.slice(0, 4) - EPOCH_YEAR;
    const m = y * 12 + (+d.slice(4, 6) - 1);
    const v10 = Math.min(65535, Math.round(v * 10));
    if (v10 > annualMax[g * nY + y]) annualMax[g * nY + y] = v10;
    annualTotal[g * nY + y] = Math.min(65535, annualTotal[g * nY + y] + Math.round(v));
    monthly[g * nM + m] = Math.min(65535, monthly[g * nM + m] + v10);
    if (v10 > dayMax[day]) { dayMax[day] = v10; dayMaxGauge[day] = g; }
    daySum[day] += v;
    dayN[day]++;
  }
  const dayMean = new Uint16Array(nD);
  for (let i = 0; i < nD; i++) if (dayN[i]) dayMean[i] = Math.round((daySum[i] / dayN[i]) * 10);

  // landslide incidents per day (FAILDATE is HK midnight expressed in UTC → +8 h gives the HK calendar day)
  const dayIncidents = new Uint16Array(nD);
  let dated = 0;
  for (const f of incidents) {
    const ms = f.attributes.FAILDATE;
    if (typeof ms !== "number") continue;
    const day = Math.floor((ms + 8 * 3600_000 - EPOCH_MS) / 86400_000);
    if (day >= 0 && day < nD) { dayIncidents[day]++; dated++; }
  }

  // top storm days by territory maximum
  const storms = [...dayMax.keys()]
    .filter((d) => dayMax[d] > 0)
    .sort((a, b) => dayMax[b] - dayMax[a])
    .slice(0, 40)
    .map((d) => ({ d, maxX10: dayMax[d], gauge: dayMaxGauge[d], meanX10: dayMean[d], incidents: dayIncidents[d] }));

  // per-gauge totals on the storm days, so the twin can replay each storm through its risk chain (validation)
  const stormIdx = new Map(storms.map((s, k) => [s.d, k]));
  const stormGauge = new Uint16Array(storms.length * nG); // mm ×10, 0 = no record
  for (const [d, gid, rain] of rows) {
    const k = stormIdx.get(dayOf(d));
    if (k === undefined) continue;
    const v = parseFloat(rain);
    const g = gIdx.get(gid);
    if (!Number.isFinite(v) || v < 0 || g === undefined) continue;
    stormGauge[k * nG + g] = Math.min(65535, Math.round(v * 10));
  }
  console.log(`  ${nG} gauges · ${valid.toLocaleString()} valid daily values · ${nD} days to ${lastDate} · ${dated.toLocaleString()} dated incidents`);
  console.log(`  wettest day: ${new Date(EPOCH_MS + storms[0].d * 86400_000).toISOString().slice(0, 10)} ${storms[0].maxX10 / 10} mm at ${gauges[storms[0].gauge].name}`);

  writeTs(
    "rainfall.ts",
    `// GEO Raingauge Data (CEDD via CSDI): ${nG} gauges, daily totals ${EPOCH_YEAR}-01-01 → ${lastDate.replace(/(\\d{4})(\\d{2})(\\d{2})/, "$1-$2-$3")},
// ${valid.toLocaleString()} valid readings. Plus CEDD landslide incidents per day (${dated.toLocaleString()} dated incidents).
// Base64 typed arrays; decode with src/live/baked/decode.ts. Day index 0 = ${EPOCH_YEAR}-01-01 (HK calendar days).
//   annualMaxX10[g*years+y]   wettest day of the year at gauge g, mm ×10
//   annualTotalMm[g*years+y]  annual total at gauge g, mm
//   monthlyX10[g*years*12+m]  monthly total at gauge g, mm ×10
//   dayMaxX10[d] / dayMeanX10[d] / dayGauges[d]   territory max, mean and number of reporting gauges, per day
//   dayIncidents[d]           landslide incidents reported on that day (CEDD incident database)
//   stormGaugeX10[k*gauges+g] daily total at gauge g on the k-th storm day of \`storms\`, mm ×10 (0 = no record)

export interface RainGauge { id: string; name: string; lon: number; lat: number; from: number; to: number }
export interface StormDay { d: number; maxX10: number; gauge: number; meanX10: number; incidents: number }
export interface RainfallBake {
  epochYear: number; years: number; days: number; lastDate: string;
  gauges: RainGauge[];
  annualMaxX10: string; annualTotalMm: string; monthlyX10: string;
  dayMaxX10: string; dayMeanX10: string; dayGauges: string; dayIncidents: string;
  storms: StormDay[];
  stormGaugeX10: string;
}`,
    `export const RAINFALL: RainfallBake = ${JSON.stringify({
      epochYear: EPOCH_YEAR, years: nY, days: nD, lastDate,
      gauges,
      annualMaxX10: b64(annualMax), annualTotalMm: b64(annualTotal), monthlyX10: b64(monthly),
      dayMaxX10: b64(dayMax), dayMeanX10: b64(dayMean), dayGauges: b64(dayN), dayIncidents: b64(dayIncidents),
      storms,
      stormGaugeX10: b64(stormGauge),
    })};`
  );

  // gauge list on its own (8 KB) so the boot path can find each slope's nearest gauge without the big chunk
  writeTs(
    "gauges.ts",
    `// GEO raingauge network (CEDD via CSDI): ${nG} gauges with location and years of record. Same list as rainfall.ts.

export interface RainGaugeMeta { id: string; name: string; lon: number; lat: number; from: number; to: number }`,
    `export const RAIN_GAUGES: RainGaugeMeta[] = ${JSON.stringify(gauges)};`
  );

  // incidents cross-referenced to a registered slope number → per-slope real failure history
  const bySlope = {};
  let linked = 0;
  for (const f of incidents) {
    const a = f.attributes;
    const key = String(a.SLOPENUM ?? "").replace(/\s+/g, "").toUpperCase();
    if (!key || key === "-") continue;
    const ms = a.FAILDATE;
    const day = typeof ms === "number" ? Math.floor((ms + 8 * 3600_000 - EPOCH_MS) / 86400_000) : -1;
    const vol = parseFloat(a.SCALE);
    (bySlope[key] ??= []).push([day, Number.isFinite(vol) ? Math.round(vol * 100) / 100 : -1, String(a.INCID ?? "")]);
    linked++;
  }
  console.log(`  ${linked.toLocaleString()} incidents linked to ${Object.keys(bySlope).length.toLocaleString()} registered slopes`);
  writeTs(
    "slopeIncidents.ts",
    `// CEDD landslide incidents (via CSDI) that reference a registered slope number: ${linked.toLocaleString()} incidents on
// ${Object.keys(bySlope).length.toLocaleString()} slopes. Key = slope number with whitespace removed, upper-case.
// Value rows: [day index from ${EPOCH_YEAR}-01-01 (−1 = undated), failure volume m³ (−1 = not recorded), incident ref].

export type SlopeIncidentRow = [day: number, volumeM3: number, ref: string];`,
    `export const SLOPE_INCIDENTS: Record<string, SlopeIncidentRow[]> = ${JSON.stringify(bySlope)};`
  );
  return {
    gauges: nG, validReadings: valid, firstDate: `${EPOCH_YEAR}0101`, lastDate, days: nD,
    incidents: incidents.length, datedIncidents: dated, linkedIncidents: linked, linkedSlopes: Object.keys(bySlope).length,
    wettestDay: { date: new Date(EPOCH_MS + storms[0].d * 86400_000).toISOString().slice(0, 10), mm: storms[0].maxX10 / 10, gauge: gauges[storms[0].gauge].name },
  };
}

// ---------- 3. ENTLI density grid ----------

async function bakeEntli() {
  console.log("ENTLI natural terrain landslide crowns");
  const pts = await cached("entliCrowns", async () =>
    (await pageAll(LAYER.entliCrown, { outFields: "SLIDE_TYPE,YEAR_1", returnGeometry: "true", f: "geojson" }, "ENTLI crowns")).map((f) => [
      r5(f.geometry.coordinates[0]),
      r5(f.geometry.coordinates[1]),
      f.properties.SLIDE_TYPE,
      +f.properties.YEAR_1 || 0,
    ])
  );
  const lon0 = 113.8, lat0 = 22.13, lon1 = 114.46, lat1 = 22.59;
  const dLat = 250 / 111_320; // 250 m cells
  const dLon = 250 / (111_320 * Math.cos((22.36 * Math.PI) / 180));
  const cols = Math.ceil((lon1 - lon0) / dLon), rows = Math.ceil((lat1 - lat0) / dLat);
  const recent = new Map(), relict = new Map();
  let nRecent = 0, nRelict = 0, yMin = 9999, yMax = 0;
  for (const [x, y, type, year] of pts) {
    const q = Math.floor((x - lon0) / dLon), r = Math.floor((y - lat0) / dLat);
    if (q < 0 || r < 0 || q >= cols || r >= rows) continue;
    const i = r * cols + q;
    if (type === "R") { relict.set(i, (relict.get(i) ?? 0) + 1); nRelict++; }
    else { recent.set(i, (recent.get(i) ?? 0) + 1); nRecent++; if (year) { yMin = Math.min(yMin, year); yMax = Math.max(yMax, year); } }
  }
  const idx = [...new Set([...recent.keys(), ...relict.keys()])].sort((a, b) => a - b);
  const cells = new Uint16Array(idx), rc = new Uint16Array(idx.length), rl = new Uint16Array(idx.length);
  idx.forEach((i, k) => { rc[k] = Math.min(65535, recent.get(i) ?? 0); rl[k] = Math.min(65535, relict.get(i) ?? 0); });
  console.log(`  ${pts.length.toLocaleString()} crowns → ${idx.length.toLocaleString()} occupied 250 m cells (${cols}×${rows}) · recent ${nRecent.toLocaleString()} (${yMin}–${yMax}) · relict ${nRelict.toLocaleString()}`);
  writeTs(
    "entliGrid.ts",
    `// Enhanced Natural Terrain Landslide Inventory (CEDD/GEO via CSDI), ${pts.length.toLocaleString()} landslide crowns 1924–2023,
// counted on a 250 m grid. "recent" = dated landslides identified on aerial photographs (${yMin}–${yMax});
// "relict" = older features mapped from the 1963 baseline photography. Sparse: cells[k] is the cell index
// (row*cols+col) of the k-th occupied cell; recent[k]/relict[k] its counts. Base64 Uint16, see decode.ts.

export interface EntliGrid {
  lon0: number; lat0: number; dLon: number; dLat: number; cols: number; rows: number;
  cells: string; recent: string; relict: string;
  totals: { recent: number; relict: number }; years: [number, number];
}`,
    `export const ENTLI_GRID: EntliGrid = ${JSON.stringify({ lon0, lat0, dLon, dLat, cols, rows, cells: b64(cells), recent: b64(rc), relict: b64(rl), totals: { recent: nRecent, relict: nRelict }, years: [yMin, yMax] })};`
  );
  return { crowns: pts.length, cells: idx.length, cellM: 250, recent: nRecent, relict: nRelict, years: [yMin, yMax] };
}

// ---------- 4. HKO automatic rain-gauge stations ----------

async function bakeHko() {
  console.log("HKO automatic weather station rain gauges");
  const live = await getJson(HKO_HOURLY);
  const csdi = await query(LAYER.hkoAws, { outFields: "automaticWeatherStationID,automaticWeatherStation_en", f: "geojson" });
  // CSDI's ID column is shifted relative to its names, but name↔coordinate is consistent: resolve by name,
  // falling back to the GEO raingauge of the same ID (HKO reuses GEO gauge IDs such as N12, K02, H17).
  const byName = new Map(csdi.features.map((f) => [f.properties.automaticWeatherStation_en.trim().toLowerCase(), f.geometry.coordinates]));
  const gauges = fs.existsSync(path.join(CACHE, "gauges.json")) ? JSON.parse(fs.readFileSync(path.join(CACHE, "gauges.json"), "utf8")) : await cached("gauges", fetchGauges);
  const geoById = new Map(gauges.map((g) => [g.id, [g.lon, g.lat]]));
  const stations = [];
  for (const s of live.hourlyRainfall) {
    const id = s.automaticWeatherStationID, name = s.automaticWeatherStation;
    const c = byName.get(name.trim().toLowerCase()) ?? geoById.get(id);
    if (!c) { console.warn(`  ! no coordinates for ${id} ${name}`); continue; }
    stations.push({ id, name, lon: r5(c[0]), lat: r5(c[1]) });
  }
  const p = path.join(OUT, "hkoStations.json");
  fs.writeFileSync(p, JSON.stringify(stations, null, 0));
  console.log(`  ${stations.length}/${live.hourlyRainfall.length} stations resolved → ${path.relative(ROOT, p)}`);
  return { stations: stations.length, obsTime: live.obsTime };
}

// ---------- 5. Facilities: hospitals, schools, fire, police, clinics (REAL points) ----------

const tidy = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const titleCase = (v) => tidy(v).toLowerCase().replace(/(^|[\s(\-/])([a-z])/g, (m, a, b) => a + b.toUpperCase());

async function bakeFacilities() {
  console.log("Facilities (HA, EDB, FSD, HKPF, DH)");
  const out = [];
  for (const [kind, sub, id, nameF, addrF] of FACILITY_LAYERS) {
    const g = await cached(`fac_${id}`, () => query(`${CSDI}/${id}/FeatureServer/0`, { outFields: `${nameF},${addrF}`, f: "geojson" }));
    let n = 0;
    for (const f of g.features) {
      if (!f.geometry) continue;
      const [x, y] = f.geometry.coordinates;
      if (!(x > 113.7 && x < 114.6 && y > 22.1 && y < 22.6)) continue;
      const rawName = tidy(f.properties[nameF]);
      const name = rawName === rawName.toUpperCase() ? titleCase(rawName) : rawName;
      void addrF;
      out.push({ kind, sub, name, lon: r5(x), lat: r5(y) });
      n++;
    }
    console.log(`  ${sub.padEnd(26)} ${n}`);
  }
  const counts = out.reduce((a, f) => ((a[f.kind] = (a[f.kind] ?? 0) + 1), a), {});
  writeTs(
    "facilities.ts",
    `// Real facilities from CSDI: ${JSON.stringify(counts)}. Sources: Hospital Authority hospital list, EDB school
// lists (government / aided / DSS / caput / private / international / ESF / special) and kindergartens, FSD fire
// stations, Police stations, DH clinics. Point + English name (addresses are not shipped).

export type FacilityKind = "hospital" | "school" | "kindergarten" | "fire-station" | "police" | "clinic";
export interface Facility { kind: FacilityKind; sub: string; name: string; lon: number; lat: number }`,
    `export const FACILITIES: Facility[] = JSON.parse(${JSON.stringify(JSON.stringify(out))});`
  );
  return counts;
}

// ---------- 6. Per-slope neighbours: LandsD buildings within 150 m, nearest LandsD road ----------

const M_PER_DEG_LAT = 111_320;
const mPerDegLon = (lat) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
const distM = (a, b) => Math.hypot((a[0] - b[0]) * mPerDegLon(a[1]), (a[1] - b[1]) * M_PER_DEG_LAT);
function segDistM(p, a, b) {
  const kx = mPerDegLon(p[1]);
  const px = (p[0] - a[0]) * kx, py = (p[1] - a[1]) * M_PER_DEG_LAT;
  const vx = (b[0] - a[0]) * kx, vy = (b[1] - a[1]) * M_PER_DEG_LAT;
  const l2 = vx * vx + vy * vy;
  const t = l2 ? Math.max(0, Math.min(1, (px * vx + py * vy) / l2)) : 0;
  return Math.hypot(px - t * vx, py - t * vy);
}
/** Mean of the largest outer ring — good enough as a "where is this building/slope" point. */
function ringCentroid(geom) {
  if (!geom) return null;
  const rings = geom.type === "Polygon" ? [geom.coordinates[0]] : geom.type === "MultiPolygon" ? geom.coordinates.map((p) => p[0]) : [];
  let best = null;
  for (const r of rings) if (r && (!best || r.length > best.length)) best = r;
  if (!best?.length) return null;
  let x = 0, y = 0;
  for (const v of best) { x += v[0]; y += v[1]; }
  return [x / best.length, y / best.length];
}
const CELL = 0.003; // ≈ 300 m
const cellKey = (x, y) => `${Math.floor(x / CELL)}:${Math.floor(y / CELL)}`;
function neighbours(index, x, y) {
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
  const out = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const b = index.get(`${cx + dx}:${cy + dy}`); if (b) out.push(...b); }
  return out;
}

async function fetchInventoryCentroids() {
  // same inventory rule as the app: every registered slope ≥ 20 m plus every slope in the LPM programme
  const lpm = await query(LAYER.lpmSlopes, { outFields: "LPMWORKS_SLOPE_NUM", returnGeometry: "false" });
  const lpmNos = [...new Set(lpm.features.map((f) => String(f.attributes.LPMWORKS_SLOPE_NUM ?? "").trim()).filter(Boolean))];
  const tall = await pageAll(LAYER.slopes, { where: "OVERALL_HT>=20", outFields: "SLOPE_NO", maxAllowableOffset: "0.0003", f: "geojson" }, "slopes ≥ 20 m");
  const rows = new Map();
  const put = (f) => { const c = ringCentroid(f.geometry); const no = f.properties.SLOPE_NO; if (c && no) rows.set(no.replace(/\s+/g, "").toUpperCase(), { id: no, c }); };
  tall.forEach(put);
  const missing = lpmNos.filter((n) => !rows.has(n.replace(/\s+/g, "").toUpperCase()));
  for (let i = 0; i < missing.length; i += 40) {
    const list = missing.slice(i, i + 40).map((n) => `'${n.replace(/'/g, "''")}'`).join(",");
    const b = await query(LAYER.slopes, { where: `SLOPE_NO IN (${list})`, outFields: "SLOPE_NO", maxAllowableOffset: "0.0003", f: "geojson" });
    b.features.forEach(put);
  }
  return rows;
}

async function bakeSlopeAssets() {
  console.log("Per-slope buildings and roads (LandsD)");
  const slopes = await cached("inventoryCentroids", async () => Object.fromEntries(await fetchInventoryCentroids()));
  const buildings = await cached("buildings", async () =>
    (await pageAll(LAYER.buildings, { where: "Status='Active'", outFields: "BuildingNameEN,BuildingBlockType,TopHeight,BaseHeight", maxAllowableOffset: "0.0005", f: "geojson" }, "buildings"))
      .map((f) => {
        const c = ringCentroid(f.geometry);
        if (!c) return null;
        const p = f.properties;
        return [r5(c[0]), r5(c[1]), tidy(p.BuildingNameEN) || null, tidy(p.BuildingBlockType) || null, Math.round(p.TopHeight ?? 0), Math.round(p.BaseHeight ?? 0)];
      })
      .filter(Boolean)
  );
  const roads = await cached("roads", async () =>
    (await pageAll(LAYER.roads, { outFields: "ENGLISHSTREETNAME,STREETTYPE", returnGeometry: "true", maxAllowableOffset: "0.0001", f: "geojson" }, "roads")).map((f) => ({
      name: tidy(f.properties.ENGLISHSTREETNAME) || null, type: tidy(f.properties.STREETTYPE) || null,
      line: (f.geometry.type === "LineString" ? f.geometry.coordinates : f.geometry.coordinates.flat()).map(([x, y]) => [r5(x), r5(y)]),
    }))
  );
  // spatial indexes
  const bIndex = new Map();
  buildings.forEach((b, i) => { const k = cellKey(b[0], b[1]); (bIndex.get(k) ?? bIndex.set(k, []).get(k)).push(i); });
  const rIndex = new Map();
  roads.forEach((r, i) => { const seen = new Set(); for (const [x, y] of r.line) { const k = cellKey(x, y); if (!seen.has(k)) { seen.add(k); (rIndex.get(k) ?? rIndex.set(k, []).get(k)).push(i); } } });

  const out = {};
  let withB = 0, withR = 0;
  for (const [key, s] of Object.entries(slopes)) {
    const c = s.c;
    const near = [];
    for (const i of neighbours(bIndex, c[0], c[1])) { const b = buildings[i]; const d = distM(c, [b[0], b[1]]); if (d <= 150) near.push([d, i]); }
    near.sort((a, b) => a[0] - b[0]);
    const r4 = (v) => Math.round(v * 1e4) / 1e4;
    const top = near.slice(0, 3).map(([d, i]) => { const b = buildings[i]; return [b[2] ? b[2].slice(0, 40) : null, b[3], Math.max(0, b[4] - b[5]), Math.round(d), r4(b[0]), r4(b[1])]; });
    let best = null;
    for (const i of neighbours(rIndex, c[0], c[1])) {
      const r = roads[i];
      for (let k = 0; k + 1 < r.line.length; k++) {
        const d = segDistM(c, r.line[k], r.line[k + 1]);
        if (d <= 300 && (!best || d < best.d)) best = { d, i, k };
      }
    }
    const entry = { n: near.length, b: top };
    if (best) { const r = roads[best.i]; const r4p = (p) => [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4]; entry.r = [r.name, r.type, Math.round(best.d), [r4p(r.line[best.k]), r4p(r.line[best.k + 1])]]; withR++; }
    if (near.length) withB++;
    out[key] = entry;
  }
  const n = Object.keys(out).length;
  console.log(`  ${n} slopes · ${withB} with buildings within 150 m · ${withR} with a road within 300 m · ${buildings.length.toLocaleString()} buildings · ${roads.length.toLocaleString()} road segments`);
  writeTs(
    "slopeAssets.ts",
    `// Real neighbours of every registered slope in the twin's inventory (LandsD via CSDI), keyed by normalised slope
// number. n = LandsD building blocks within 150 m of the slope centroid; b = the three nearest as
// [name, block type, height m, distance m, lon, lat]; r = nearest road centreline within 300 m as
// [street name, street type, distance m, [[lon,lat],[lon,lat]] segment]. ${buildings.length.toLocaleString()} buildings, ${roads.length.toLocaleString()} road segments joined.

export type NearBuilding = [name: string | null, type: string | null, heightM: number, distM: number, lon: number, lat: number];
export type NearRoad = [name: string | null, type: string | null, distM: number, segment: [[number, number], [number, number]]];
export interface SlopeAssets { n: number; b: NearBuilding[]; r?: NearRoad }`,
    `export const SLOPE_ASSETS: Record<string, SlopeAssets> = JSON.parse(${JSON.stringify(JSON.stringify(out))});`
  );
  return { slopes: n, withBuildings: withB, withRoad: withR, buildings: buildings.length, roadSegments: roads.length };
}

// ---------- 7. Natural terrain hazard mitigation measures: ND defence + NS stabilisation features (REAL) ----------
//
// GEO registers natural-terrain mitigation works in the same Catalogue of Slopes as cut/fill slopes. The slope
// number carries the class: ".../ND n" = defence measures that resist or contain landslide debris and boulders
// (check dams = rigid barriers, flexible barriers, earth bunds, boulder fences — DEVB TC(W) 02/2018), ".../NS n" =
// stabilisation measures on natural hillsides (soil nails, buttresses, raking drains). The open layer publishes the
// footprint, location and maintenance party but NOT the barrier type, height or design retention volume.

/** Principal axis of a ring (metres, from its centroid): direction and the extent along / across it. */
function principalAxis(ringM) {
  const n = ringM.length;
  let cx = 0, cy = 0;
  for (const [x, y] of ringM) { cx += x; cy += y; }
  cx /= n; cy /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of ringM) { const dx = x - cx, dy = y - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(theta), uy = Math.sin(theta);
  let lo = Infinity, hi = -Infinity, wlo = Infinity, whi = -Infinity;
  for (const [x, y] of ringM) {
    const t = (x - cx) * ux + (y - cy) * uy, w = -(x - cx) * uy + (y - cy) * ux;
    lo = Math.min(lo, t); hi = Math.max(hi, t); wlo = Math.min(wlo, w); whi = Math.max(whi, w);
  }
  return { cx, cy, ux, uy, lo, hi, lengthM: hi - lo, widthM: whi - wlo };
}

async function bakeBarriers() {
  console.log("Natural terrain hazard mitigation measures (CEDD Catalogue of Slopes, ND + NS)");
  const g = await cached("ntmm", () =>
    pageAll(LAYER.slopes, {
      where: "SLOPE_NO LIKE '%/ND%' OR SLOPE_NO LIKE '%/NS%'",
      outFields: "SLOPE_NO,DISTRICT,LOCATION,MAINT_PART,Shape_Area",
      maxAllowableOffset: "0.00002", // ≈ 2 m: barrier footprints are strips a few metres wide
      f: "geojson",
    }, "ND/NS features")
  );
  const slopes = await cached("inventoryCentroids", async () => Object.fromEntries(await fetchInventoryCentroids()));
  const sIndex = new Map();
  for (const [key, s] of Object.entries(slopes)) { const k = cellKey(s.c[0], s.c[1]); (sIndex.get(k) ?? sIndex.set(k, []).get(k)).push(key); }

  const out = [];
  let linked = 0;
  for (const f of g) {
    const ring = f.geometry?.type === "Polygon" ? f.geometry.coordinates[0] : f.geometry?.type === "MultiPolygon" ? f.geometry.coordinates.map((p) => p[0]).sort((a, b) => b.length - a.length)[0] : null;
    if (!ring || ring.length < 4) continue;
    const p = f.properties;
    const id = tidy(p.SLOPE_NO);
    const cls = /\/ND/.test(id) ? "ND" : "NS";
    const c = ringCentroid(f.geometry);
    const kx = mPerDegLon(c[1]);
    const ringM = ring.map(([x, y]) => [(x - c[0]) * kx, (y - c[1]) * M_PER_DEG_LAT]);
    const ax = principalAxis(ringM);
    const toLL = (t) => [r5(c[0] + (ax.cx + ax.ux * t) / kx), r5(c[1] + (ax.cy + ax.uy * t) / M_PER_DEG_LAT)];
    // inventory slopes within 200 m of the measure — the slopes whose runout it is there to catch
    const near = [];
    for (const key of neighbours(sIndex, c[0], c[1])) { const d = distM(c, slopes[key].c); if (d <= 200) near.push([Math.round(d), slopes[key].id]); }
    near.sort((a, b) => a[0] - b[0]);
    if (near.length) linked++;
    out.push({
      id, cls, district: tidy(p.DISTRICT), loc: tidy(p.LOCATION), maint: tidy(p.MAINT_PART),
      lon: r5(c[0]), lat: r5(c[1]), areaM2: Math.round(p.Shape_Area ?? 0),
      lengthM: Math.round(ax.lengthM), widthM: Math.round(ax.widthM * 10) / 10,
      axis: [toLL(ax.lo), toLL(ax.hi)],
      ring: ring.map(([x, y]) => [r5(x), r5(y)]),
      slopes: near.slice(0, 6).map(([d, sid]) => [tidy(sid), d]),
    });
  }
  const nd = out.filter((b) => b.cls === "ND").length, ns = out.length - nd;
  const linkedSlopes = new Set(out.flatMap((b) => b.slopes.map(([sid]) => sid))).size;
  console.log(`  ${nd} ND defence measures · ${ns} NS stabilisation measures · ${linked} within 200 m of an inventory slope (${linkedSlopes} slopes)`);
  writeTs(
    "barriers.ts",
    `// REAL natural terrain hazard mitigation measures from CEDD's Catalogue of Slopes (CSDI): ${nd} ND defence
// measures (debris-resisting barriers — rigid check dams and flexible nets — earth bunds, boulder fences) and ${ns} NS
// stabilisation measures (soil nails, buttresses, raking drains on natural hillsides). The published layer gives the
// footprint polygon, location text and maintenance party only: barrier type, height and design retention volume are
// NOT open data. \`axis\` is the footprint's principal axis (the barrier alignment), \`slopes\` the inventory slopes
// within 200 m as [slope number, distance m].

export type BarrierClass = "ND" | "NS";
export interface Barrier {
  id: string; cls: BarrierClass; district: string; loc: string; maint: string;
  lon: number; lat: number; areaM2: number; lengthM: number; widthM: number;
  axis: [[number, number], [number, number]]; ring: [number, number][]; slopes: [string, number][];
}`,
    `export const BARRIERS: Barrier[] = JSON.parse(${JSON.stringify(JSON.stringify(out))});`
  );
  return { nd, ns, linked, linkedSlopes };
}

// ---------- manifest (what was baked, when — shown in the Data Sources panel) ----------

const MANIFEST = path.join(OUT, "manifest.json");
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
const note = (key, value) => { manifest[key] = { bakedOn: stamp, ...value }; };

// ---------- run ----------

const t0 = Date.now();
if (want("census")) note("census", await bakeCensus());
if (want("rain")) note("rainfall", await bakeRain());
if (want("entli")) note("entli", await bakeEntli());
if (want("hko")) note("hko", await bakeHko());
if (want("facilities")) note("facilities", await bakeFacilities());
if (want("assets")) note("assets", await bakeSlopeAssets());
if (want("barriers")) note("barriers", await bakeBarriers());
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
console.log(`manifest → ${path.relative(ROOT, MANIFEST)}`);
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

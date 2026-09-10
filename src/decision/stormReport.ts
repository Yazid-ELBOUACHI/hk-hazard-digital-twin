// PoLA-style one-page storm report (He, Zhang et al. 2023; Zhang & He, IWDTERM 2026 slide 37): the inventory's risk
// chain summed over the territory — expected landslides by district and on GEO's 750 m × 600 m grid (the Survey and
// Mapping Office gridding used by Xiao et al. 2023 to validate against incident counts), affected buildings and the
// expected fatalities — with the Landslip Warning context GEO judges storms by.

import type { KpiSnapshot, RiskAssessment, Slope, WeatherState } from "@/core/types";
import { fmtInt } from "@/core/format";

export const GEO_GRID = { lon0: 113.8, lat0: 22.13, cellEwM: 750, cellNsM: 600 } as const;
const dLat = GEO_GRID.cellNsM / 111_320;
const dLon = GEO_GRID.cellEwM / (111_320 * Math.cos((22.36 * Math.PI) / 180));

export interface GridCell {
  q: number;
  r: number;
  expected: number; // Σ P(H | R)
  expectedMajor: number; // Σ P(≥ 50 m³)
  pll: number;
  slopes: number;
  worst: string; // slope with the highest P
  bbox: [number, number, number, number]; // w, s, e, n
}
export interface DistrictRow {
  district: string;
  slopes: number;
  expected: number;
  expected5: number;
  expected95: number;
  expectedMajor: number;
  pll: number;
  maxR24: number;
  meanR24: number;
  top: string[];
}
export interface StormReport {
  issuedAt: number;
  totals: { slopes: number; expected: number; expected5: number; expected95: number; expectedMajor: number; pll: number; pll5: number; pll95: number; buildingsAffected: number; maxR24: number; meanR24: number; returnPeriodY: number };
  districts: DistrictRow[];
  cells: GridCell[]; // sorted by expected landslides, desc
  text: string;
}

/** Hong Kong context the report is read against (GEO Information Note 18/2025; Zhang & He 2026; Xiao et al. 2023). */
export const LWS_CONTEXT = {
  incidentsPerYear: 300,
  warningsPerYear: 3,
  storm20230907: { r24Mm: 846, reported: 190, interpreted: 485 },
  storm20080607: { r24Mm: 623, manMadeFailures: 221 },
};

export function buildStormReport(slopes: Slope[], assessments: Map<string, RiskAssessment>, weather: WeatherState | null, kpi: KpiSnapshot | null, gameTime: number): StormReport {
  const cells = new Map<string, GridCell>();
  const districts = new Map<string, DistrictRow & { r24s: number[]; ranked: { id: string; p: number }[] }>();
  const t = { slopes: 0, expected: 0, expected5: 0, expected95: 0, expectedMajor: 0, pll: 0, pll5: 0, pll95: 0, buildingsAffected: 0, maxR24: 0, r24Sum: 0 };
  let worstP = 0;
  for (const s of slopes) {
    const q = assessments.get(s.id)?.qra;
    if (!q) continue;
    t.slopes++;
    t.expected += q.pFailure;
    t.expected5 += q.pFailure5;
    t.expected95 += q.pFailure95;
    t.expectedMajor += q.pMajor;
    t.pll += q.pllEvent;
    t.pll5 += q.pll5;
    t.pll95 += q.pll95;
    t.maxR24 = Math.max(t.maxR24, q.r24Mm);
    t.r24Sum += q.r24Mm;
    // buildings "affected" = blocks a failure of the expected size would reach, weighted by P(H|R)
    t.buildingsAffected += q.pFailure * q.elements.buildings;
    worstP = Math.max(worstP, q.pFailure);

    const cq = Math.floor((s.centroid[0] - GEO_GRID.lon0) / dLon), cr = Math.floor((s.centroid[1] - GEO_GRID.lat0) / dLat);
    const key = `${cq}:${cr}`;
    let c = cells.get(key);
    if (!c) {
      c = { q: cq, r: cr, expected: 0, expectedMajor: 0, pll: 0, slopes: 0, worst: s.id, bbox: [GEO_GRID.lon0 + cq * dLon, GEO_GRID.lat0 + cr * dLat, GEO_GRID.lon0 + (cq + 1) * dLon, GEO_GRID.lat0 + (cr + 1) * dLat] };
      cells.set(key, c);
    }
    c.expected += q.pFailure;
    c.expectedMajor += q.pMajor;
    c.pll += q.pllEvent;
    c.slopes++;
    if (q.pFailure > (assessments.get(c.worst)?.qra?.pFailure ?? 0)) c.worst = s.id;

    let d = districts.get(s.district);
    if (!d) {
      d = { district: s.district, slopes: 0, expected: 0, expected5: 0, expected95: 0, expectedMajor: 0, pll: 0, maxR24: 0, meanR24: 0, top: [], r24s: [], ranked: [] };
      districts.set(s.district, d);
    }
    d.slopes++;
    d.expected += q.pFailure;
    d.expected5 += q.pFailure5;
    d.expected95 += q.pFailure95;
    d.expectedMajor += q.pMajor;
    d.pll += q.pllEvent;
    d.maxR24 = Math.max(d.maxR24, q.r24Mm);
    d.r24s.push(q.r24Mm);
    d.ranked.push({ id: s.id, p: q.pFailure });
  }
  const districtRows: DistrictRow[] = [...districts.values()]
    .map((d) => ({
      district: d.district,
      slopes: d.slopes,
      expected: d.expected,
      expected5: d.expected5,
      expected95: d.expected95,
      expectedMajor: d.expectedMajor,
      pll: d.pll,
      maxR24: d.maxR24,
      meanR24: d.r24s.reduce((a, b) => a + b, 0) / Math.max(1, d.r24s.length),
      top: d.ranked.sort((a, b) => b.p - a.p).slice(0, 3).map((x) => x.id),
    }))
    .sort((a, b) => b.expected - a.expected);
  const cellRows = [...cells.values()].sort((a, b) => b.expected - a.expected);
  const meanR24 = t.slopes ? t.r24Sum / t.slopes : 0;
  const returnPeriodY = assessments.get(slopes[0]?.id ?? "")?.qra?.returnPeriodY ?? 2;

  const f = (x: number) => (x >= 10 ? fmtInt(x) : x >= 1 ? x.toFixed(1) : x.toFixed(2));
  const clock = new Date(gameTime).toLocaleString("en-GB", { timeZone: "Asia/Hong_Kong", hour12: false });
  const lines: string[] = [];
  lines.push(`PROMPT LANDSLIDE RISK ASSESSMENT — STORM REPORT (PoLA chain, demonstration)`);
  lines.push(`Issued ${clock} HKT · ${t.slopes.toLocaleString("en-US")} registered slopes in the inventory (≥ 20 m + LPM programme)`);
  lines.push("");
  lines.push(`RAINFALL  max rolling 24-h so far: max ${Math.round(t.maxR24)} mm · mean ${Math.round(meanR24)} mm across the inventory · indicative return period ~${returnPeriodY} y`);
  if (weather?.nowcast) lines.push(`          HKO nowcast next 2 h: mean ${weather.nowcast.mean2h} mm · max ${weather.nowcast.max2h} mm (issued ${weather.nowcast.updated.slice(11, 16)} HKT)`);
  if (kpi) lines.push(`          KPI 24-h mean ${kpi.rainfall24hMm} mm · synthetic forecast next 24 h ${kpi.forecastRainfallMm} mm`);
  lines.push("");
  lines.push(`HAZARD    expected landslides this storm: ${f(t.expected)} (5–95 %: ${f(t.expected5)}–${f(t.expected95)}) · of which ≥ 50 m³: ${f(t.expectedMajor)}`);
  lines.push(`          worst single slope P(H|R) = ${(worstP * 100).toFixed(2)} %`);
  lines.push(`CONSEQ.   expected fatalities (PLL): ${t.pll.toExponential(2)} (5–95 %: ${t.pll5.toExponential(1)}–${t.pll95.toExponential(1)}) · building blocks within reach of an expected failure: ${f(t.buildingsAffected)}`);
  lines.push("");
  lines.push(`BY DISTRICT (expected landslides · ≥ 50 m³ · PLL · max R24)`);
  for (const d of districtRows.slice(0, 12)) lines.push(`  ${d.district.padEnd(22)} ${f(d.expected).padStart(6)}  ${f(d.expectedMajor).padStart(6)}  ${d.pll.toExponential(1).padStart(8)}  ${String(Math.round(d.maxR24)).padStart(4)} mm   top: ${d.top.join(", ")}`);
  lines.push("");
  lines.push(`HOTSPOT CELLS (GEO 750 × 600 m grid · expected landslides · slopes · worst slope)`);
  for (const c of cellRows.slice(0, 8)) lines.push(`  cell ${String(c.q).padStart(3)}/${String(c.r).padStart(3)}  ${f(c.expected).padStart(6)}  ${String(c.slopes).padStart(4)}  ${c.worst}`);
  lines.push("");
  lines.push(`CONTEXT   GEO reports ~${LWS_CONTEXT.incidentsPerYear} landslides and ~${LWS_CONTEXT.warningsPerYear} Landslip Warnings a year; the Warning is issued when numerous landslides are predicted from rainfall area, intensity and slopes affected.`);
  lines.push(`          7 Sep 2023 (846 mm / 24 h, ~1000-y): ~${LWS_CONTEXT.storm20230907.reported} incidents reported, ${LWS_CONTEXT.storm20230907.interpreted} landslides interpreted from satellite imagery. 7 Jun 2008 (623 mm): ${LWS_CONTEXT.storm20080607.manMadeFailures} man-made slope failures.`);
  lines.push(`          The inventory covers the ${t.slopes.toLocaleString("en-US")} tallest / programmed slopes of 61,475 registered — territory totals scale up, not 1:1.`);
  lines.push("");
  lines.push(`Risk = P(H|R)·P(M|H,R)·P(L|H,M)·V·E per slope, summed. Monitoring evidence and material terms are synthetic. DEMONSTRATION MODEL — NOT FOR ENGINEERING DECISIONS.`);

  return {
    issuedAt: gameTime,
    totals: { slopes: t.slopes, expected: t.expected, expected5: t.expected5, expected95: t.expected95, expectedMajor: t.expectedMajor, pll: t.pll, pll5: t.pll5, pll95: t.pll95, buildingsAffected: t.buildingsAffected, maxR24: t.maxR24, meanR24, returnPeriodY },
    districts: districtRows,
    cells: cellRows,
    text: lines.join("\n"),
  };
}

/** GeoJSON of the grid cells for the map layer. */
export function stormGridFC(report: StormReport): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: report.cells
      .filter((c) => c.expected > 0)
      .map((c) => ({
        type: "Feature",
        properties: { expected: +c.expected.toFixed(4), expectedMajor: +c.expectedMajor.toFixed(4), pll: +c.pll.toExponential(2), slopes: c.slopes, worst: c.worst, q: c.q, r: c.r },
        geometry: { type: "Polygon", coordinates: [[[c.bbox[0], c.bbox[1]], [c.bbox[2], c.bbox[1]], [c.bbox[2], c.bbox[3]], [c.bbox[0], c.bbox[3]], [c.bbox[0], c.bbox[1]]]] },
      })),
  };
}

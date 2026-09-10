// Storm replay — the risk chain against the CEDD record (validation, real data both sides).
// For each of the 40 wettest days since 1984 the twin feeds every inventory slope its nearest GEO raingauge's daily
// total, runs the PoLA occurrence term (no monitoring evidence — it is synthetic), and sums P(H | R) into the
// expected number of failures. Observed = CEDD landslide incidents that day (a) citing a slope in the inventory and
// (b) territory-wide. This is the storm-based comparison of Xiao et al. (2023) Fig. 13, restricted to the open data:
// daily totals stand in for the maximum rolling 24-h rainfall (they can only be lower), and the inventory is the
// tallest 4,155 of 61,475 registered slopes — so the inventory-linked count is the like-for-like column.

import type { Slope } from "@/core/types";
import type { RainfallHistory } from "@/live/rainfallHistory";
import { magnitude, mitigationFactor, occurrence } from "@/core/pola";

export interface ReplayRow {
  k: number;
  date: string;
  maxMm: number; // territory maximum daily total
  meanMm: number;
  gauges: number; // gauges with a record that day
  predicted: number; // Σ P(H | R) over the inventory
  predictedMajor: number;
  observedLinked: number; // CEDD incidents that day citing an inventory slope
  observedAll: number; // all CEDD incidents reported that day
}
export interface ReplayResult {
  rows: ReplayRow[];
  rho: number; // Pearson correlation of ln(1 + predicted) vs ln(1 + observed linked), all storms
  rhoAll: number; // same against all reported incidents
  calibration: number; // Σ observed linked / Σ predicted — the factor the occurrence anchor is off by
  inventory: number;
  storms: number;
}

const pearson = (xs: number[], ys: number[]) => {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
};

export function replayStorms(slopes: Slope[], h: RainfallHistory): ReplayResult {
  const gaugeIdx = new Map<string, number>(h.gauges.map((g, i) => [g.id, i]));
  // incidents per slope per day, from the real per-slope record
  const linkedByDay = new Map<number, number>();
  for (const s of slopes) {
    for (const inc of s.realIncidents) {
      if (!inc.date) continue;
      const d = h.dayOfDate(inc.date);
      if (d >= 0) linkedByDay.set(d, (linkedByDay.get(d) ?? 0) + 1);
    }
  }
  const rows: ReplayRow[] = h.storms.map((st, k) => {
    const gauge = h.stormGaugeMm(k);
    const reporting = gauge.filter((v) => v > 0).length;
    const mean = st.meanX10 / 10;
    let predicted = 0, predictedMajor = 0;
    for (const s of slopes) {
      const gi = s.nearestGauge ? gaugeIdx.get(s.nearestGauge.id) ?? -1 : -1;
      const r = gi >= 0 && gauge[gi] > 0 ? gauge[gi] : mean;
      const occ = occurrence({
        r24Mm: r,
        slopeType: s.slopeType,
        heightM: s.heightM,
        angleDeg: s.slopeAngleDeg,
        entliPerKm2: s.entliPerKm2,
        pastFailures: 0, // the record itself is what we test against — no peeking
        susceptibility: 0.5, // synthetic term neutral in validation
        mitigation: mitigationFactor(s.mitigations),
      });
      predicted += occ.p;
      const m = magnitude(r, s.heightM);
      predictedMajor += occ.p * (m[2].p + m[3].p);
    }
    return {
      k,
      date: h.dateOfDay(st.d),
      maxMm: st.maxX10 / 10,
      meanMm: mean,
      gauges: reporting,
      predicted,
      predictedMajor,
      observedLinked: linkedByDay.get(st.d) ?? 0,
      observedAll: st.incidents,
    };
  });
  const lx = rows.map((r) => Math.log1p(r.predicted));
  const rho = pearson(lx, rows.map((r) => Math.log1p(r.observedLinked)));
  const rhoAll = pearson(lx, rows.map((r) => Math.log1p(r.observedAll)));
  const sumPred = rows.reduce((a, r) => a + r.predicted, 0);
  const sumObs = rows.reduce((a, r) => a + r.observedLinked, 0);
  return { rows, rho, rhoAll, calibration: sumPred ? sumObs / sumPred : 0, inventory: slopes.length, storms: rows.length };
}

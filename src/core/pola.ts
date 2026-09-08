// Quantitative landslide risk in the form used by Prof. Limin Zhang's group at HKUST — the PoLA
// (prompt landslide risk assessment) chain of He, Zhang, Xiao, Wang & Luo (2023, J. Geotech. Geoenviron.
// Eng. 149(5)) as presented in Zhang & He, "Digital twin empowered landslide and flood risk management",
// IWDTERM, Hong Kong, Aug 2026 (slide 37):
//
//     Risk(T) = Σ_i Σ_j Σ_k  P(H_i | R) · P(M_j | H_i, R) · P(L_k | H_i, M_j) · V(H_i, M_j, E_k) · E_k(T)
//                            occurrence   magnitude          mobility          vulnerability  elements at risk
//
// driven by the maximum rolling 24-h rainfall R. Every term below is a pure function so the live risk engine, the
// scenario engine and the Data Sources page all describe the same arithmetic. The published inputs are:
//   • occurrence — the statistical rainfall–landslide correlations for registered man-made slopes (Yu 2004, GEO
//     Report 144; Xiao & Zhang 2020 as benchmarked in Xiao, Zhang, Cheung & Lacasse 2023, Géotechnique 73(9),
//     Fig. 7), written in the logistic form of Xiao et al. (2023) eq. (1) so that slope features add to the log-odds;
//   • magnitude — the four failure scales and their frequencies in the 1984–2017 Hong Kong record (Xiao et al. 2023);
//   • mobility × vulnerability — the proximity-zone vulnerability factors of Hong Kong QRA practice (Wong et al. 2004,
//     reproduced in GEO Report 195 Table 5.9) for landslides of 30, 100, 300 and 1,000 m³;
//   • elements at risk — 2021 census residents, LandsD building blocks, facilities and roads (real), with the
//     potential-loss-of-life groups of the GEO priority classification system (GEO Report 195 Table 3.5).
// Where the twin has no published value (monitoring evidence, material susceptibility) the term is synthetic and says so.

import type { Asset, Mitigation, SlopeType } from "./types";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

// ---------- 0. Return period of a 24-h rainfall ----------

/**
 * Indicative return period of a 24-h rainfall total in Hong Kong, log-interpolated through the storms in
 * Zhang & He (IWDTERM 2026): 275 mm (1972), 623 mm (2008, ~200 y), 846 mm (7 Sep 2023, ~1000 y), 956 mm (1994, >1000 y).
 */
export const RETURN_PERIOD_POINTS: [number, number][] = [[100, 2], [150, 10], [275, 50], [400, 100], [623, 200], [846, 1000], [956, 2000]];
export function returnPeriodYears(mm24: number): number {
  const pts = RETURN_PERIOD_POINTS;
  if (mm24 <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, ra] = pts[i], [b, rb] = pts[i + 1];
    if (mm24 <= b) return Math.round(Math.exp(Math.log(ra) + ((mm24 - a) / (b - a)) * (Math.log(rb) - Math.log(ra))));
  }
  return pts[pts.length - 1][1];
}

// ---------- 1. Occurrence P(H | R24, slope) ----------

/**
 * Statistical rainfall–landslide correlation for registered man-made slopes: the failure frequency per slope per storm
 * rises log-linearly with the maximum rolling 24-h rainfall between ~50 and 350 mm and flattens at about 1 % beyond
 * (GEO Report 144 §5; Xiao et al. 2023 Fig. 7). Anchored at 1e-4 per slope-storm at 120 mm — the territory mean of
 * 2,127 registered failures in 22 million slope-storm records, 1984–2017 (Xiao et al. 2023).
 */
export const OCCURRENCE = { anchorMm: 120, anchorLog10: -4, slopePerMm: 0.008, kneeMm: 350, slopeBeyondKnee: 0.002, cap: 0.03 } as const;

export function baselineFrequency(r24Mm: number): number {
  const r = Math.max(0, r24Mm);
  const { anchorMm, anchorLog10, slopePerMm, kneeMm, slopeBeyondKnee, cap } = OCCURRENCE;
  const log10 = r <= kneeMm ? anchorLog10 + slopePerMm * (r - anchorMm) : anchorLog10 + slopePerMm * (kneeMm - anchorMm) + slopeBeyondKnee * (r - kneeMm);
  return Math.min(cap, Math.pow(10, log10));
}

/**
 * Relative failure rate by feature type — GEO Report 144 Table 2 landslide counts (soil cut 928, rock cut 107, fill 68,
 * wall 57 in 1984–2000) against the SIS population shares reported by Xiao et al. (2023): cut 59 %, wall 37 %, fill 22 %.
 */
export const TYPE_RATE: Record<SlopeType, number> = { "soil-cut": 1, "rock-cut": 0.5, fill: 0.25, "retaining-wall": 0.12, natural: 0.6 };

/** Log-odds coefficients of the static and dynamic slope terms (twin calibration; feature ranking after Xiao et al. 2023 Fig. 11). */
export const OCCURRENCE_COEF = {
  anglePerUnit: 0.9, // × clamp((angle − 45°) / 25°, −1, 1)
  heightPerDecade: 0.5, // × log10(H / 10 m)
  pastFailure: 0.7, // slope has a CEDD landslide incident on record
  entli: 0.4, // × clamp(log10(1 + ENTLI crowns per km² within 500 m) / 2.5, 0, 1)
  mitigation: -1.0, // × mitigation factor 0..1
  susceptibility: 1.2, // × (synthetic susceptibility − 0.5)
  pore: 1.2, // × clamp(pore-pressure ratio − 0.55, −0.5, 0.45)   (monitoring evidence, synthetic today)
  displacement: 0.5, // × clamp(displacement rate / 3 mm·h⁻¹, 0, 1)
  antecedentPer300mm: 0.6, // × clamp(antecedent 3-day rain / 300 mm, 0, 1)   (scenario engine only)
  pCap: 0.5,
} as const;

/** How much each mitigation type lowers the chance of the slope failing, at full condition (barriers act on mobility instead). */
export const MITIGATION_WEIGHT: Record<Mitigation["type"], number> = {
  "soil-nails": 0.35,
  "retaining-wall": 0.25,
  "surface-drainage": 0.25,
  shotcrete: 0.2,
  "rock-mesh": 0.15,
  "natural-terrain-stabilisation": 0.3,
  "debris-barrier": 0,
};

export function mitigationFactor(mitigations: Mitigation[]): number {
  return clamp(mitigations.reduce((s, m) => s + MITIGATION_WEIGHT[m.type] * m.condition, 0), 0, 1);
}

/** Condition of the best debris-resisting barrier on the slope (0 = none) — used by the mobility term. */
export function barrierCondition(mitigations: Mitigation[]): number {
  return mitigations.filter((m) => m.type === "debris-barrier").reduce((b, m) => Math.max(b, m.condition), 0);
}

export interface OccurrenceInputs {
  r24Mm: number;
  slopeType: SlopeType;
  heightM: number;
  angleDeg: number;
  entliPerKm2?: number;
  pastFailures: number; // CEDD incidents on record for this slope
  susceptibility: number; // 0..1 synthetic baseline
  mitigation: number; // 0..1 from mitigationFactor()
  evidence?: { poreRatio: number; dispRateMmHr: number }; // monitoring evidence (twin extension)
  antecedent3dMm?: number; // scenario engine
}

export interface OccurrenceResult {
  p: number; // per storm
  baseline: number; // statistical correlation alone, for the feature type
  logOdds: Record<string, number>; // named contributions to the log-odds (drivers)
}

/**
 * Per-storm failure probability in the logistic form of Xiao et al. (2023) eq. (1): the statistical correlation for the
 * feature type gives the intercept; static slope features and monitoring evidence add to the log-odds.
 */
export function occurrence(x: OccurrenceInputs): OccurrenceResult {
  const c = OCCURRENCE_COEF;
  const typeRate = TYPE_RATE[x.slopeType] ?? 1;
  const baseline = baselineFrequency(x.r24Mm) * typeRate;
  const dry = baselineFrequency(0) * typeRate;
  const logOdds: Record<string, number> = {
    "rainfall (max rolling 24 h)": logit(baseline) - logit(dry),
    "slope geometry": c.anglePerUnit * clamp((x.angleDeg - 45) / 25, -1, 1) + c.heightPerDecade * Math.log10(clamp(x.heightM, 3, 250) / 10),
    "past failures (CEDD record)": x.pastFailures > 0 ? c.pastFailure : 0,
    "natural terrain landslide density (ENTLI)": c.entli * clamp(Math.log10(1 + (x.entliPerKm2 ?? 0)) / 2.5, 0, 1),
    "mitigation works": c.mitigation * x.mitigation,
    "material susceptibility (synthetic)": c.susceptibility * (x.susceptibility - 0.5),
  };
  if (x.evidence) {
    logOdds["monitoring evidence (synthetic)"] = c.pore * clamp(x.evidence.poreRatio - 0.55, -0.5, 0.45) + c.displacement * clamp(x.evidence.dispRateMmHr / 3, 0, 1);
  }
  if (x.antecedent3dMm) logOdds["antecedent rainfall (3 d)"] = c.antecedentPer300mm * clamp(x.antecedent3dMm / 300, 0, 1);
  const z = logit(dry) + Object.values(logOdds).reduce((a, b) => a + b, 0);
  return { p: Math.min(c.pCap, sigmoid(z)), baseline, logOdds };
}

// ---------- 2. Magnitude P(M_j | H, R24) ----------

export type MagnitudeClass = "very-minor" | "minor" | "major" | "very-major";
export interface MagnitudeBin { cls: MagnitudeClass; label: string; volumeM3: number; p: number }

/** Failure scales of Hong Kong man-made slopes and their shares in the 1984–2017 record (Xiao et al. 2023). */
export const MAGNITUDE_BASE: MagnitudeBin[] = [
  { cls: "very-minor", label: "< 5 m³", volumeM3: 2, p: 0.45 },
  { cls: "minor", label: "5–50 m³", volumeM3: 20, p: 0.44 },
  { cls: "major", label: "50–500 m³", volumeM3: 150, p: 0.094 },
  { cls: "very-major", label: "≥ 500 m³", volumeM3: 1000, p: 0.016 },
];
/** Log-share shifts per 100 mm of R24 above 150 mm, and per doubling of slope height above 15 m (larger storms and taller slopes → larger failures). */
export const MAGNITUDE_SHIFT = { perRain100mm: [-0.08, 0, 0.22, 0.4], perHeightDoubling: [-0.1, 0, 0.2, 0.4], rainRefMm: 150, heightRefM: 15 } as const;

export function magnitude(r24Mm: number, heightM: number): MagnitudeBin[] {
  const s = MAGNITUDE_SHIFT;
  const x = (r24Mm - s.rainRefMm) / 100;
  const h = Math.log2(clamp(heightM, 3, 120) / s.heightRefM);
  const w = MAGNITUDE_BASE.map((b, i) => b.p * Math.exp(s.perRain100mm[i] * x + s.perHeightDoubling[i] * h));
  const sum = w.reduce((a, b) => a + b, 0);
  return MAGNITUDE_BASE.map((b, i) => ({ ...b, p: w[i] / sum }));
}

// ---------- 3 & 4. Mobility × vulnerability: V_j(d) ----------

/**
 * Vulnerability factors for a person at a plan distance d from the source of an open-hillslope debris slide of notional
 * volume 30 / 100 / 300 / 1,000 m³ (Wong et al. 2004, in GEO Report 195 Table 5.9) — the probability of fatality given the
 * landslide, i.e. P(L | H, M) · V(H, M) folded together. Distances 5 → 130 m in 5 m steps.
 */
export const PROXIMITY_STEP_M = 5;
export const PROXIMITY_V: Record<"H1a" | "H1b" | "H2a" | "H2b", number[]> = {
  H1a: [0.0977, 0.075, 0.0523, 0.0324, 0.0172, 0.0074, 0.0023, 0.0004, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  H1b: [0.4071, 0.3679, 0.3224, 0.273, 0.2217, 0.1714, 0.1253, 0.086, 0.0551, 0.0324, 0.0168, 0.0073, 0.0023, 0.0004, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  H2a: [0.7656, 0.73, 0.6864, 0.6354, 0.5779, 0.5151, 0.4489, 0.3813, 0.3146, 0.2515, 0.1944, 0.1451, 0.104, 0.0709, 0.0453, 0.0265, 0.0138, 0.0059, 0.0019, 0.0003, 0, 0, 0, 0, 0, 0],
  H2b: [0.9044, 0.8835, 0.857, 0.8249, 0.7873, 0.7443, 0.6964, 0.644, 0.5878, 0.5283, 0.4666, 0.4042, 0.3433, 0.286, 0.2338, 0.1872, 0.1462, 0.1108, 0.0809, 0.0563, 0.0367, 0.0218, 0.0114, 0.0049, 0.0016, 0.0003],
};
const NOTIONAL_M3 = { H1a: 30, H1b: 100, H2a: 300, H2b: 1000 } as const;

function tableAt(row: number[], d: number): number {
  const i = (Math.max(PROXIMITY_STEP_M, d) - PROXIMITY_STEP_M) / PROXIMITY_STEP_M;
  const k = Math.floor(i);
  if (k >= row.length - 1) return row[row.length - 1] * (d > 130 ? 0 : 1);
  return row[k] + (row[k + 1] - row[k]) * (i - k);
}

/** V_j(d): interpolated in distance, and in log-volume between the four published classes (a 2 m³ failure is scaled below the 30 m³ row). */
export function proximityVulnerability(volumeM3: number, distM: number): number {
  const keys = ["H1a", "H1b", "H2a", "H2b"] as const;
  if (distM > 130) return 0;
  if (volumeM3 <= NOTIONAL_M3.H1a) return tableAt(PROXIMITY_V.H1a, distM) * clamp(Math.log10(volumeM3 + 1) / Math.log10(31), 0.15, 1);
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (volumeM3 <= NOTIONAL_M3[b]) {
      const t = Math.log(volumeM3 / NOTIONAL_M3[a]) / Math.log(NOTIONAL_M3[b] / NOTIONAL_M3[a]);
      return tableAt(PROXIMITY_V[a], distM) + t * (tableAt(PROXIMITY_V[b], distM) - tableAt(PROXIMITY_V[a], distM));
    }
  }
  return tableAt(PROXIMITY_V.H2b, distM);
}

/**
 * People inside buildings are shielded from small landslides and only the storeys facing the slope are in the debris
 * path: vulnerability of an occupant relative to a person in the open, by landslide class (after the building vs
 * "others" rows of GEO Report 195 Tables 3.7–3.8 and the volume factors of Hong Kong QRA practice).
 */
export const BUILDING_PROTECTION: Record<MagnitudeClass, number> = { "very-minor": 0.1, minor: 0.25, major: 0.5, "very-major": 0.8 };
/** Share of a block's residents on the two lowest storeys (the ones a landslide reaches). */
export const exposedShare = (heightM: number | undefined) => Math.min(1, 2 / Math.max(1, (heightM ?? 6) / 3));
/** Share used for census residents spread over the reach disc (a mix of low-rise and towers). */
export const DISC_EXPOSED_SHARE = 0.3;

/** Debris-resisting barrier: retains small and medium failures, is overtopped by very large ones (illustrative factors). */
export const BARRIER_RETENTION: Record<MagnitudeClass, number> = { "very-minor": 0.8, minor: 0.7, major: 0.5, "very-major": 0.25 };

/** Average of V_j over a disc of radius R around the slope — for census residents spread over the reach disc. */
export function discAverageVulnerability(volumeM3: number, reachM: number): number {
  const R = Math.max(PROXIMITY_STEP_M, reachM);
  let num = 0, den = 0;
  for (let r = PROXIMITY_STEP_M / 2; r < R; r += PROXIMITY_STEP_M) {
    num += proximityVulnerability(volumeM3, r) * r;
    den += r;
  }
  return den ? num / den : 0;
}

// ---------- 5. Elements at risk E_k ----------

/**
 * Potential loss of life in a direct hit by a reference 10 m wide, 50 m³ landslide, by facility group (GEO priority
 * classification, Wong & Ho 1995 in GEO Report 195 Table 3.5). Per-person elements use the proximity vulnerability instead.
 */
export const GROUP_PLL: Record<string, number> = {
  hospital: 3, school: 3, kindergarten: 3, clinic: 3, "fire-station": 2, police: 2, utility: 1, drainage: 0.25, railway: 1, "emergency-route": 1,
  Expressway: 3, "Trunk Road": 3, "Primary Road": 1, "Secondary Road": 0.25, "Local Road": 0.03, road: 0.25,
};
/** Scaling of a facility's PLL with landslide scale, relative to the 50 m³ reference (≈ width ratio). */
export const VOLUME_FACTOR: Record<MagnitudeClass, number> = { "very-minor": 0.1, minor: 0.5, major: 1.5, "very-major": 3 };
/** Share of the day a resident spends at home (temporal presence). */
export const RESIDENT_PRESENCE = 0.65;

export interface ElementAtRisk {
  id: string;
  label: string;
  kind: "residents" | "building" | "facility" | "road";
  distM: number;
  people?: number; // per-person elements (residents, building occupants)
  exposedShare?: number; // share of those people in the storeys a landslide reaches
  groupPll?: number; // facility-group elements
}

/** Expected fatalities if a landslide of the given class occurs (Σ_k P(L_k)·V·E_k for one magnitude class). */
export function consequenceOf(elements: ElementAtRisk[], bin: MagnitudeBin, reachM: number, barrier: number): number {
  const retain = 1 - BARRIER_RETENTION[bin.cls] * barrier;
  const shield = BUILDING_PROTECTION[bin.cls];
  let c = 0;
  for (const e of elements) {
    if (e.kind === "residents") c += (e.people ?? 0) * (e.exposedShare ?? DISC_EXPOSED_SHARE) * RESIDENT_PRESENCE * shield * discAverageVulnerability(bin.volumeM3, reachM) * retain;
    else if (e.people !== undefined) c += e.people * (e.exposedShare ?? 1) * RESIDENT_PRESENCE * shield * proximityVulnerability(bin.volumeM3, e.distM) * retain;
    else if (e.groupPll !== undefined) {
      const decay = proximityVulnerability(bin.volumeM3, e.distM) / Math.max(1e-9, proximityVulnerability(bin.volumeM3, PROXIMITY_STEP_M));
      c += e.groupPll * VOLUME_FACTOR[bin.cls] * decay * retain;
    }
  }
  return c;
}

/** Elements at risk of a slope from its real neighbours: building blocks with residents, facilities and roads by group; census residents as the fallback when no blocks are joined. */
export function elementsOf(
  slope: { centroid: [number, number]; populationNearby: number; census?: { reachM: number } },
  assets: Asset[]
): ElementAtRisk[] {
  const out: ElementAtRisk[] = [];
  const kx = 111_320 * Math.cos((slope.centroid[1] * Math.PI) / 180);
  const dist = (a: Asset) => a.distM ?? Math.hypot((a.location[0] - slope.centroid[0]) * kx, (a.location[1] - slope.centroid[1]) * 111_320);
  let blockPeople = 0;
  for (const a of assets) {
    const d = dist(a);
    if (a.kind === "building") {
      blockPeople += a.populationServed;
      out.push({ id: a.id, label: a.name, kind: "building", distM: d, people: a.populationServed, exposedShare: exposedShare(a.heightM) });
    } else if (a.kind === "road") {
      out.push({ id: a.id, label: a.name, kind: "road", distM: d, groupPll: GROUP_PLL[a.sub ?? "road"] ?? GROUP_PLL.road });
    } else {
      out.push({ id: a.id, label: a.name, kind: "facility", distM: d, groupPll: GROUP_PLL[a.kind] ?? 1 });
    }
  }
  // census residents not already counted as block occupants, spread over the reach disc
  const rest = Math.max(0, slope.populationNearby - blockPeople);
  if (rest > 0) out.push({ id: "census", label: "residents within reach (census)", kind: "residents", distM: 0, people: rest, exposedShare: DISC_EXPOSED_SHARE });
  return out;
}

// ---------- 6. Risk ----------

export interface RiskChain {
  r24Mm: number;
  returnPeriodY: number;
  occurrence: OccurrenceResult;
  magnitude: MagnitudeBin[];
  consequencePerClass: number[]; // expected fatalities given a landslide of each class
  pllEvent: number; // expected fatalities in this storm = P_H · Σ_j P_j · C_j
  pMajor: number; // per-storm probability of a failure ≥ 50 m³
  irEvent: number; // most exposed resident (ground floor of the nearest block): P_H · Σ_j P_j · V_j(d_min) · shield_j · presence
  irAnnual: number; // irEvent / return period of the current 24-h rainfall (indicative)
  mostExposedM: number | null;
  elements: { residents: number; buildings: number; facilities: number; roads: number };
}

export function riskChain(
  occ: OccurrenceResult,
  mags: MagnitudeBin[],
  elements: ElementAtRisk[],
  reachM: number,
  barrier: number,
  r24Mm: number
): RiskChain {
  const consequencePerClass = mags.map((b) => consequenceOf(elements, b, reachM, barrier));
  const pllEvent = occ.p * mags.reduce((s, b, i) => s + b.p * consequencePerClass[i], 0);
  const persons = elements.filter((e) => e.people !== undefined && e.kind !== "residents");
  const nearest = persons.length ? Math.min(...persons.map((e) => e.distM)) : elements.some((e) => e.kind === "residents") ? Math.max(PROXIMITY_STEP_M, reachM / 2) : null;
  const irEvent = nearest === null ? 0 : occ.p * mags.reduce((s, b) => s + b.p * proximityVulnerability(b.volumeM3, nearest) * BUILDING_PROTECTION[b.cls] * (1 - BARRIER_RETENTION[b.cls] * barrier), 0) * RESIDENT_PRESENCE;
  const T = returnPeriodYears(r24Mm);
  return {
    r24Mm,
    returnPeriodY: T,
    occurrence: occ,
    magnitude: mags,
    consequencePerClass,
    pllEvent,
    pMajor: occ.p * mags.filter((b) => b.cls === "major" || b.cls === "very-major").reduce((s, b) => s + b.p, 0),
    irEvent,
    irAnnual: irEvent / T,
    mostExposedM: nearest === null ? null : Math.round(nearest),
    elements: {
      residents: elements.filter((e) => e.kind === "residents").reduce((s, e) => s + (e.people ?? 0), 0),
      buildings: elements.filter((e) => e.kind === "building").length,
      facilities: elements.filter((e) => e.kind === "facility").length,
      roads: elements.filter((e) => e.kind === "road").length,
    },
  };
}

// ---------- 7. Score for the 0–100 band ----------

/** log10 P_H from −6 → 0 to −1 → 1; log10 PLL per storm from −6 → 0 to −1 → 1; score = 100 · (0.55 hazard + 0.45 consequence). */
export const SCORE_MAP = { hazardLo: -6, hazardHi: -1, consLo: -6, consHi: -1, wHazard: 0.55, wCons: 0.45 } as const;
export function scoreFromChain(p: number, pllEvent: number): { score: number; hazardIdx: number; consIdx: number } {
  const m = SCORE_MAP;
  const hazardIdx = clamp((Math.log10(Math.max(1e-12, p)) - m.hazardLo) / (m.hazardHi - m.hazardLo), 0, 1);
  const consIdx = clamp((Math.log10(Math.max(1e-12, pllEvent)) - m.consLo) / (m.consHi - m.consLo), 0, 1);
  return { score: 100 * (m.wHazard * hazardIdx + m.wCons * consIdx), hazardIdx, consIdx };
}

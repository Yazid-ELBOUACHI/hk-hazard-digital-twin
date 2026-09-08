// Glossary of the twin's labels: a one-paragraph plain-language explanation for hover, and the id of the
// "How it is calculated" entry (CALCULATIONS) or dataset (DATA_SOURCES) the label opens when clicked.
// Rendered by <Term id="…"> (src/components/ui/Term.tsx). Keep entries in step with src/core/dataSources.ts.

export interface GlossaryEntry {
  label: string; // default visible text
  what: string; // hover explanation
  calc?: string; // CALCULATIONS id → scrolls to that row on the Data Sources page
  source?: string; // DATA_SOURCES id → scrolls to that dataset row
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  census: {
    label: "census",
    what: "2021 Population Census (Census and Statistics Department) on CSDI: 211 small Tertiary Planning Unit polygons with residents and age bands. The twin takes the polygon around the slope, its residents per km², and counts the people inside a disc of 2.1 × slope height (40–220 m). Real data; the disc is the twin's assumption.",
    calc: "calc-residents",
    source: "census-2021",
  },
  "people-nearby": {
    label: "People nearby",
    what: "Residents within reach of this slope: census density × a disc of 2.1 × slope height (40–220 m). Feeds the exposure KPIs, the consequence chain and the E term of the risk chain.",
    calc: "calc-residents",
  },
  r24: {
    label: "Max rolling 24-h rain",
    what: "R — the largest 24-hour rainfall total at this slope over the trailing day (nearest HKO station, plus the Storm Watch band when active). Hong Kong's landslide correlations and Prof. Zhang's PoLA chain are driven by this number. The return period is log-interpolated through the 1972, 2008 and 2023 storms.",
    calc: "calc-r24",
  },
  "return-period": {
    label: "return period",
    what: "How rare a 24-h rainfall of this size is in Hong Kong: ~2 y at 100 mm, ~50 y at 275 mm (1972), ~200 y at 623 mm (2008), ~1,000 y at 846 mm (7 Sep 2023).",
    calc: "calc-return-period",
  },
  "p-failure": {
    label: "P(failure | R) this storm",
    what: "Occurrence term P(H|R): the probability that this slope fails in the current storm. Starts from the Hong Kong statistical correlation between failure frequency per slope and the max rolling 24-h rainfall for this feature type (GEO Report 144; Xiao, Zhang et al. 2023), then slope geometry, CEDD incident history, natural-terrain landslide density, mitigation works and monitoring evidence add to the log-odds. The value in brackets is the correlation alone.",
    calc: "calc-occurrence",
  },
  magnitude: {
    label: "Magnitude if it fails",
    what: "P(M|H,R): how big the failure would be, in the four Hong Kong classes (< 5, 5–50, 50–500, ≥ 500 m³). Shares start from the 1984–2017 record (45 / 44 / 9.4 / 1.6 %) and shift towards larger failures with heavier rain and taller slopes.",
    calc: "calc-magnitude",
  },
  elements: {
    label: "Elements at risk",
    what: "E: the people and facilities the debris can reach — residents (census), the three nearest LandsD building blocks with estimated occupants, facilities within 500 m and the nearest road, each with its distance. Their vulnerability falls with distance following Hong Kong QRA proximity factors.",
    calc: "calc-elements",
  },
  pll: {
    label: "Expected fatalities (PLL)",
    what: "Potential loss of life: the expected number of deaths from this slope in the current storm = P(failure) × Σ over failure sizes of (share × expected loss if that size occurs). Societal risk per event; sums over the inventory in the KPI panel. Typical values are far below 1.",
    calc: "calc-risk-numbers",
  },
  ir: {
    label: "Individual risk",
    what: "Probability that the most exposed person (a ground-floor occupant of the nearest block) is killed: per event, and divided by the storm's return period as an indicative annual figure. Hong Kong judges 1e-4 per year acceptable for an existing slope and 1e-5 for a new one.",
    calc: "calc-risk-numbers",
  },
  "expected-landslides": {
    label: "Expected landslides · this storm",
    what: "Sum of P(failure | R) over every slope in the inventory: how many registered slopes are expected to fail in the current storm. Comparable with GEO's reported incident counts after a rainstorm.",
    calc: "calc-kpis",
  },
  score: {
    label: "Risk score",
    what: "0–100 = 100 × (0.55 × hazard index + 0.45 × consequence index), both on log scales: hazard from P(failure | R) (1e-6 → 0, 0.1 → 1), consequence from the expected fatalities (1e-6 → 0, 0.1 → 1). Bands: ≥ 80 critical, ≥ 62 high, ≥ 45 elevated, ≥ 28 moderate.",
    calc: "calc-score",
  },
  trend: {
    label: "Trend (3 h)",
    what: "Score now compared with the score 3 h ago on the same chain: ↑ if it rose by more than 2.5 points, ↓ if it fell.",
    calc: "calc-trajectory",
  },
  confidence: {
    label: "Model confidence",
    what: "How much to trust the number: sensor coverage, age of the geometry survey and inspection, a per-slope parameter uncertainty and anomalous sensors. Synthetic today.",
    calc: "calc-confidence",
  },
  "people-at-risk": {
    label: "People near at-risk slopes",
    what: "Residents within reach of every slope currently in the high or critical band (census disc per slope, summed).",
    calc: "calc-kpis",
  },
  "pola-scenario": {
    label: "P(H | R) this storm · PoLA",
    what: "The scenario's storm run through the PoLA occurrence model: the per-storm failure probability from the event's 24-h rainfall share, the antecedent rain and the slope's real features, reduced by the chosen interventions. The stress-test probability above it is a conditional what-if index, not a frequency.",
    calc: "calc-scenario-prob",
  },
  "stress-test": {
    label: "Failure probability (stress test)",
    what: "The Scenario Lab's what-if index (0.01–0.99) from the sliders — saturation, groundwater, drainage, peak hour, quake, interventions. It decides whether the runout and 3D playback run; it is not a frequency.",
    calc: "calc-scenario-prob",
  },
  est: {
    label: "est.",
    what: "Estimated: no open dataset publishes this value, so it is a kind-based assumption (service population, criticality, residents from block height, mitigation condition).",
    calc: "calc-facility-est",
  },
  entli: {
    label: "ENTLI",
    what: "Enhanced Natural Terrain Landslide Inventory (CEDD/GEO): 113,000 landslide crowns mapped from aerial photographs 1924–2023. The twin counts crowns per km² within 500 m of each slope as one of the occurrence terms.",
    calc: "calc-entli",
    source: "cedd-entli-grid",
  },
  monitoring: {
    label: "monitoring evidence",
    what: "Pore-pressure ratio and displacement rate on the slope. Real sensors would update the failure probability; in the prototype they are synthetic signals derived from rainfall plus per-slope noise, and labelled so.",
    calc: "calc-signals",
  },
};

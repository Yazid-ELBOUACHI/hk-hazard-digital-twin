// Plain-language companions to the technical calculation registry. Also used by tooltips.
export interface CalculationGuide {
  summary: string;
  interpretation: string;
}

export const CALCULATION_GUIDE: Record<string, CalculationGuide> = {
  "calc-chain": {
    summary: "The model asks: will the slope fail, how much material could fall, how far could it travel, and who could be harmed? It combines these steps for each possible landslide size to estimate risk.",
    interpretation: "For illustration, a 1% chance of failure multiplied by an average of 2 deaths if failure occurs gives 0.02 expected fatalities per storm. This is an average across possible outcomes, not a prediction of a fractional death.",
  },
  "calc-r24": {
    summary: "Add the rain over a moving 24-hour window, then use the largest of the seven totals sampled across the past day. Rain comes from the nearest weather station, with simulated rain added when Storm Watch is active.",
    interpretation: "Millimetres measure rainfall depth: 100 mm is 10 cm of water on a flat surface before drainage. This is a sampled estimate at the slope; a nearby station may receive different rain.",
  },
  "calc-occurrence": {
    summary: "Estimate the chance of this slope failing during this storm. Start with the rainfall relationship for its slope type, then adjust for height, steepness, past landslides, nearby landslide history, protective works and simulated soil and sensor conditions.",
    interpretation: "A probability of 0.01 means 1%, or about 1 failure in 100 comparable slope-storm situations under the model. Driver shares show the relative size of model adjustments; they are not separate failure probabilities.",
  },
  "calc-magnitude": {
    summary: "If a landslide happens, estimate how likely it is to fall into each of four size groups. Historical shares are adjusted so heavier rain and taller slopes favour larger failures.",
    interpretation: "The four shares add to 100% conditional on failure. They do not mean that failure is certain. Volume is in cubic metres (m³); 1 m³ is a cube one metre on each side.",
  },
  "calc-mobility": {
    summary: "Estimate how likely falling soil or rock is to kill a person at a given distance if a landslide of a particular size occurs. Larger failures can affect people farther away; barriers reduce the modelled impact according to their assumed condition.",
    interpretation: "Mobility means how far debris travels; vulnerability means how severely someone is affected. Here they are combined using distance-based factors, rather than a detailed simulation of every debris path.",
  },
  "calc-elements": {
    summary: "Identify nearby residents, buildings, roads and facilities. Estimate how many people could be exposed, allowing for distance, time spent there and protection from buildings.",
    interpretation: "Exposure means being potentially in harm’s way. It does not mean everyone nearby will be hit or injured. Locations can be real while occupancy and protection factors are assumptions.",
  },
  "calc-risk-numbers": {
    summary: "Multiply the chance of failure by the average harm across possible landslide sizes to get expected fatalities (PLL, potential loss of life). Individual risk instead estimates the chance of death for a modelled person near the slope.",
    interpretation: "Per-event risk applies to this storm; annual risk combines assumed storm frequencies over a year. An expected loss of 0.02 is an average, not a casualty count. Scientific notation 1e-4 means 0.0001, or 0.01% when it represents a probability.",
  },
  "calc-score": {
    summary: "Combine the modelled chance of failure (55% weight) and expected fatalities (45% weight) into a score from 0 to 100. Logarithmic scales make very small risks easier to compare. Higher scores receive more urgent colour bands.",
    interpretation: "A score of 80/100 does not mean an 80% chance of a landslide. The bands are platform ranking thresholds: moderate starts at 28, elevated at 45, high at 62 and critical at 80.",
  },
  "calc-trajectory": {
    summary: "Run the same risk calculation with projected rain and adjusted soil-water and movement signals to show how the score might change. The trend arrow compares the current score with three hours earlier.",
    interpretation: "Up or down means a change greater than 2.5 score points. Future values depend on the forecast and simulated conditions; they are possible developments, not scheduled events.",
  },
  "calc-confidence": {
    summary: "Combine sensor coverage, survey and inspection age, assumed parameter uncertainty and unusual sensor readings into a data-quality indicator. More coverage and fresher information generally increase it.",
    interpretation: "These inputs are synthetic in this prototype. A confidence value of 80% does not establish that the prediction has an 80% chance of being correct.",
  },
  "calc-live-rain": {
    summary: "Assign each slope its nearest Hong Kong Observatory (HKO) station. The server collects hourly rain readings and accumulates a rolling 24-hour total. Storm Watch can add simulated rainfall.",
    interpretation: "mm/h describes rainfall intensity; mm describes the accumulated amount. A partial total covers fewer than 24 hours. The city rainfall tile averages the first 40 slopes, not every location in Hong Kong.",
  },
  "calc-rain-history": {
    summary: "Use the nearest historical rain gauge for each slope, add daily readings into monthly totals, and find each year’s wettest day. For territory reports, calculate daily gauge maxima and means and count landslides reported on that date.",
    interpretation: "A territory maximum is the wettest reporting gauge that day; it does not describe rainfall everywhere. The nearest gauge is a local approximation.",
  },
  "calc-return-period": {
    summary: "Compare a 24-hour rainfall amount with the platform’s reference storm table and estimate between its listed values to describe how rare that amount is.",
    interpretation: "A 100-year level corresponds to about a 1-in-100 chance of being equalled or exceeded in a year under that frequency assumption. It can occur in consecutive years. The table gives an indicative estimate, not a countdown.",
  },
  "calc-susceptibility": {
    summary: "Build an assumed measure of how prone the slope material is to failure using steepness, height, nearby historical landslides and repeatable random values tied to the slope number.",
    interpretation: "Higher values make the model more susceptible to failure. This is a synthetic input, not a laboratory measurement of soil strength or a failure probability.",
  },
  "calc-slope-type": {
    summary: "Read the registration code to distinguish fill (placed material), cut slopes (excavated ground) and retaining walls (structures holding ground back). This selects the starting failure rate.",
    interpretation: "The open record does not separate rock and soil cuts here, so the prototype assigns that split using repeatable random draws. Some classifications are therefore assumptions.",
  },
  "calc-signals": {
    summary: "Generate demonstration sensor readings from rainfall, assumed soil and drainage properties, and repeatable variation. Pore pressure is water pressure in soil spaces; moisture is how wet the soil is; displacement is ground movement. GNSS uses satellite positioning to track movement.",
    interpretation: "These are simulated sensor signals, even when real rain drives them. Movement rate is measured in mm/h; accumulated movement is in mm. They are not field observations of this slope.",
  },
  "calc-residents": {
    summary: "Take residents per square kilometre from the surrounding census area and multiply by the area of an assumed circle around the slope. The circle’s radius is 2.1 times slope height, limited to 40–220 metres.",
    interpretation: "For example, 10,000 residents/km² in a circle of radius 100 m gives about 314 people. This assumes even population density and a circular reach; it is not a count of people on site or predicted casualties.",
  },
  "calc-block-residents": {
    summary: "Estimate storeys by dividing building height by 3 metres, then assume 8 residents per storey for residential blocks or 3 for other buildings, with a minimum of 10 residents.",
    interpretation: "A 30 m residential block gives 10 storeys × 8 = 80 estimated residents. Actual occupancy is not supplied by the building dataset.",
  },
  "calc-facility-est": {
    summary: "Assign each facility or road type an assumed number of people served and an importance score. These values help compare the consequences of service disruption.",
    interpretation: "People served means a possible service population, not people physically inside the facility. Criticality is a model priority score; these figures are not published occupancy counts.",
  },
  "calc-entli": {
    summary: "Count mapped historical landslide starting points, called crowns, in the 25 grid cells around the slope. Divide by the covered area, 1.5625 km², to get landslides per square kilometre.",
    interpretation: "ENTLI is the Enhanced Natural Terrain Landslide Inventory. Higher density indicates more mapped past activity nearby; it is not the chance of a new landslide. The neighbourhood is a square grid approximation.",
  },
  "calc-neighbours": {
    summary: "Link the slope to nearby mapped features: up to three buildings within 150 m, the nearest road within 300 m, up to five facilities within 500 m and protective measures within 200 m.",
    interpretation: "Being linked means being nearby, not necessarily in a landslide’s path. Distances use the slope’s centre and approximate large features.",
  },
  "calc-cascade": {
    summary: "Use the scenario’s debris travel distance, or an estimate from slope height, to identify nearby assets that could be affected. Then describe possible knock-on effects such as road access or service disruption.",
    interpretation: "This is a rule-based what-if chain. Summed service populations may overlap, so they are not a count of unique people affected.",
  },
  "calc-scenario-prob": {
    summary: "Combine the scenario sliders for rain, wetness, groundwater, movement, shaking and protective works into a stress-test index. An index above 0.5 triggers the model’s failure scenario. A separate PoLA calculation estimates per-storm failure probability.",
    interpretation: "The stress-test value is a synthetic what-if index, even where labelled failure probability. A value of 0.7 is not evidence of a 70% real-world failure frequency. Antecedent rain means rain before the storm; runout means debris travel distance.",
  },
  "calc-scenario-runout": {
    summary: "Use slope dimensions and the stress-test index to estimate falling material volume, travel distance and speed. Adjust for shaking, material picked up along the way, protective works and warning lead time, then estimate exposure.",
    interpretation: "Runout is how far debris travels; entrainment is extra material it picks up; overtopping means passing over a barrier. These outputs come from simplified synthetic rules, not a site-calibrated physical simulation.",
  },
  "calc-3d": {
    summary: "Animate the scenario’s debris along its estimated route on real terrain. Count a contact when a displayed object lies inside the corridor already reached by the debris front.",
    interpretation: "People and vehicles are generated for illustration. Displayed contacts are not casualty estimates, and the route does not solve the physics of flow over terrain. A stable scenario releases no debris.",
  },
  "calc-kpis": {
    summary: "City key performance indicators (KPIs) summarise the loaded slope inventory: counts in each risk band, nearby people and assets, and sums of failure probabilities and expected fatalities.",
    interpretation: "For example, 100 slopes each with a 1% failure probability give 1 expected landslide, not a guarantee of one. People near multiple slopes may be counted more than once; the inventory does not cover every possible landslide site.",
  },
  "calc-optimizer": {
    summary: "Compare assumed benefit per dollar for interventions on the 60 highest-scoring eligible slopes. Select options in that order until the budget is used, allowing one option per slope and at most 12 projects.",
    interpretation: "The chosen objective changes what counts as benefit: score reduction, people protected or critical infrastructure. Costs and effectiveness are assumptions; this greedy selection does not guarantee the best possible combination.",
  },
  "calc-reports": {
    summary: "Display the downloaded historical rainfall and landslide records as daily comparisons, wettest years and ranked storm days.",
    interpretation: "These plots describe recorded events. A rainfall and landslide count shown together is a historical comparison, not a model prediction or proof that rain alone caused each incident.",
  },
  "calc-uncertainty": {
    summary: "Combine assumed uncertainty about the rainfall relationship, soil, water, geometry and protective works. Use it to show a range around failure probability; add exposure and vulnerability uncertainty for expected fatalities.",
    interpretation: "The 5th–95th percentile range contains the middle 90% of the model’s assumed distribution, not a guarantee about outcomes. Larger σ (sigma) means more spread. City ranges sum slope bounds and are not a joint 90% interval.",
  },
  "calc-voi": {
    summary: "Estimate whether an inspection or sensor measurement could improve the choice between acting and waiting. Compare expected decision losses before and after possible measurement results, then rank the expected benefit against investigation cost and delay.",
    interpretation: "VOI means value of information; EVPI is the upper limit assuming perfect information. A ranking ratio above 1 means expected benefit exceeds the assumed cost plus delay penalty. Results depend on assumed costs, consequences and how much each observation reduces uncertainty.",
  },
  "calc-storm-report": {
    summary: "Add the modelled failure probabilities and expected fatalities across the loaded inventory, then repeat by district and by map cell. Each grid cell is 750 m east–west by 600 m north–south.",
    interpretation: "Darker cells have higher expected landslide counts, not a guarantee of failure at every location. Totals apply to inventory slopes and depend on the model assumptions; summed uncertainty bounds are an envelope, not a joint interval.",
  },
  "calc-replay": {
    summary: "Run the occurrence model on the 40 wettest recorded days using nearby gauge rainfall, then compare predicted landslide totals with reported incidents linked to inventory slopes.",
    interpretation: "Correlation measures whether predictions rise and fall with observations. The calibration factor is observed divided by predicted totals: 2 means twice as many recorded as predicted overall. Incomplete incident links, a selected inventory and daily rain totals limit the comparison.",
  },
  "calc-nowcast": {
    summary: "Use the Hong Kong Observatory’s near-term rainfall forecast, called a nowcast, to add expected rain from four half-hour periods at each slope’s nearest station. Feed this into projected risk while the platform clock is near real time.",
    interpretation: "The nowcast covers two hours. A +3 h risk projection uses only those two hours of nowcast rain alongside the other projected rain assumptions. The city tile averages the first 40 slopes.",
  },
};

/** Case-insensitive, accent-insensitive AND search across all supplied fields. */
export function matchesDataSearch(query: string, fields: unknown[]): boolean {
  const normalize = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const haystack = normalize(fields.flat(Infinity).filter(v => v !== undefined && v !== null).join(" "));
  return normalize(query).trim().split(/\s+/).filter(Boolean).every(word => haystack.includes(word));
}

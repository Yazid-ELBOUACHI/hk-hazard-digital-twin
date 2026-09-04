// City-scale synthetic dataset generation. Deterministic (seeded), explicitly synthetic.

import {
  Asset,
  AssetKind,
  Incident,
  Mitigation,
  MitigationType,
  Region,
  SensorKind,
  SensorMeta,
  Slope,
  SlopeEvent,
  SlopeType,
  ValidationRecord,
} from "@/core/types";
import { HILL_CLUSTERS, HillCluster, samplePointInCluster, walkInsideCluster, offsetM } from "./geo";
import { clamp, pick, range, rangeInt, rngFor } from "./random";

/** Fixed game-time origin so all freshness/history math is deterministic. */
export const GAME_EPOCH = Date.parse("2026-09-04T08:00:00Z");

const SLOPE_COUNT = 5000;

const GEOLOGIES = [
  "Completely decomposed granite (synthetic)",
  "Completely decomposed volcanics (synthetic)",
  "Colluvium over CDG (synthetic)",
  "Highly decomposed tuff (synthetic)",
  "Fill over decomposed granite (synthetic)",
  "Residual soil / saprolite (synthetic)",
];

const SLOPE_TYPES: SlopeType[] = ["soil-cut", "rock-cut", "fill", "natural", "retaining-wall"];
const SENSOR_KINDS: SensorKind[] = [
  "rainfall",
  "displacement-total",
  "displacement-horizontal",
  "displacement-vertical",
  "pore-pressure",
  "groundwater",
  "gnss-movement",
  "soil-moisture",
];

function isoDaysAgo(days: number): string {
  return new Date(GAME_EPOCH - days * 86400_000).toISOString();
}

function slopeIdFor(cluster: HillCluster, idx: number, rng: () => number): string {
  const sheet = rangeInt(rng, 2, 16);
  const quad = pick(rng, ["NW", "NE", "SW", "SE"]);
  const feat = pick(rng, ["C", "F", "R", "CR"]);
  return `${sheet}${quad}-${feat}/${String(idx).padStart(4, "0")}`;
}

function makePolygon(centroid: [number, number], aspectDeg: number, areaM2: number, rng: () => number): [number, number][] {
  // Irregular octagon elongated across the aspect direction (slope wider than long).
  const widthM = Math.sqrt(areaM2) * range(rng, 1.2, 1.8);
  const depthM = areaM2 / widthM;
  const theta = ((90 - aspectDeg) * Math.PI) / 180; // aspect → math angle of downhill
  const across = [Math.cos(theta + Math.PI / 2), Math.sin(theta + Math.PI / 2)];
  const down = [Math.cos(theta), Math.sin(theta)];
  const pts: [number, number][] = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const rW = (widthM / 2) * (0.75 + rng() * 0.5);
    const rD = (depthM / 2) * (0.75 + rng() * 0.5);
    const e = Math.cos(ang) * rW * across[0] + Math.sin(ang) * rD * down[0];
    const nn = Math.cos(ang) * rW * across[1] + Math.sin(ang) * rD * down[1];
    pts.push(offsetM(centroid, e, nn));
  }
  pts.push(pts[0]);
  return pts;
}

function makeMitigations(rng: () => number, susceptibility: number): Mitigation[] {
  const out: Mitigation[] = [];
  const candidates: MitigationType[] = ["soil-nails", "retaining-wall", "debris-barrier", "surface-drainage", "shotcrete", "rock-mesh"];
  const count = rng() < 0.25 ? 0 : rangeInt(rng, 1, susceptibility > 0.6 ? 3 : 2);
  for (let i = 0; i < count; i++) {
    out.push({
      type: pick(rng, candidates),
      installedYear: rangeInt(rng, 1998, 2025),
      condition: clamp(range(rng, 0.45, 1), 0, 1),
    });
  }
  return out;
}

function makeSensors(slopeId: string, rng: () => number, instrumented: boolean): SensorMeta[] {
  if (!instrumented) return [];
  const kinds = SENSOR_KINDS.filter(() => rng() < 0.62);
  if (kinds.length === 0) kinds.push("rainfall");
  return kinds.map((kind, i) => ({
    id: `${slopeId}-S${i + 1}`,
    kind,
    installedYear: rangeInt(rng, 2016, 2025),
    online: rng() > 0.06,
    anomalous: rng() < 0.05,
  }));
}

function makeHistory(rng: () => number, susceptibility: number): SlopeEvent[] {
  const events: SlopeEvent[] = [];
  const templates: { kind: SlopeEvent["kind"]; label: string }[] = [
    { kind: "inspection", label: "Routine engineer inspection" },
    { kind: "maintenance", label: "Drainage maintenance / clearing" },
    { kind: "uav-survey", label: "UAV photogrammetry survey" },
    { kind: "lidar-survey", label: "LiDAR survey" },
    { kind: "works", label: "Stabilization works package" },
    { kind: "extreme-rainfall", label: "Extreme rainfall event recorded" },
    { kind: "sensor-anomaly", label: "Sensor anomaly investigated" },
    { kind: "minor-movement", label: "Minor movement detected" },
  ];
  const n = rangeInt(rng, 4, 9);
  for (let i = 0; i < n; i++) {
    const t = pick(rng, templates);
    const daysAgo = rangeInt(rng, 10, 2900);
    events.push({ date: isoDaysAgo(daysAgo), kind: t.kind, label: t.label });
  }
  if (susceptibility > 0.72 && rng() < 0.5) {
    events.push({
      date: isoDaysAgo(rangeInt(rng, 200, 2200)),
      kind: "incident",
      label: "Historical landslide incident (synthetic)",
      detail: "Recorded failure with debris reaching downslope catchment.",
    });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

export interface Dataset {
  slopes: Slope[];
  assets: Asset[];
  activeIncidents: Incident[];
  historicalIncidents: Incident[];
  validation: ValidationRecord[];
}

function generateAssetsFor(cluster: HillCluster, ci: number): Asset[] {
  const rng = rngFor("assets", cluster.name);
  const assets: Asset[] = [];
  const roadNames = ["Hillside Road", "Peak Drive", "Valley Access Rd", "Reservoir Rd", "Ridge Path Rd"];
  const nRoads = rangeInt(rng, 2, 4);
  for (let r = 0; r < nRoads; r++) {
    // road stays on land: random walk constrained to the massif footprint
    const line = walkInsideCluster(cluster, rng, 7, 450);
    assets.push({
      id: `RD-${ci}-${r}`,
      kind: "road",
      name: `${pick(rng, roadNames)} ${ci}${r} (synthetic)`,
      location: line[Math.floor(line.length / 2)],
      line,
      populationServed: rangeInt(rng, 800, 20000),
      criticality: range(rng, 0.3, 0.9),
    });
  }
  const bldKinds: AssetKind[] = ["building", "building", "building", "building", "school", "hospital", "railway", "drainage", "utility", "emergency-route"];
  const nB = rangeInt(rng, 10, 18);
  for (let b = 0; b < nB; b++) {
    const kind = pick(rng, bldKinds);
    const loc = samplePointInCluster(cluster, rng); // on land only
    const namePrefix: Record<string, string> = {
      building: "Residential Block",
      school: "School",
      hospital: "Hospital",
      railway: "Rail Segment",
      drainage: "Drainage Culvert",
      utility: "Utility Substation",
      "emergency-route": "Emergency Route",
    };
    assets.push({
      id: `AS-${ci}-${b}`,
      kind,
      name: `${namePrefix[kind] ?? "Asset"} ${cluster.district} ${b} (synthetic)`,
      location: loc,
      populationServed:
        kind === "hospital" ? rangeInt(rng, 10000, 40000) : kind === "school" ? rangeInt(rng, 500, 1800) : kind === "building" ? rangeInt(rng, 300, 4000) : rangeInt(rng, 1000, 15000),
      criticality: kind === "hospital" || kind === "emergency-route" ? range(rng, 0.8, 1) : range(rng, 0.2, 0.8),
    });
  }
  return assets;
}

export function generateDataset(): Dataset {
  const totalWeight = HILL_CLUSTERS.reduce((s, c) => s + c.weight, 0);
  const slopes: Slope[] = [];
  const assets: Asset[] = [];

  HILL_CLUSTERS.forEach((cluster, ci) => {
    assets.push(...generateAssetsFor(cluster, ci));
  });

  let counter = 0;
  HILL_CLUSTERS.forEach((cluster, ci) => {
    const clusterAssets = assets.filter((a) => a.id.includes(`-${ci}-`));
    const n = Math.round((cluster.weight / totalWeight) * SLOPE_COUNT);
    for (let i = 0; i < n; i++) {
      counter++;
      const rng = rngFor("slope", cluster.name, i);
      const id = slopeIdFor(cluster, counter, rng);
      // gaussian-ish placement around the massif centre, clipped to its land footprint (never in the sea)
      const centroid: [number, number] = samplePointInCluster(cluster, rng);
      const aspectDeg = range(rng, 0, 360);
      const areaM2 = range(rng, 900, 42000);
      const slopeAngleDeg = range(rng, 22, 62);
      const heightM = clamp(Math.sqrt(areaM2) * Math.tan((slopeAngleDeg * Math.PI) / 180) * range(rng, 0.25, 0.6), 6, 180);
      const susceptibilityRaw =
        0.28 * (slopeAngleDeg - 22) / 40 +
        0.22 * rng() +
        0.2 * rng() * rng() +
        0.15 * (heightM / 180) +
        0.15 * rng();
      const susceptibility = clamp(susceptibilityRaw, 0.03, 0.97);
      const instrumented = rng() < 0.55 || susceptibility > 0.65;
      const hasData = rng() > 0.07; // ~7% grey: insufficient data
      const slopeType = pick(rng, SLOPE_TYPES);
      const nearby = clusterAssets.filter(() => rng() < 0.22).slice(0, 4);

      slopes.push({
        id,
        name: `${cluster.name} slope ${i + 1}`,
        region: cluster.region,
        district: cluster.district,
        centroid,
        polygon: makePolygon(centroid, aspectDeg, areaM2, rng),
        elevationM: Math.round(cluster.baseElevation * range(rng, 0.25, 1)),
        heightM: Math.round(heightM),
        slopeAngleDeg: Math.round(slopeAngleDeg),
        areaM2: Math.round(areaM2),
        aspectDeg: Math.round(aspectDeg),
        slopeType,
        geology: pick(rng, GEOLOGIES),
        soil: {
          cohesionKPa: Math.round(range(rng, 2, 24)),
          frictionAngleDeg: Math.round(range(rng, 26, 42)),
          permeability: pick(rng, ["low", "medium", "high"] as const),
          saturationBase: range(rng, 0.25, 0.6),
        },
        drainage: {
          type: pick(rng, ["surface-channels", "raking-drains", "catchpits", "none"] as const),
          condition: range(rng, 0.35, 1),
          lastCleared: isoDaysAgo(rangeInt(rng, 20, 700)),
        },
        vegetationCover: range(rng, 0.05, 0.95),
        mitigations: makeMitigations(rng, susceptibility),
        nearbyAssetIds: nearby.map((a) => a.id),
        sensors: makeSensors(id, rng, instrumented),
        history: makeHistory(rng, susceptibility),
        freshness: {
          sensor: new Date(GAME_EPOCH - rangeInt(rng, 1, 30) * 60_000).toISOString(),
          rainfall: new Date(GAME_EPOCH - rangeInt(rng, 2, 15) * 60_000).toISOString(),
          geometry: isoDaysAgo(rangeInt(rng, 5, 900)),
          inspection: isoDaysAgo(rangeInt(rng, 10, 720)),
          simulation: new Date(GAME_EPOCH - rangeInt(rng, 10, 2000) * 60_000).toISOString(),
          record: isoDaysAgo(rangeInt(rng, 1, 60)),
        },
        susceptibility,
        // residents within the slope's reach (log-uniform 15–1,800, denser where residential blocks are linked);
        // asset service catchments are NOT counted here — they are indirect exposure, shown separately
        populationNearby: Math.round(Math.exp(range(rng, Math.log(15), Math.log(1800))) + nearby.filter((a) => a.kind === "building").length * range(rng, 80, 400)),
        hasData,
        isSynthetic: true,
      });
    }
  });

  // Active incidents on some of the most susceptible slopes
  const bySusc = [...slopes].sort((a, b) => b.susceptibility - a.susceptibility);
  const activeIncidents: Incident[] = bySusc.slice(0, 60).filter((_, i) => i % 10 === 0).map((s, i) => {
    const rng = rngFor("incident", s.id);
    const kinds: Incident["kind"][] = ["landslide", "rockfall", "debris-flow", "road-blockage", "flooding"];
    return {
      id: `INC-${1000 + i}`,
      slopeId: s.id,
      kind: pick(rng, kinds),
      location: s.centroid,
      startedAt: new Date(GAME_EPOCH - rangeInt(rng, 20, 400) * 60_000).toISOString(),
      status: pick(rng, ["active", "responding"] as const),
      severity: pick(rng, [1, 2, 2, 3] as const),
      description: "Synthetic incident generated for demonstration.",
    };
  });

  // Historical incidents → validation records
  const historicalIncidents: Incident[] = [];
  const validation: ValidationRecord[] = [];
  bySusc.slice(0, 120).forEach((s, i) => {
    if (i % 4 !== 0) return;
    const rng = rngFor("hist-incident", s.id);
    const date = isoDaysAgo(rangeInt(rng, 60, 2600));
    const inc: Incident = {
      id: `HIST-${2000 + i}`,
      slopeId: s.id,
      kind: pick(rng, ["landslide", "debris-flow", "rockfall"] as const),
      location: s.centroid,
      startedAt: date,
      status: "resolved",
      severity: pick(rng, [1, 2, 3] as const),
      description: "Synthetic historical incident used for model validation demo.",
    };
    historicalIncidents.push(inc);
    const obsFail = range(rng, 2, 30);
    const obsRunout = range(rng, 20, 320);
    const obsDisp = range(rng, 15, 220);
    const obsArea = range(rng, 400, 16000);
    // model error shrinks for more recent model versions
    const ageDays = (GAME_EPOCH - Date.parse(date)) / 86400_000;
    const version = ageDays > 1600 ? "v1.0" : ageDays > 800 ? "v2.0" : "v3.1";
    const errScale = version === "v1.0" ? 0.5 : version === "v2.0" ? 0.3 : 0.15;
    const err = () => 1 + range(rng, -errScale, errScale);
    validation.push({
      incidentId: inc.id,
      slopeId: s.id,
      date,
      modelVersion: version,
      predicted: {
        failureTimeH: +(obsFail * err()).toFixed(1),
        runoutM: Math.round(obsRunout * err()),
        displacementMm: Math.round(obsDisp * err()),
        areaM2: Math.round(obsArea * err()),
      },
      observed: {
        failureTimeH: +obsFail.toFixed(1),
        runoutM: Math.round(obsRunout),
        displacementMm: Math.round(obsDisp),
        areaM2: Math.round(obsArea),
      },
    });
  });

  return { slopes, assets, activeIncidents, historicalIncidents, validation };
}

let cached: Dataset | null = null;
export function getDataset(): Dataset {
  if (!cached) cached = generateDataset();
  return cached;
}

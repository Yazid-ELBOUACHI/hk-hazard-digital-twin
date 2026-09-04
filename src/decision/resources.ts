// Emergency resource allocation — mock prioritization based on risk, exposure,
// uncertainty, criticality and travel time. Production: routing engine + dispatch system.

import type { RiskAssessment, Slope } from "@/core/types";
import { distanceM } from "@/mock/geo";

export interface EmergencyResource {
  id: string;
  kind: "inspection-team" | "uav-team" | "lidar-unit" | "emergency-vehicle" | "engineer" | "temp-barrier";
  label: string;
  base: [number, number];
  available: boolean;
}

export interface Deployment {
  resource: EmergencyResource;
  slopeId: string;
  reason: string;
  travelMin: number;
  priorityScore: number;
}

export const RESOURCES: EmergencyResource[] = [
  { id: "IT-1", kind: "inspection-team", label: "Inspection Team Alpha", base: [114.17, 22.32], available: true },
  { id: "IT-2", kind: "inspection-team", label: "Inspection Team Bravo", base: [114.11, 22.37], available: true },
  { id: "IT-3", kind: "inspection-team", label: "Inspection Team Charlie", base: [114.25, 22.4], available: true },
  { id: "UAV-1", kind: "uav-team", label: "UAV Survey Unit 1", base: [114.2, 22.34], available: true },
  { id: "UAV-2", kind: "uav-team", label: "UAV Survey Unit 2", base: [113.95, 22.28], available: true },
  { id: "LID-1", kind: "lidar-unit", label: "Mobile LiDAR Unit", base: [114.16, 22.33], available: true },
  { id: "EV-1", kind: "emergency-vehicle", label: "Emergency Vehicle 1", base: [114.18, 22.31], available: true },
  { id: "EV-2", kind: "emergency-vehicle", label: "Emergency Vehicle 2", base: [114.13, 22.38], available: true },
  { id: "ENG-1", kind: "engineer", label: "Duty Geotechnical Engineer 1", base: [114.16, 22.28], available: true },
  { id: "ENG-2", kind: "engineer", label: "Duty Geotechnical Engineer 2", base: [114.21, 22.38], available: true },
  { id: "TB-1", kind: "temp-barrier", label: "Temporary Barrier Crew", base: [114.1, 22.36], available: true },
];

export function allocateResources(slopes: Slope[], assessments: Map<string, RiskAssessment>): Deployment[] {
  const targets = [...slopes]
    .map((s) => ({ s, a: assessments.get(s.id)! }))
    .filter(({ a }) => a && (a.category === "high" || a.category === "critical" || (a.category === "elevated" && a.confidence < 0.5)))
    .sort((x, y) => {
      const score = ({ s, a }: { s: Slope; a: RiskAssessment }) =>
        a.score * 0.5 + Math.min(1, s.populationNearby / 1500) * 30 + (1 - a.confidence) * 20;
      return score(y) - score(x);
    })
    .slice(0, RESOURCES.length);

  const deployments: Deployment[] = [];
  const used = new Set<string>();
  for (const { s, a } of targets) {
    // pick best matching available resource: low confidence → UAV/LiDAR; critical → vehicle/engineer; else inspection
    const preferred: EmergencyResource["kind"][] =
      a.confidence < 0.45
        ? ["uav-team", "lidar-unit", "inspection-team"]
        : a.category === "critical"
          ? ["emergency-vehicle", "engineer", "temp-barrier", "inspection-team"]
          : ["inspection-team", "engineer", "uav-team"];
    let best: EmergencyResource | null = null;
    let bestCost = Infinity;
    for (const r of RESOURCES) {
      if (used.has(r.id) || !r.available) continue;
      const rank = preferred.indexOf(r.kind);
      if (rank === -1) continue;
      const travel = distanceM(r.base, s.centroid) / 500; // ~30 km/h → min
      const cost = rank * 25 + travel;
      if (cost < bestCost) {
        bestCost = cost;
        best = r;
      }
    }
    if (!best) continue;
    used.add(best.id);
    const travelMin = Math.round(distanceM(best.base, s.centroid) / 500);
    deployments.push({
      resource: best,
      slopeId: s.id,
      travelMin,
      priorityScore: Math.round(a.score),
      reason:
        a.confidence < 0.45
          ? `High risk with LOW confidence (${Math.round(a.confidence * 100)}%) — verification survey needed`
          : a.category === "critical"
            ? `CRITICAL risk, ${s.populationNearby.toLocaleString()} people nearby`
            : `${a.category.toUpperCase()} risk, preventive inspection`,
    });
  }
  return deployments;
}

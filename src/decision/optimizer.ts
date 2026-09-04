// Intervention portfolio optimizer — mock greedy logic (benefit/cost ranking).
// Production replacement: proper MILP / multi-objective optimization service.

import type { InterventionOption, OptimizerResult, PortfolioItem, RiskAssessment, Slope } from "@/core/types";

export type Objective = "risk" | "population" | "critical-infra";

export function optimizePortfolio(
  slopes: Slope[],
  assessments: Map<string, RiskAssessment>,
  catalog: InterventionOption[],
  budgetHKDm: number,
  objective: Objective
): OptimizerResult {
  const candidates: PortfolioItem[] = [];
  const ranked = [...slopes]
    .filter((s) => {
      const c = assessments.get(s.id)?.category;
      return c === "elevated" || c === "high" || c === "critical";
    })
    .sort((a, b) => (assessments.get(b.id)?.score ?? 0) - (assessments.get(a.id)?.score ?? 0))
    .slice(0, 60);

  for (const s of ranked) {
    const a = assessments.get(s.id)!;
    for (const opt of catalog) {
      if (opt.type === "monitoring-sensors" && a.confidence > 0.6) continue;
      const riskReduction = a.score * (1 - opt.probReductionFactor) * (0.7 + 0.3 * opt.confidence);
      const peopleProtected = Math.round(s.populationNearby * (1 - opt.probReductionFactor) * 0.6);
      candidates.push({
        slopeId: s.id,
        intervention: opt.type,
        costHKDm: opt.costHKDm,
        riskReduction: +riskReduction.toFixed(1),
        peopleProtected,
      });
    }
  }

  const value = (c: PortfolioItem): number => {
    const slope = slopes.find((s) => s.id === c.slopeId)!;
    const hasCritInfra = slope.nearbyAssetIds.some((id) => id.includes("AS-")) && slope.populationNearby > 800;
    switch (objective) {
      case "population":
        return c.peopleProtected / c.costHKDm;
      case "critical-infra":
        return (c.riskReduction * (hasCritInfra ? 2.5 : 0.6)) / c.costHKDm;
      default:
        return c.riskReduction / c.costHKDm;
    }
  };

  candidates.sort((a, b) => value(b) - value(a));

  const chosen: PortfolioItem[] = [];
  const usedSlopes = new Set<string>();
  let spent = 0;
  for (const c of candidates) {
    if (usedSlopes.has(c.slopeId)) continue; // one intervention per slope in mock logic
    if (spent + c.costHKDm > budgetHKDm) continue;
    chosen.push(c);
    usedSlopes.add(c.slopeId);
    spent += c.costHKDm;
    if (chosen.length >= 12) break;
  }

  const objectiveLabel =
    objective === "population" ? "Minimize population exposure" : objective === "critical-infra" ? "Protect critical infrastructure" : "Maximize risk reduction";

  return {
    objective: objectiveLabel,
    budgetHKDm,
    spentHKDm: +spent.toFixed(1),
    items: chosen,
    totalRiskReduction: +chosen.reduce((s, c) => s + c.riskReduction, 0).toFixed(0),
    totalPeopleProtected: chosen.reduce((s, c) => s + c.peopleProtected, 0),
    note: "Mock greedy benefit/cost optimization on synthetic data — demonstration only.",
  };
}

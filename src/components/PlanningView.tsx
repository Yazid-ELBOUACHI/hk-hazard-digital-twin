// Planning — intervention portfolio optimizer. Results appear immediately for the default
// budget and update live as the budget or objective changes; the catalog is folded away.

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/state/store";
import { registry } from "@/core/registry";
import { optimizePortfolio, Objective } from "@/decision/optimizer";
import type { InterventionOption } from "@/core/types";
import { fmtInt } from "@/core/format";
import Collapsible from "./ui/Collapsible";

const OBJECTIVES: { id: Objective; label: string; hint: string }[] = [
  { id: "risk", label: "Maximize risk reduction", hint: "Most risk points removed per dollar" },
  { id: "population", label: "Minimize population exposure", hint: "Protect the most people" },
  { id: "critical-infra", label: "Protect critical infrastructure", hint: "Hospitals, schools, rail and emergency routes first" },
];

export default function PlanningView() {
  const slopes = useStore((s) => s.slopes);
  const assessments = useStore((s) => s.assessments);
  const selectSlope = useStore((s) => s.selectSlope);
  const setView = useStore((s) => s.setView);
  const flyToSlope = useStore((s) => s.flyToSlope);

  const [catalog, setCatalog] = useState<InterventionOption[]>([]);
  const [budget, setBudget] = useState(20);
  const [objective, setObjective] = useState<Objective>("risk");

  useEffect(() => {
    void registry.interventions.getCatalog().then(setCatalog);
  }, []);

  const result = useMemo(
    () => (catalog.length && slopes.length ? optimizePortfolio(slopes, assessments, catalog, budget, objective) : null),
    [slopes, assessments, catalog, budget, objective]
  );

  const openSlope = (id: string) => {
    setView("overview");
    selectSlope(id);
    flyToSlope(id);
  };

  return (
    <div className="page">
      <h1>Intervention Portfolio Optimizer</h1>
      <div className="sub">Where should a fixed mitigation budget go? Move the budget or change the objective — the portfolio updates instantly. Mock optimization on synthetic data.</div>

      <div className="card" style={{ maxWidth: 820 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 22, alignItems: "end" }}>
          <div>
            <div className="stat-label" style={{ marginBottom: 6 }}>Available budget</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <input type="range" min={2} max={200} step={1} value={budget} onChange={(e) => setBudget(+e.target.value)} style={{ flex: 1 }} />
              <span className="stat-big" style={{ fontSize: 20, minWidth: 110, textAlign: "right" }}>
                HK${budget} <span style={{ fontSize: 11, color: "var(--text-2)", fontWeight: 500 }}>M</span>
              </span>
            </div>
          </div>
          <div>
            <div className="stat-label" style={{ marginBottom: 6 }}>Objective</div>
            <select className="role-select" value={objective} onChange={(e) => setObjective(e.target.value as Objective)} title={OBJECTIVES.find((o) => o.id === objective)?.hint}>
              {OBJECTIVES.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {result && (
        <div className="card" style={{ maxWidth: 820 }}>
          <h3>Recommended portfolio</h3>
          <div className="tiles" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 12 }}>
            <div className="tile">
              <div className="tile-l">Spent</div>
              <div className="tile-v">HK${result.spentHKDm}<span className="unit">of {result.budgetHKDm} M</span></div>
            </div>
            <div className="tile">
              <div className="tile-l">Risk removed</div>
              <div className="tile-v" style={{ color: "var(--risk-low)" }}>−{result.totalRiskReduction}<span className="unit">pts</span></div>
            </div>
            <div className="tile">
              <div className="tile-l">People protected</div>
              <div className="tile-v">{fmtInt(result.totalPeopleProtected)}</div>
            </div>
            <div className="tile">
              <div className="tile-l">Measures</div>
              <div className="tile-v">{result.items.length}<span className="unit">slopes</span></div>
            </div>
          </div>

          {result.items.length === 0 ? (
            <div className="muted" style={{ fontSize: 12 }}>Budget too small for any measure in the catalog. Increase it above HK$1.2 M.</div>
          ) : (
            <table className="data">
              <thead>
                <tr><th>#</th><th>Slope</th><th>Intervention</th><th>Cost</th><th>Risk −</th><th>People</th><th /></tr>
              </thead>
              <tbody>
                {result.items.map((i, idx) => (
                  <tr key={i.slopeId} style={{ cursor: "pointer" }} onClick={() => openSlope(i.slopeId)} title="Open this slope's Command Center">
                    <td className="muted">{idx + 1}</td>
                    <td style={{ fontFamily: "var(--mono)" }}>{i.slopeId}</td>
                    <td>{catalog.find((c) => c.type === i.intervention)?.label ?? i.intervention}</td>
                    <td>HK${i.costHKDm} M</td>
                    <td style={{ color: "var(--risk-low)" }}>−{i.riskReduction}</td>
                    <td>{fmtInt(i.peopleProtected)}</td>
                    <td style={{ color: "#7db4ff", fontFamily: "var(--sans)" }}>open →</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="row-hint">{result.note}</div>
        </div>
      )}

      <div style={{ maxWidth: 820 }}>
        <Collapsible title="Intervention catalog (indicative, synthetic)" storageKey="planning.catalog" summary={`${catalog.length} measures · HK$1.2–14 M`}>
          <table className="data">
            <thead>
              <tr><th>Measure</th><th>Cost</th><th>Failure prob. after</th><th>Runout after</th><th>Confidence</th></tr>
            </thead>
            <tbody>
              {catalog.map((c) => (
                <tr key={c.type} title={c.description}>
                  <td>{c.label}</td>
                  <td>HK${c.costHKDm} M</td>
                  <td>×{c.probReductionFactor} <span className="muted">({Math.round((1 - c.probReductionFactor) * 100)}% lower)</span></td>
                  <td>×{c.runoutReductionFactor} <span className="muted">({Math.round((1 - c.runoutReductionFactor) * 100)}% shorter)</span></td>
                  <td>{Math.round(c.confidence * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row-hint">Hover a row for the measure description. Factors multiply the baseline failure probability and runout distance.</div>
        </Collapsible>
      </div>
    </div>
  );
}

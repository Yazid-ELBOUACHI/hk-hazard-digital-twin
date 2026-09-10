// Planning — intervention portfolio optimizer. Results appear immediately for the default
// budget and update live as the budget or objective changes; the catalog is folded away.

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/state/store";
import { registry } from "@/core/registry";
import { optimizePortfolio, Objective } from "@/decision/optimizer";
import type { InterventionOption } from "@/core/types";
import { fmtInt } from "@/core/format";
import Collapsible from "./ui/Collapsible";
import Term from "./ui/Term";

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

  // REAL: slopes in CEDD's LPM works programme — the money already committed by GEO, and a calibration
  // check for the synthetic score (does the model also rank the slopes GEO judged substandard?)
  const programmed = useMemo(() => {
    const rows = slopes
      .filter((s) => s.works)
      .map((s) => ({ s, a: assessments.get(s.id) }))
      .sort((x, y) => (y.a?.score ?? 0) - (x.a?.score ?? 0));
    const inProgress = rows.filter(({ s }) => s.works!.status === "in-progress").length;
    const elevatedPlus = rows.filter(({ a }) => a && (a.category === "elevated" || a.category === "high" || a.category === "critical")).length;
    return { rows, inProgress, elevatedPlus };
  }, [slopes, assessments]);

  // value of information: the slopes where one observation would most change this storm's precautionary decision
  const { voiRows, actNow, worthIt } = useMemo(() => {
    const rows = slopes
      .map((s) => ({ s, a: assessments.get(s.id)!, q: assessments.get(s.id)?.qra }))
      .filter((x): x is { s: (typeof slopes)[number]; a: NonNullable<typeof x.a>; q: NonNullable<typeof x.q> } => !!x.a && !!x.q?.voiUpgrade?.best)
      .sort((x, y) => y.q.voiUpgrade!.best!.voiHKDm - x.q.voiUpgrade!.best!.voiHKDm)
      .slice(0, 12);
    const act = slopes.filter((s) => assessments.get(s.id)?.qra?.voiUpgrade?.decision === "upgrade").length;
    return { voiRows: rows, actNow: act, worthIt: rows.filter((r) => r.q.voiUpgrade!.worthIt).length };
  }, [slopes, assessments]);

  return (
    <div className="page">
      <h1>Intervention Portfolio Optimizer</h1>
      <div className="sub">Where should a fixed mitigation budget go? Move the budget or change the objective — the portfolio updates instantly. Mock optimization on a synthetic risk score; population from the 2021 census.</div>

      {programmed.rows.length > 0 && (
        <div className="card">
          <h3>
            Already programmed by GEO — LPM works
            <span className="hint badge real">REAL · CEDD LPMitP</span>
          </h3>
          <div className="tiles" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 10 }}>
            <div className="tile">
              <div className="tile-l">Slopes in the programme</div>
              <div className="tile-v">{programmed.rows.length}<span className="unit">in this inventory</span></div>
            </div>
            <div className="tile">
              <div className="tile-l">Works started</div>
              <div className="tile-v">{programmed.inProgress}<span className="unit">of {programmed.rows.length}</span></div>
            </div>
            <div className="tile">
              <div className="tile-l">Model agrees (elevated+)</div>
              <div className="tile-v" style={{ color: programmed.elevatedPlus / programmed.rows.length > 0.5 ? "var(--risk-low)" : "var(--risk-elevated)" }}>
                {Math.round((programmed.elevatedPlus / programmed.rows.length) * 100)}%<span className="unit">calibration check</span>
              </div>
            </div>
          </div>
          <table className="data">
            <thead>
              <tr><th>Slope</th><th>Contract</th><th>Start → completion</th><th>Status</th><th>Model score</th><th /></tr>
            </thead>
            <tbody>
              {programmed.rows.slice(0, 8).map(({ s, a }) => (
                <tr key={s.id} style={{ cursor: "pointer" }} onClick={() => openSlope(s.id)} title={s.works!.location}>
                  <td style={{ fontFamily: "var(--mono)" }}>{s.id}</td>
                  <td>{s.works!.contract}</td>
                  <td style={{ fontSize: 11 }}>{s.works!.startLabel} → {s.works!.completionLabel}</td>
                  <td><span className={`flag ${s.works!.status === "in-progress" ? "real" : "stale"}`}>{s.works!.status}</span></td>
                  <td>{a ? <span className={`badge ${a.category}`}>{a.score}</span> : "—"}</td>
                  <td style={{ color: "#7db4ff", fontFamily: "var(--sans)" }}>open →</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row-hint">
            {programmed.rows.length > 8 && `Showing 8 of ${programmed.rows.length}. `}
            These slopes are excluded from the portfolio below — GEO's Landslip Prevention and Mitigation Programme has already committed to them. The calibration figure is the share
            our synthetic score also places in elevated or above.
          </div>
        </div>
      )}

      <div className="card">
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
        <div className="card">
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

      {voiRows.length > 0 && (
        <div className="card">
          <h3>
            Where to investigate next — <Term id="voi-upgrade">value of information for the upgrade decision</Term>
            <span className="hint badge fresh">decision-aware sensing</span>
          </h3>
          <div className="sub" style={{ marginBottom: 8 }}>
            For each slope the twin asks which investigation would most change the decision to upgrade it now (HK$5 M, 25-year horizon) or defer, per HK$ and hour it costs. {actNow} slope{actNow === 1 ? "" : "s"} warrant an upgrade on the prior alone; {worthIt} of the {voiRows.length} listed have an investigation that pays for itself.
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="data">
              <thead>
                <tr><th>Slope</th><th>Band</th><th>Annual P(failure)</th><th>Decision</th><th>Best investigation</th><th>VOI</th><th>Cost · time</th><th>× cost</th><th>Pays?</th></tr>
              </thead>
              <tbody>
                {voiRows.map(({ s, a, q }) => (
                  <tr key={s.id} style={{ cursor: "pointer" }} onClick={() => openSlope(s.id)} title={q.voiUpgrade!.options.map((o) => `${o.label}: VOI HK$${o.voiHKDm.toFixed(3)} M / HK$${o.costHKDm} M`).join("\n")}>
                    <td style={{ fontFamily: "var(--mono)" }}>{s.id}<span className="muted" style={{ marginLeft: 6 }}>{s.district}</span></td>
                    <td><span className={`badge ${a.category}`}>{a.category}</span></td>
                    <td>{q.pAnnual.toExponential(1)} /y</td>
                    <td style={{ color: q.voiUpgrade!.decision === "upgrade" ? "#ff8577" : undefined }}>{q.voiUpgrade!.decision}</td>
                    <td>{q.voiUpgrade!.best!.label}</td>
                    <td>HK${q.voiUpgrade!.best!.voiHKDm.toFixed(3)} M</td>
                    <td>HK${q.voiUpgrade!.best!.costHKDm} M · {q.voiUpgrade!.best!.hours} h</td>
                    <td>{q.voiUpgrade!.best!.ratio.toFixed(2)}</td>
                    <td style={{ color: q.voiUpgrade!.worthIt ? "var(--risk-low)" : "var(--text-2)" }}>{q.voiUpgrade!.worthIt ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row-hint">VOI = expected loss now − expected loss after the investigation (preposterior, Raiffa–Schlaifer) on the annual failure belief, VSL HK$30 M × 25 y against a HK$5 M upgrade; investigation costs are assumptions. The storm-time precaution decision is on each slope's Overview. See Data sources → How it is calculated.</div>
        </div>
      )}

      <div>
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

// Consequence cascade for one slope: what a failure would hit, what that would trigger,
// and who is affected. Uses the latest simulation for this slope when one exists,
// otherwise an indicative geometric reach so the chain is never empty.

import { useMemo } from "react";
import { useStore } from "@/state/store";
import { fmtInt } from "@/core/format";
import { distanceM, distanceToLineM, fmtDistance } from "@/core/geo";
import type { Asset, AssetKind, RiskAssessment, Slope } from "@/core/types";

const KIND_META: Record<AssetKind, { icon: string; label: string; color: string }> = {
  road: { icon: "🛣", label: "Road", color: "#8fa2ba" },
  "emergency-route": { icon: "🚑", label: "Emergency route", color: "#ff8577" },
  building: { icon: "🏢", label: "Residential", color: "#8fa2ba" },
  hospital: { icon: "🏥", label: "Hospital", color: "#e56db1" },
  school: { icon: "🏫", label: "School", color: "#7db4ff" },
  kindergarten: { icon: "🎒", label: "Kindergarten", color: "#9ec5ff" },
  clinic: { icon: "🩺", label: "Clinic", color: "#66d4cf" },
  "fire-station": { icon: "🚒", label: "Fire station", color: "#ff6b3d" },
  police: { icon: "🚓", label: "Police station", color: "#b9a9f5" },
  railway: { icon: "🚆", label: "Rail", color: "#9a86e8" },
  drainage: { icon: "🚰", label: "Drainage", color: "#38b6d8" },
  utility: { icon: "⚡", label: "Utility", color: "#e8c33a" },
};

interface Impact {
  asset: Asset;
  distM: number;
  inReach: boolean;
}

interface Effect {
  icon: string;
  title: string;
  detail: string;
  severity: "high" | "med" | "low";
}

export default function ConsequenceChain({ slope, assessment, assets }: { slope: Slope; assessment: RiskAssessment; assets: Asset[] }) {
  const simResult = useStore((s) => s.simResult);
  const sim = simResult && simResult.slopeId === slope.id ? simResult : null;

  // reach: simulated runout if available, otherwise an indicative geometric reach (~2× height, 25° reach angle)
  const reachM = sim ? sim.runoutDistanceM : Math.round(slope.heightM * 2.1);
  const reachIsIndicative = !sim;
  const failureProb = sim ? sim.failureProbability : null;

  const impacts = useMemo<Impact[]>(() => {
    return assets
      .map((a) => {
        const distM = a.line ? distanceToLineM(slope.centroid, a.line) : distanceM(slope.centroid, a.location);
        return { asset: a, distM, inReach: distM <= reachM * 2.5 };
      })
      .sort((x, y) => x.distM - y.distM);
  }, [assets, slope, reachM]);

  const has = (...kinds: AssetKind[]) => impacts.filter((i) => kinds.includes(i.asset.kind));

  const effects: Effect[] = [];
  const roads = has("road", "emergency-route");
  const drains = has("drainage");
  const utils = has("utility");
  const rail = has("railway");
  const hospitals = has("hospital");
  const schools = has("school", "kindergarten");
  const homes = has("building");
  const responders = has("fire-station", "police");

  if (roads.length) {
    const emergency = roads.some((r) => r.asset.kind === "emergency-route");
    effects.push({
      icon: "🚧",
      title: `Road closure (${roads.length} segment${roads.length > 1 ? "s" : ""})`,
      detail: sim ? `simulated road impact: ${sim.roadImpact}` : `debris on carriageway within ~${fmtDistance(reachM)} of the toe`,
      severity: sim ? (sim.roadImpact === "likely" ? "high" : sim.roadImpact === "possible" ? "med" : "low") : "med",
    });
    if (emergency || hospitals.length) {
      effects.push({ icon: "⏱", title: "Emergency access degraded", detail: emergency ? "an emergency route is in the corridor" : "hospital access depends on nearby roads", severity: "high" });
    }
  }
  if (drains.length) {
    effects.push({
      icon: "🌊",
      title: "Drainage blockage → local flooding",
      detail: sim ? `downstream flooding: ${sim.downstreamFlooding}` : `${drains.length} culvert${drains.length > 1 ? "s" : ""} below the slope`,
      severity: sim ? (sim.downstreamFlooding === "likely" ? "high" : sim.downstreamFlooding === "possible" ? "med" : "low") : "med",
    });
  }
  if (utils.length) effects.push({ icon: "⚡", title: "Utility outage", detail: `${utils.length} substation${utils.length > 1 ? "s" : ""} exposed`, severity: "med" });
  if (rail.length) effects.push({ icon: "🚆", title: "Rail service disruption", detail: `${rail.length} segment${rail.length > 1 ? "s" : ""} in the corridor`, severity: "high" });
  if (schools.length) effects.push({ icon: "🏫", title: "School evacuation trigger", detail: `${schools.length} school${schools.length > 1 ? "s" : ""} / kindergarten${schools.length > 1 ? "s" : ""} within 500 m`, severity: "med" });
  if (responders.length) effects.push({ icon: "🚒", title: "Responder base in the corridor", detail: `${responders.map((r) => r.asset.name).join(", ")} — access to be kept clear`, severity: "med" });
  if (homes.length) effects.push({ icon: "🏢", title: "Buildings exposed", detail: sim ? `${sim.buildingsExposed} buildings in simulated footprint` : `${homes.length} residential blocks nearby`, severity: homes.length > 2 ? "high" : "med" });
  if (effects.length === 0) effects.push({ icon: "✓", title: "No registered assets in the corridor", detail: "consequences limited to the slope and its immediate surroundings", severity: "low" });

  // direct exposure = residents within reach; asset catchments are indirect (service disruption), never added to the headline
  const servedPeople = impacts.reduce((s, i) => s + i.asset.populationServed, 0);
  const totalPeople = sim ? sim.peopleExposed : slope.populationNearby;
  // people by asset kind (largest first) — the breakdown behind the headline number
  const byKind = Object.entries(
    impacts.reduce<Record<string, number>>((acc, i) => {
      const k = KIND_META[i.asset.kind].label;
      acc[k] = (acc[k] ?? 0) + i.asset.populationServed;
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1]);

  const sevColor = (s: Effect["severity"]) => (s === "high" ? "var(--risk-high)" : s === "med" ? "var(--risk-elevated)" : "var(--risk-low)");

  return (
    <div>
      <div className="cq-grid">
        {/* Stage 1: trigger */}
        <div className="cq-col">
          <div className="cq-stage">1 · Trigger</div>
          <div className="cq-card trigger">
            <div className="cq-title">Failure of {slope.id}</div>
            <div className="cq-meta">
              {failureProb !== null ? (
                <>
                  <b style={{ color: failureProb > 0.5 ? "#ff8577" : "var(--risk-low)" }}>{Math.round(failureProb * 100)}%</b> probability in the last scenario
                </>
              ) : (
                <>
                  current risk <b>{assessment.score}/100</b> · {assessment.category}
                </>
              )}
            </div>
            <div className="cq-meta">
              {slope.slopeType} · {slope.heightM} m · {slope.slopeAngleDeg}°
            </div>
          </div>
          <div className="cq-arrow-h">
            debris reach ≈ <b>{fmtDistance(reachM)}</b>
            {reachIsIndicative && <span className="muted"> (indicative — run a scenario)</span>}
            {sim && <span className="muted"> · {fmtInt(sim.displacedVolumeM3)} m³</span>}
          </div>
        </div>

        {/* Stage 2: direct impacts */}
        <div className="cq-col">
          <div className="cq-stage">2 · Direct impacts</div>
          {impacts.length === 0 && <div className="cq-card muted">No building, road or facility within reach of this slope in the LandsD / facility records.</div>}
          {impacts.slice(0, 5).map(({ asset, distM, inReach }) => {
            const m = KIND_META[asset.kind];
            return (
              <div className="cq-card asset" key={asset.id} style={{ borderLeftColor: m.color, opacity: inReach ? 1 : 0.7 }} title={asset.name}>
                <div className="cq-title">
                  <span className="cq-ico">{m.icon}</span>
                  {m.label}
                  <span className="cq-dist">{fmtDistance(distM)}</span>
                </div>
                <div className="cq-meta">
                  {asset.sub ? `${asset.sub} · ` : ""}{asset.heightM ? `${asset.heightM} m · ` : ""}serves ~{fmtInt(asset.populationServed)}{asset.estimated ? " (est.)" : ""} · criticality {Math.round(asset.criticality * 100)}%
                  {!inReach && <span className="flag stale" style={{ marginLeft: 6 }}>beyond reach</span>}
                </div>
              </div>
            );
          })}
          {impacts.length > 5 && <div className="row-hint">+{impacts.length - 5} more assets</div>}
        </div>

        {/* Stage 3: cascading effects */}
        <div className="cq-col">
          <div className="cq-stage">3 · Cascading effects</div>
          {effects.map((e) => (
            <div className="cq-card effect" key={e.title} style={{ borderLeftColor: sevColor(e.severity) }}>
              <div className="cq-title">
                <span className="cq-ico">{e.icon}</span>
                {e.title}
              </div>
              <div className="cq-meta">{e.detail}</div>
            </div>
          ))}
        </div>

        {/* Stage 4: people */}
        <div className="cq-col">
          <div className="cq-stage">4 · People affected</div>
          <div className="cq-card people">
            <div className="cq-big">~{fmtInt(totalPeople)}</div>
            <div className="cq-meta">{sim ? "directly exposed in the last scenario" : "residents within reach (direct)"}</div>
          </div>
          <div className="cq-card">
            <div className="cq-meta">
              <div className="cq-kv"><span>Residents nearby</span><b>~{fmtInt(slope.populationNearby)}</b></div>
              {byKind.length > 0 && (
                <div className="cq-kv" style={{ marginTop: 4 }}><span>Indirect · service catchment</span><b>~{fmtInt(servedPeople)}</b></div>
              )}
              {byKind.slice(0, 3).map(([k, n]) => (
                <div className="cq-kv" key={k} style={{ paddingLeft: 10 }}><span>{k}</span><span>~{fmtInt(n)}</span></div>
              ))}
              {hospitals.length > 0 && <div className="cq-kv"><span>Hospital catchment</span><b style={{ color: "#e56db1" }}>at risk</b></div>}
              {sim && <div className="cq-kv"><span>Buildings in footprint</span><b>{sim.buildingsExposed}</b></div>}
            </div>
          </div>
        </div>
      </div>
      <div className="row-hint">
        Failure → debris → blockage / closure → service and access loss. {sim ? "Figures from the latest Scenario Lab run." : "Run a scenario to replace indicative values with simulated ones."}
      </div>
    </div>
  );
}

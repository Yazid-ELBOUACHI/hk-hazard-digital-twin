// "Ask the Twin" — prototype natural-language interface over the platform's structured
// synthetic data. Intent matching is rule-based; production would route to an LLM with
// tool access to these same repositories/engines.

import type { Incident, KpiSnapshot, RiskAssessment, Slope, WeatherState } from "@/core/types";
import { generateSitrep } from "./sitrep";
import { optimizePortfolio } from "./optimizer";
import type { InterventionOption } from "@/core/types";
import { fmtInt } from "@/core/format";
import { GLOSSARY } from "@/core/glossary";
import { CALCULATIONS, DATA_SOURCES } from "@/core/dataSources";
import { buildStormReport } from "@/decision/stormReport";

export interface TwinContext {
  gameTime: number;
  slopes: Slope[];
  assessments: Map<string, RiskAssessment>;
  kpi: KpiSnapshot | null;
  weather: WeatherState | null;
  incidents: Incident[];
  catalog: InterventionOption[];
  pastAssess: (slope: Slope, hoursAgo: number) => RiskAssessment;
}

export interface TwinAnswer {
  text: string;
  slopeIds?: string[];
}

const HELP = `I can answer questions about the synthetic twin state, e.g.:
• "Which slopes require attention tonight?"
• "Why is slope <ID> high risk?"
• "What happens if rainfall reaches 300 mm?"
• "Which roads are threatened?"
• "What changed since yesterday?"
• "Which intervention gives the best risk reduction?"
• "Show slopes with high risk and low confidence"
• "Which slopes have stale geometry?"
• "Prepare a situation report"
• "Storm report" / "How many landslides are expected?"
• "What should we observe next?" / "Where is the value of information highest?"
• "What does the nowcast say for the next 2 hours?"
• "How is PLL calculated?" / "What is the census term?" — grounded on the calculation registry`;

export function askTwin(question: string, ctx: TwinContext): TwinAnswer {
  const q = question.toLowerCase();
  const { slopes, assessments } = ctx;
  const ranked = [...slopes]
    .map((s) => ({ s, a: assessments.get(s.id)! }))
    .filter((x) => x.a)
    .sort((x, y) => y.a.score - x.a.score);

  // --- situation report ---
  if (q.includes("situation report") || q.includes("sitrep") || q.includes("briefing")) {
    if (!ctx.kpi || !ctx.weather) return { text: "KPI/weather state still loading — try again in a moment." };
    return { text: generateSitrep(ctx.gameTime, ctx.kpi, ctx.weather, slopes, assessments, ctx.incidents) };
  }

  // --- why is slope X risky ---
  const idMatch = question.match(/\b(\d{1,2}(?:NW|NE|SW|SE)-[A-Z]{1,2}\/\d{3,4})\b/i);
  if ((q.includes("why") || q.includes("explain")) && idMatch) {
    const id = idMatch[1].toUpperCase();
    const a = assessments.get(id);
    if (!a) return { text: `I can't find slope ${id} in the inventory.` };
    const drivers = a.drivers.map((d) => `  ${d.factor.padEnd(22)} ${d.sharePct}%`).join("\n");
    return {
      text: `${id} — ${a.category.toUpperCase()} (${a.score}/100), confidence ${Math.round(a.confidence * 100)}%\n\nRisk drivers:\n${drivers}\n\n${a.explanation}`,
      slopeIds: [id],
    };
  }
  if (idMatch) {
    const id = idMatch[1].toUpperCase();
    const a = assessments.get(id);
    const s = slopes.find((x) => x.id === id);
    if (a && s)
      return {
        text: `${id} (${s.district}, ${s.region}): ${a.category.toUpperCase()} ${a.score}/100, trend ${a.trend}, confidence ${Math.round(a.confidence * 100)}%. ${a.explanation}`,
        slopeIds: [id],
      };
  }

  // --- grounded explanations: glossary + calculation registry + datasets ---
  if (/how (is|are|do you|does|was)|calculated|formula|what is|what does|what are|define|meaning of|explain (the |what )?(pll|voi|census|entli|magnitude|score|occurrence|vulnerability|nowcast|uncertainty|evpi)/.test(q) && !idMatch) {
    const words = q.replace(/[^a-z0-9|() ]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !["what", "how", "the", "does", "are", "is", "calculated", "define", "explain", "meaning", "you", "twin", "this", "that", "with", "for", "and"].includes(w));
    const score = (text: string) => words.reduce((s, w) => s + (text.toLowerCase().includes(w) ? 1 : 0), 0);
    const hits = [
      ...Object.entries(GLOSSARY).map(([id, g]) => ({ kind: "term", id, name: g.label, score: score(`${id} ${g.label} ${g.what}`) * 2, body: g.what, calc: g.calc })),
      ...CALCULATIONS.map((c) => ({ kind: "calc", id: c.id, name: c.name, score: score(`${c.name} ${c.output} ${c.how.join(" ")}`), body: `${c.output}\n${c.how.map((h) => `  – ${h}`).join("\n")}\n  inputs: ${c.inputs.join("; ")}${c.reference ? `\n  reference: ${c.reference}` : ""}\n  code: ${c.code}`, calc: c.id })),
      ...DATA_SOURCES.map((d) => ({ kind: "dataset", id: d.id, name: d.name, score: score(`${d.name} ${d.provider} ${d.what}`), body: `${d.what}\n  used for: ${d.usedFor}\n  ${d.connection} · ${d.realness} · ${d.freshness}`, calc: undefined as string | undefined })),
    ]
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    if (hits.length) {
      return {
        text: hits.map((h) => `${h.kind === "term" ? "◆" : h.kind === "calc" ? "∑" : "▣"} ${h.name}\n${h.body}${h.calc ? `\n  → Reports → Data Sources → How it is calculated (${h.calc})` : ""}`).join("\n\n") + "\n\nGrounded on the twin's own glossary, calculation registry and dataset registry (src/core/dataSources.ts) — no external model.",
      };
    }
  }

  // --- storm report (PoLA) ---
  if (q.includes("storm report") || q.includes("expected landslides") || q.includes("how many landslides") || q.includes("prompt risk")) {
    if (!slopes.length || !assessments.size) return { text: "The first risk pass has not finished yet — try again in a moment." };
    return { text: buildStormReport(slopes, assessments, ctx.weather, ctx.kpi, ctx.gameTime).text };
  }

  // --- value of information: what to observe / investigate next ---
  if (q.includes("observe") || q.includes("value of information") || q.includes("voi") || q.includes("measure next") || q.includes("inspect next") || q.includes("where to inspect") || q.includes("investigate") || q.includes("evpi")) {
    const storm = /storm|now|today|tonight|precaution/.test(q);
    const pick = (a: RiskAssessment) => (storm ? a.qra?.voi : a.qra?.voiUpgrade);
    const rows = ranked.filter(({ a }) => pick(a)?.best).sort((x, y) => pick(y.a)!.best!.voiHKDm - pick(x.a)!.best!.voiHKDm).slice(0, 8);
    if (!rows.length) return { text: "No value-of-information results yet — wait for the first risk pass." };
    return {
      text:
        (storm
          ? `Where one observation would most change this storm's precautionary decision (value of information per HK$ and hour):\n`
          : `Where one investigation would most change the decision to upgrade the slope (HK$5 M, 25-year horizon):\n`) +
        rows
          .map(({ s, a }) => {
            const v = pick(a)!;
            return `• ${s.id} (${s.district}) — ${a.category.toUpperCase()}, ${storm ? `P(H|R) ${a.qra!.pFailure5.toExponential(1)}–${a.qra!.pFailure95.toExponential(1)}` : `annual P(failure) ${a.qra!.pAnnual.toExponential(1)}`}: ${v.best!.label}, VOI HK$${v.best!.voiHKDm.toFixed(3)} M for HK$${v.best!.costHKDm} M in ${v.best!.hours} h (×${v.best!.ratio.toFixed(2)}${v.worthIt ? ", pays for itself" : ", below its cost"}); decision on the prior: ${v.decision}`;
          })
          .join("\n") +
        `\n\nPreposterior analysis on the PoLA occurrence belief (σ on the log-odds); VSL HK$30 M, precaution HK$0.08 M, upgrade HK$5 M over 25 y, observation costs assumed. Add "storm" for the precaution decision; Planning → “Where to investigate next”.`,
      slopeIds: rows.map(({ s }) => s.id),
    };
  }

  // --- HKO nowcast ---
  if (q.includes("nowcast") || q.includes("next 2 hours") || q.includes("next two hours") || q.includes("next 2 h")) {
    const n = ctx.weather?.nowcast;
    if (!n) return { text: "The HKO 2-hour gridded nowcast is not reachable right now (it needs the server proxy at /api/live/nowcast)." };
    return { text: `HKO gridded rainfall nowcast issued ${n.updated.slice(11, 16)} HKT: next 2 h territory mean ${n.mean2h} mm, maximum ${n.max2h} mm at the twin's ${n.stations} stations (windows ending ${n.steps.map((t) => t.slice(11, 16)).join(", ")}). The +1 h and +3 h trajectories add the nearest station's nowcast to each slope's rainfall.` };
  }

  // --- what happens if rainfall reaches N mm ---
  const rainMatch = q.match(/(\d{2,3})\s*mm/);
  if ((q.includes("what happens") || q.includes("what if") || q.includes("reaches")) && rainMatch) {
    const target = parseInt(rainMatch[1], 10);
    const rainNow = ctx.kpi?.rainfall24hMm ?? 100;
    const delta = (Math.min(1.25, target / 240) - Math.min(1.25, rainNow / 240)) * 26; // rainfall driver weight
    let high = 0, critical = 0;
    const escalating: string[] = [];
    for (const { s, a } of ranked) {
      if (!s.hasData) continue;
      const newScore = a.score + delta + Math.max(0, target - rainNow) * 0.02 * s.susceptibility * 100 * 0.01;
      if (newScore >= 80) critical++;
      else if (newScore >= 62) high++;
      if (newScore >= 62 && a.score < 62 && escalating.length < 8) escalating.push(s.id);
    }
    return {
      text:
        `Projected picture at ${target} mm / 24 h (vs ${rainNow} mm now) — first-order estimate from the risk model:\n` +
        `• ~${critical} slopes CRITICAL, ~${high} slopes HIGH territory-wide\n` +
        `• Newly escalating into HIGH+: ${escalating.join(", ") || "none"}\n` +
        `For engineering-grade numbers, run the Scenario Lab at ${target} mm on specific slopes (library nodes at 50-mm steps).`,
      slopeIds: escalating,
    };
  }

  // --- roads threatened ---
  if (q.includes("road")) {
    const roadMap = new Map<string, string[]>();
    for (const { s, a } of ranked) {
      if (a.category !== "high" && a.category !== "critical") continue;
      for (const id of s.nearbyAssetIds) if (id.startsWith("RD-")) roadMap.set(id, [...(roadMap.get(id) ?? []), s.id]);
    }
    const list = [...roadMap.entries()].slice(0, 10);
    return {
      text:
        `${roadMap.size} road segments are near HIGH/CRITICAL slopes:\n` +
        list.map(([r, ss]) => `• ${r} — threatened by ${ss.slice(0, 3).join(", ")}`).join("\n"),
      slopeIds: list.flatMap(([, ss]) => ss).slice(0, 10),
    };
  }

  // --- changed since yesterday ---
  if (q.includes("changed") || q.includes("since yesterday")) {
    const movers: { id: string; from: string; to: string; d: number }[] = [];
    for (const { s, a } of ranked.slice(0, 400)) {
      const past = ctx.pastAssess(s, 24);
      if (past.category !== a.category) movers.push({ id: s.id, from: past.category, to: a.category, d: a.score - past.score });
    }
    movers.sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
    const up = movers.filter((m) => m.d > 0).slice(0, 8);
    const down = movers.filter((m) => m.d < 0).slice(0, 5);
    return {
      text:
        `Since yesterday (24 h of game time):\n` +
        `• ${up.length}+ slopes moved UP a band: ${up.map((m) => `${m.id} (${m.from}→${m.to})`).join(", ") || "none"}\n` +
        `• ${down.length} moved DOWN: ${down.map((m) => `${m.id} (${m.from}→${m.to})`).join(", ") || "none"}\n` +
        `Territory rainfall 24 h: ${ctx.kpi?.rainfall24hMm ?? "?"} mm.`,
      slopeIds: up.map((m) => m.id),
    };
  }

  // --- best intervention ---
  if (q.includes("intervention") || q.includes("risk reduction")) {
    const res = optimizePortfolio(slopes, assessments, ctx.catalog, 20, "risk");
    const top = res.items.slice(0, 5);
    return {
      text:
        `Best value interventions under a HK$20 M budget (mock optimizer):\n` +
        top.map((i) => `• ${i.intervention} @ ${i.slopeId} — HK$${i.costHKDm} M, −${i.riskReduction} risk pts, ~${fmtInt(i.peopleProtected)} people protected`).join("\n") +
        `\nTotal: HK$${res.spentHKDm} M → −${res.totalRiskReduction} risk pts. See Planning → Optimizer for the full portfolio.`,
      slopeIds: top.map((i) => i.slopeId),
    };
  }

  // --- high risk low confidence ---
  if (q.includes("low confidence") || (q.includes("confidence") && q.includes("high"))) {
    const list = ranked.filter(({ a }) => (a.category === "high" || a.category === "critical") && a.confidence < 0.55).slice(0, 10);
    return {
      text:
        `${list.length} HIGH/CRITICAL slopes with confidence < 55% (verification candidates):\n` +
        list.map(({ s, a }) => `• ${s.id} (${s.district}) — ${a.category} ${a.score}/100, confidence ${Math.round(a.confidence * 100)}%`).join("\n"),
      slopeIds: list.map(({ s }) => s.id),
    };
  }

  // --- stale geometry ---
  if (q.includes("stale") || q.includes("geometry")) {
    const stale = ranked
      .filter(({ s }) => ctx.gameTime - Date.parse(s.freshness.geometry) > 365 * 86400_000)
      .slice(0, 10);
    const total = slopes.filter((s) => ctx.gameTime - Date.parse(s.freshness.geometry) > 365 * 86400_000).length;
    return {
      text:
        `${total} slopes have geometry older than 12 months. Highest-risk among them:\n` +
        stale.map(({ s, a }) => `• ${s.id} — ${a.category} ${a.score}/100, geometry from ${s.freshness.geometry.slice(0, 10)}`).join("\n"),
      slopeIds: stale.map(({ s }) => s.id),
    };
  }

  // --- attention tonight / priorities ---
  if (q.includes("attention") || q.includes("tonight") || q.includes("priorit") || q.includes("worry")) {
    const list = ranked
      .filter(({ a }) => a.category === "critical" || a.category === "high" || a.trajectory.some((t) => t.horizonH <= 12 && (t.category === "critical" || t.category === "high")))
      .slice(0, 10);
    return {
      text:
        `${list.length} slopes need attention over the next 12 h:\n` +
        list
          .map(({ s, a }) => {
            const esc = a.trajectory.find((t) => t.horizonH > 0 && (t.category === "critical" || t.category === "high"));
            return `• ${s.id} (${s.district}) — now ${a.category.toUpperCase()} ${a.score}/100${esc && esc.category !== a.category ? `, → ${esc.category.toUpperCase()} at +${esc.horizonH} h` : ""}, conf ${Math.round(a.confidence * 100)}%`;
          })
          .join("\n"),
      slopeIds: list.map(({ s }) => s.id),
    };
  }

  return { text: HELP };
}

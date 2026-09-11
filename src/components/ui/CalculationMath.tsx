import { memo, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { Calculation } from "@/core/dataSources";
import { CALCULATION_FORMULAS, FORMULA_OPERATORS, type FormulaSymbol } from "@/core/calculationFormulas";

// Only repository-authored equations are rendered. Keep MathML for assistive technology.
export const MathExpression = memo(function MathExpression({ tex, display = false }: { tex: string; display?: boolean }) {
  const html = katex.renderToString(tex, { displayMode: display, output: "htmlAndMathml", throwOnError: false, trust: false, strict: "error" });
  return <span className="math-expression" dangerouslySetInnerHTML={{ __html: html }} />;
});

function Symbols({ symbols, caption }: { symbols: FormulaSymbol[]; caption: string }) {
  return <div className="formula-table-wrap">
    <table className="formula-symbols">
      <caption>{caption}</caption>
      <thead><tr><th scope="col">Symbol</th><th scope="col">Meaning in this calculation</th><th scope="col">Units / scale</th></tr></thead>
      <tbody>{symbols.map(([symbol, meaning, units]) => <tr key={symbol}>
        <th scope="row"><MathExpression tex={symbol} /></th><td>{meaning}</td><td>{units}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export default function CalculationMath({ calculation: c, initiallyOpen, searching }: { calculation: Calculation; initiallyOpen: boolean; searching: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const guide = CALCULATION_FORMULAS[c.id];
  return <details className="calc-technical" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>Technical details — inputs, equations and references</summary>
    {open && <>
      <p><strong>Output: </strong>{c.output}</p>
      <h5>Inputs and their origin</h5>
      <ul>{c.inputs.map((x, i) => <li key={i}>{x}</li>)}</ul>
      {guide && <>
        {guide.equations.length > 0 && <p className="formula-convention">Use numerical inputs in the units listed below. Symbols are defined locally for this calculation; fractions use 0–1 unless marked as percentages.</p>}
        {guide.equations.map((equation, i) => <figure className="formula-card" key={equation.label}>
          <figcaption id={`${c.id}-eq-${i}`}><span className="formula-number">{i + 1}</span>{equation.label}</figcaption>
          <div className="formula-scroll" tabIndex={0} role="region" aria-labelledby={`${c.id}-eq-${i}`}>
            <MathExpression tex={equation.tex} display />
          </div>
          <p className="formula-reading">{equation.reading}</p>
        </figure>)}
        {guide.symbols.length > 0 && <Symbols symbols={guide.symbols} caption="Symbols and units" />}
        {guide.notes?.map(note => <p key={note} className="formula-note">{note}</p>)}
        {guide.equations.length > 0 && <details className="formula-operators">
          <summary>Mathematical notation — sums, logarithms, bounds and probabilities</summary>
          <Symbols symbols={FORMULA_OPERATORS} caption="How to read the operators" />
        </details>}
      </>}
      <details className="formula-method-notes" open={searching || guide?.equations.length === 0}>
        <summary>Additional method notes and coefficient assumptions</summary>
        <ol>{c.how.map((x, i) => <li key={i}>{x}</li>)}</ol>
      </details>
      {c.reference && <p><strong>Reference: </strong>{c.reference}</p>}
      <p className="calc-code"><strong>Implementation: </strong>{c.code}</p>
    </>}
  </details>;
}

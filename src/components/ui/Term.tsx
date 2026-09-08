// A glossary term: hover (or focus) shows a plain-language explanation; click opens the matching row of
// Reports → Data Sources ("How it is calculated" or the dataset) and flashes it. Entries live in src/core/glossary.ts.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GLOSSARY } from "@/core/glossary";
import { useStore } from "@/state/store";

/** Navigate to the Data Sources page and scroll to a row id (a CALCULATIONS or DATA_SOURCES id). */
export function openCalculation(rowId: string): void {
  const st = useStore.getState();
  st.openCommandCenter(false);
  st.setReportsTab("sources");
  st.setView("reports");
  const started = performance.now();
  const tryScroll = () => {
    const el = document.getElementById(rowId);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.remove("calc-flash");
      void el.offsetWidth; // restart the animation
      el.classList.add("calc-flash");
      return;
    }
    if (performance.now() - started < 3000) requestAnimationFrame(tryScroll);
  };
  requestAnimationFrame(tryScroll);
}

export default function Term({ id, children, className }: { id: string; children?: ReactNode; className?: string }) {
  const entry = GLOSSARY[id];
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null);

  useEffect(() => {
    if (!pos) return;
    const hide = () => setPos(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [pos]);

  if (!entry) return <>{children ?? id}</>;
  const target = entry.calc ?? entry.source;

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const above = r.top > window.innerHeight * 0.55;
    setPos({ x: Math.min(Math.max(8, r.left), window.innerWidth - 348), y: above ? r.top - 8 : r.bottom + 8, above });
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`term ${className ?? ""}`}
        onMouseEnter={show}
        onMouseLeave={() => setPos(null)}
        onFocus={show}
        onBlur={() => setPos(null)}
        onClick={(e) => {
          e.stopPropagation();
          setPos(null);
          if (target) openCalculation(target);
        }}
        aria-label={`${entry.label}: ${entry.what}`}
      >
        {children ?? entry.label}
      </button>
      {pos &&
        createPortal(
          <div className="term-pop" style={{ left: pos.x, top: pos.above ? undefined : pos.y, bottom: pos.above ? window.innerHeight - pos.y : undefined }} role="tooltip">
            <b>{entry.label}</b>
            {entry.what}
            {target && <span className="go">Click to see how it is calculated →</span>}
          </div>,
          document.body
        )}
    </>
  );
}

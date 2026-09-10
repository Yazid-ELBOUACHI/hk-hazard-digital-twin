// What's new — rendered from the changelog registry in src/core/changelog.ts. Opening the page marks the latest
// release as seen for this browser (the banner link stops glowing).

import { useEffect } from "react";
import { CHANGELOG, markLatestSeen, type ChangeKind } from "@/core/changelog";
import { openCalculation } from "./ui/Term";

const KIND: Record<ChangeKind, { label: string; cls: string }> = {
  feature: { label: "feature", cls: "fresh" },
  data: { label: "real data", cls: "real" },
  model: { label: "model", cls: "elevated" },
  ui: { label: "interface", cls: "moderate" },
  fix: { label: "fix", cls: "low" },
};

export default function WhatsNewPane({ onSeen }: { onSeen?: () => void }) {
  useEffect(() => {
    markLatestSeen();
    onSeen?.();
  }, [onSeen]);

  return (
    <div style={{ maxWidth: 1200 }}>
      <h1>What's new</h1>
      <div className="sub">
        Every feature, dataset and model change, newest first — kept in step with the code in <code>src/core/changelog.ts</code>. Entries link to the calculation or dataset behind them.
      </div>
      {CHANGELOG.map((r, i) => (
        <div className="card" key={r.id}>
          <h3>
            {r.title}
            <span className="hint" style={{ fontFamily: "var(--mono)" }}>{r.date}</span>
            {i === 0 && <span className="hint badge fresh">latest</span>}
          </h3>
          {r.items.map((it, j) => (
            <div className="action-row" key={j} style={{ alignItems: "flex-start" }}>
              <span className={`badge ${KIND[it.kind].cls}`} style={{ minWidth: 64, textAlign: "center", marginTop: 2 }}>{KIND[it.kind].label}</span>
              <span className="txt">
                <b>{it.title}</b>
                {it.real && <span className="badge real" style={{ marginLeft: 6, fontSize: 8.5 }}>real</span>}
                <div style={{ marginTop: 2 }}>{it.what}</div>
                {(it.where || it.calc || it.source) && (
                  <div className="muted" style={{ fontSize: 10.5, marginTop: 3 }}>
                    {it.where && <span>{it.where}</span>}
                    {it.calc && (
                      <>
                        {it.where && " · "}
                        <button className="term" onClick={() => openCalculation(it.calc!)}>how it is calculated →</button>
                      </>
                    )}
                    {it.source && (
                      <>
                        {(it.where || it.calc) && " · "}
                        <button className="term" onClick={() => openCalculation(it.source!)}>dataset →</button>
                      </>
                    )}
                  </div>
                )}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Ask the Twin — chat interface over the rule-based Q&A engine.
// Answers are computed instantly; the UI adds a short "thinking" beat and streams the text
// so the interaction reads like a conversation rather than a form submit.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useStore } from "@/state/store";
import { registry } from "@/core/registry";
import { askTwin, TwinAnswer } from "@/decision/askTwin";
import { fmtClock } from "@/core/format";
import type { InterventionOption } from "@/core/types";

interface Turn {
  id: number;
  q: string;
  a: TwinAnswer;
  askedAt: number; // game time
  status: "thinking" | "streaming" | "done";
}

const SUGGESTIONS: { cat: string; q: string }[] = [
  { cat: "Triage", q: "Which slopes require attention tonight?" },
  { cat: "What if", q: "What happens if rainfall reaches 300 mm?" },
  { cat: "Exposure", q: "Which roads are threatened?" },
  { cat: "Change", q: "What changed since yesterday?" },
  { cat: "Decide", q: "Which intervention gives the best risk reduction?" },
  { cat: "Data gaps", q: "Show slopes with high risk and low confidence" },
];
const MORE = ["Which slopes have stale geometry?", "Prepare a situation report", "Why is slope 13SW-CR/0026 risky?"];

export default function AskTwinView() {
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [catalog, setCatalog] = useState<InterventionOption[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const selectSlope = useStore((s) => s.selectSlope);
  const setView = useStore((s) => s.setView);
  const flyToSlope = useStore((s) => s.flyToSlope);

  useEffect(() => {
    void registry.interventions.getCatalog().then(setCatalog);
    inputRef.current?.focus();
  }, []);

  const busy = turns.some((t) => t.status !== "done");

  const scrollToEnd = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const ask = (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    const st = useStore.getState();
    const answer = askTwin(question, {
      gameTime: st.gameTime,
      slopes: st.slopes,
      assessments: st.assessments,
      kpi: st.kpi,
      weather: st.weather,
      incidents: st.incidents,
      catalog,
      pastAssess: (slope, hoursAgo) => registry.risk.projectUnderStorm(slope, st.gameTime - hoursAgo * 3600_000, 0),
    });
    const id = Date.now();
    setTurns((l) => [...l, { id, q: question, a: answer, askedAt: st.gameTime, status: "thinking" }]);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    requestAnimationFrame(scrollToEnd);
    // brief "thinking" beat proportional to answer length, then stream
    const beat = Math.min(900, 350 + answer.text.length * 0.6);
    setTimeout(() => setTurns((l) => l.map((t) => (t.id === id ? { ...t, status: "streaming" } : t))), beat);
  };

  const finish = (id: number) => setTurns((l) => l.map((t) => (t.id === id ? { ...t, status: "done" } : t)));

  const goToSlope = (id: string) => {
    setView("overview");
    selectSlope(id);
    flyToSlope(id);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask(input);
    }
  };

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = Math.min(140, el.scrollHeight) + "px";
  };

  return (
    <div className="page ask-page">
      <div className="chat-shell">
        <div className="chat-head">
          <h1>Ask the Twin</h1>
          <span className="badge synth">Synthetic · rule-based</span>
          {turns.length > 0 && (
            <button className="btn sm" onClick={() => setTurns([])}>
              New conversation
            </button>
          )}
        </div>

        <div className="chat-scroll" ref={scrollRef}>
          {turns.length === 0 ? (
            <div className="chat-hero">
              <div className="orb" />
              <h2>What do you want to know about Hong Kong's slopes?</h2>
              <p>
                Ask in plain language. The twin answers from its live state — risk scores, forecasts, sensors, incidents — and links straight to
                the slopes it mentions.
              </p>
              <div className="chat-cards">
                {SUGGESTIONS.map((s) => (
                  <button key={s.q} onClick={() => ask(s.q)}>
                    <span className="cat">{s.cat}</span>
                    {s.q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            turns.map((t) => (
              <div key={t.id}>
                <div className="msg user">
                  <div className="bubble">{t.q}</div>
                </div>
                <div className="msg twin">
                  <div className={`avatar ${t.status === "thinking" ? "thinking" : ""}`} />
                  <div className="body">
                    <div className="who">
                      <span>Twin</span>
                      <span>· state at {fmtClock(t.askedAt).slice(0, 9)}</span>
                    </div>
                    {t.status === "thinking" ? (
                      <div className="typing"><span /><span /><span /></div>
                    ) : (
                      <Streamed text={t.a.text} done={t.status === "done"} onDone={() => finish(t.id)} onTick={scrollToEnd} />
                    )}
                    {t.status === "done" && t.a.slopeIds && t.a.slopeIds.length > 0 && (
                      <div className="slope-chips">
                        {t.a.slopeIds.map((id) => (
                          <button key={id} className="slope-chip" onClick={() => goToSlope(id)} title="Open in the Slope Command Center">
                            📍 {id}
                          </button>
                        ))}
                      </div>
                    )}
                    {t.status === "done" && (
                      <div className="tools">
                        <button onClick={() => void navigator.clipboard?.writeText(t.a.text)}>Copy</button>
                        <button onClick={() => ask(t.q)}>Ask again</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="composer-wrap">
          {turns.length > 0 && (
            <div className="chat-suggest">
              {[...SUGGESTIONS.map((s) => s.q), ...MORE].map((q) => (
                <button key={q} className="chip" onClick={() => ask(q)} disabled={busy}>
                  {q}
                </button>
              ))}
            </div>
          )}
          <div className="composer">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              placeholder="Ask about slopes, risk, scenarios, interventions…"
              onChange={(e) => {
                setInput(e.target.value);
                autoGrow(e.target);
              }}
              onKeyDown={onKey}
            />
            <button className="send" onClick={() => ask(input)} disabled={!input.trim() || busy} title="Send (Enter)">
              ↑
            </button>
          </div>
          <div className="composer-foot">
            <span>Enter to send · Shift+Enter for a new line</span>
            <span>Answers come from synthetic twin state, not real HK data</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Streams text word-by-word with a cursor; renders instantly once `done`. */
function Streamed({ text, done, onDone, onTick }: { text: string; done: boolean; onDone: () => void; onTick: () => void }) {
  const [n, setN] = useState(done ? text.length : 0);

  useEffect(() => {
    if (done) return;
    let i = 0;
    let cancelled = false;
    const step = () => {
      if (cancelled) return;
      // advance to the next word boundary; faster on long answers
      const chunk = text.length > 600 ? 6 : text.length > 250 ? 4 : 2;
      let j = i;
      for (let k = 0; k < chunk && j < text.length; k++) {
        j = text.indexOf(" ", j + 1);
        if (j === -1) { j = text.length; break; }
      }
      i = j;
      setN(i);
      onTick();
      if (i >= text.length) {
        onDone();
      } else {
        setTimeout(step, 18 + Math.random() * 22);
      }
    };
    const t = setTimeout(step, 30);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, done]);

  return (
    <div className="text">
      {text.slice(0, n)}
      {!done && <span className="cursor" />}
    </div>
  );
}

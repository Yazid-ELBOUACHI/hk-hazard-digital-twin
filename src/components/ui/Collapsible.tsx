// Progressive-disclosure container: a compact header that reveals detail on demand.
// Used across pages so secondary information never competes with the primary decision content.

import { useState, type ReactNode } from "react";

interface Props {
  title: string;
  /** Short text shown next to the title while collapsed (e.g. "89 slopes · 282 sensors offline"). */
  summary?: ReactNode;
  defaultOpen?: boolean;
  /** Persist open/closed state under this key (localStorage). */
  storageKey?: string;
  children: ReactNode;
  className?: string;
}

function readStored(key: string | undefined, fallback: boolean): boolean {
  if (!key) return fallback;
  try {
    const v = localStorage.getItem(`hkdt.collapsible.${key}`);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

export default function Collapsible({ title, summary, defaultOpen = false, storageKey, children, className = "" }: Props) {
  const [open, setOpen] = useState(() => readStored(storageKey, defaultOpen));

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (storageKey) {
      try {
        localStorage.setItem(`hkdt.collapsible.${storageKey}`, next ? "1" : "0");
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <div className={`collapsible ${open ? "open" : ""} ${className}`}>
      <button type="button" className="collapsible-head" onClick={toggle} aria-expanded={open}>
        <span className="chev">{open ? "▾" : "▸"}</span>
        <span className="title">{title}</span>
        {!open && summary && <span className="summary">{summary}</span>}
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}

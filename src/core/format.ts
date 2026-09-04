export function timeAgo(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} days ago`;
}

export function isStale(iso: string, now: number, staleDays: number): boolean {
  return now - Date.parse(iso) > staleDays * 86400_000;
}

export function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

export function fmtClock(t: number): string {
  const d = new Date(t);
  return d.toISOString().slice(11, 16) + " UTC · " + d.toISOString().slice(0, 10);
}

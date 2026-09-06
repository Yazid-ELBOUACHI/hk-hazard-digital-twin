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

const hkDateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function fmtClock(t: number): string {
  const p = Object.fromEntries(hkDateTime.formatToParts(t).map(({ type, value }) => [type, value]));
  return `${p.hour}:${p.minute} HKT · ${p.year}-${p.month}-${p.day}`;
}

export function fmtDate(t: number): string {
  return fmtClock(t).split(" · ")[1];
}

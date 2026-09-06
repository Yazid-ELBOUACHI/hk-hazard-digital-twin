// Live rainfall from the Hong Kong Observatory — REAL data, polled every 5 minutes.
//
// Preferred path: our server (`/api/live/rainfall`, see server/liveRain.js), which proxies HKO's
// hourly feed and keeps a rolling 24-hour accumulation per station. Fallback when the server is
// unreachable (e.g. static preview): HKO's Open Data API directly — it is CORS-open, but then only
// the past-hour intensity is known, not the 24-h total.

import stationsJson from "@/live/baked/hkoStations.json";
import { reportSource } from "@/core/dataSources";

export interface LiveStation {
  id: string;
  name: string;
  lon: number;
  lat: number;
  mmHr: number; // rainfall in the past hour
  mm24: number | null; // rolling 24-h total (null when unknown)
  hoursCounted?: number; // hours that contributed to mm24
}

export interface LiveRain {
  obsTime: string; // HKO observation time (ISO, HKT)
  fetchedAt: string;
  hours24: number; // hours of history behind the 24-h totals (24 = complete)
  source: "server" | "direct";
  stations: LiveStation[];
}

const SERVER_URL = "/api/live/rainfall";
const HKO_DIRECT = "https://data.weather.gov.hk/weatherAPI/opendata/hourlyRainfall.php?lang=en";
const STATIONS = stationsJson as { id: string; name: string; lon: number; lat: number }[];

async function fromServer(): Promise<LiveRain | null> {
  try {
    const r = await fetch(SERVER_URL, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return null;
    const j = (await r.json()) as LiveRain & { error?: string };
    if (j.error || !Array.isArray(j.stations)) return null;
    return j;
  } catch {
    return null;
  }
}

async function fromHkoDirect(): Promise<LiveRain> {
  const r = await fetch(HKO_DIRECT, { cache: "no-store" });
  if (!r.ok) throw new Error(`HKO ${r.status}`);
  const j = (await r.json()) as { obsTime: string; hourlyRainfall: { automaticWeatherStationID: string; automaticWeatherStation: string; value: string }[] };
  const coords = new Map(STATIONS.map((s) => [s.id, s]));
  const stations: LiveStation[] = [];
  for (const s of j.hourlyRainfall) {
    const c = coords.get(s.automaticWeatherStationID);
    const v = parseFloat(s.value);
    if (!c || !Number.isFinite(v)) continue;
    stations.push({ id: c.id, name: s.automaticWeatherStation, lon: c.lon, lat: c.lat, mmHr: v, mm24: null });
  }
  return { obsTime: j.obsTime, fetchedAt: new Date().toISOString(), hours24: 0, source: "direct", stations };
}

export async function fetchLiveRain(): Promise<LiveRain> {
  try {
    const live = (await fromServer()) ?? (await fromHkoDirect());
    const max = live.stations.reduce((m, s) => Math.max(m, s.mmHr), 0);
    reportSource("hko-live", {
      ok: true,
      count: live.stations.length,
      note: `${live.source === "server" ? "via server" : "direct, intensity only"} · obs ${live.obsTime.slice(11, 16)} HKT · max ${max} mm/h · 24-h window ${live.hours24}/24 h`,
    });
    return live;
  } catch (err) {
    reportSource("hko-live", { ok: false, note: String((err as Error)?.message ?? err) });
    throw err;
  }
}

/** Poll HKO on a real-time interval; returns a stop function. `immediate=false` skips the first tick (already fetched at boot). */
export function startLiveRainPolling(onUpdate: (r: LiveRain) => void, intervalMs = 5 * 60_000, immediate = true): () => void {
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    fetchLiveRain()
      .then((r) => { if (!stopped) onUpdate(r); })
      .catch((err) => console.warn("HKO live rainfall unavailable:", err));
  };
  if (immediate) tick();
  const id = setInterval(tick, intervalMs);
  return () => { stopped = true; clearInterval(id); };
}

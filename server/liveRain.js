// HKO live rainfall proxy + rolling 24-hour accumulator. Shared by the Express server
// (`/api/live/rainfall`, behind the password gate) and the Vite dev middleware, so `npm run dev`
// sees the same live data as production.
//
// HKO publishes "rainfall in the past hour" per automatic weather station. It does not publish a
// 24-hour total per station, so we keep the latest past-hour value for each clock hour and sum the
// last 24 buckets. The window is persisted to server/.state/rain.json (gitignored) so a restart does
// not wipe it; on an ephemeral host the payload's `hours24` says how many hours are actually covered.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(__dirname, ".state");
const STATE_FILE = path.join(STATE_DIR, "rain.json");
const STATIONS_FILE = path.join(__dirname, "..", "src", "live", "baked", "hkoStations.json");

const HKO_HOURLY = "https://data.weather.gov.hk/weatherAPI/opendata/hourlyRainfall.php?lang=en";
const TTL_MS = 5 * 60_000; // HKO updates hourly; re-check every 5 min
const WINDOW_MS = 24 * 3600_000;
const HOUR_MS = 3600_000;

const stations = JSON.parse(fs.readFileSync(STATIONS_FILE, "utf8"));

/** state.hourly[hourBucketISO][stationId] = mm in that hour */
let state = { hourly: {} };
try {
  state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  if (!state || typeof state.hourly !== "object") state = { hourly: {} };
} catch {
  /* fresh start */
}

function save() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch (err) {
    console.warn("live rain: could not persist state —", err?.message ?? err);
  }
}

let cache = { at: 0, payload: null };
let inflight = null;

async function refresh() {
  const res = await fetch(HKO_HOURLY, { headers: { "User-Agent": "hk-hazard-twin/1.0" } });
  if (!res.ok) throw new Error(`HKO ${res.status}`);
  const j = await res.json();
  const obsMs = Date.parse(j.obsTime);
  if (!Number.isFinite(obsMs)) throw new Error("HKO: bad obsTime");

  // latest past-hour reading per station, filed under its clock-hour bucket
  const hour = {};
  for (const s of j.hourlyRainfall ?? []) {
    const v = parseFloat(s.value);
    if (Number.isFinite(v) && v >= 0) hour[s.automaticWeatherStationID] = v;
  }
  const bucket = new Date(Math.floor(obsMs / HOUR_MS) * HOUR_MS).toISOString();
  state.hourly[bucket] = hour;
  for (const k of Object.keys(state.hourly)) if (obsMs - Date.parse(k) > WINDOW_MS + HOUR_MS) delete state.hourly[k];
  save();

  const window = Object.keys(state.hourly).filter((k) => obsMs - Date.parse(k) < WINDOW_MS);
  const out = stations.map((st) => {
    let sum = 0, n = 0;
    for (const k of window) {
      const v = state.hourly[k][st.id];
      if (v !== undefined) { sum += v; n++; }
    }
    return { ...st, mmHr: hour[st.id] ?? 0, mm24: n ? Math.round(sum * 10) / 10 : null, hoursCounted: n };
  });
  return { obsTime: j.obsTime, fetchedAt: new Date().toISOString(), hours24: window.length, source: "server", stations: out };
}

export async function getLiveRain() {
  if (cache.payload && Date.now() - cache.at < TTL_MS) return cache.payload;
  if (!inflight) {
    inflight = refresh()
      .then((payload) => { cache = { at: Date.now(), payload }; return payload; })
      .finally(() => { inflight = null; });
  }
  try {
    return await inflight;
  } catch (err) {
    if (cache.payload) return cache.payload; // serve the last good payload while HKO is unreachable
    throw err;
  }
}

/** Node http handler (works for Express and for Vite's connect middleware). */
export async function liveRainHandler(_req, res) {
  try {
    const payload = await getLiveRain();
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(payload));
  } catch (err) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: String(err?.message ?? err) }));
  }
}

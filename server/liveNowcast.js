// HKO gridded rainfall nowcast proxy — REAL data. HKO publishes, every 12 minutes, the half-hourly accumulated
// rainfall nowcast for the next two hours on a ~2 km grid over the Pearl River Delta
// (https://data.weather.gov.hk/weatherAPI/hko_data/F3/Gridded_rainfall_nowcast.csv, ~2.7 MB, no CORS header).
// The server pulls it, keeps only the Hong Kong cells, and reduces it to the nearest grid point of each HKO
// rainfall station the twin already uses, so the browser gets a few KB: per station the four 30-min totals and
// their 2-h sum. Shared by the Express server (`/api/live/nowcast`) and the Vite dev middleware.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIONS_FILE = path.join(__dirname, "..", "src", "live", "baked", "hkoStations.json");
const HKO_NOWCAST = "https://data.weather.gov.hk/weatherAPI/hko_data/F3/Gridded_rainfall_nowcast.csv";
const TTL_MS = 6 * 60_000; // HKO refreshes every 12 min
const BBOX = { w: 113.75, s: 22.1, e: 114.55, n: 22.65 };

const stations = JSON.parse(fs.readFileSync(STATIONS_FILE, "utf8"));

let cache = { at: 0, payload: null };
let inflight = null;

function parseHkt(s) {
  // "202609082000" (HKT) → ISO with +08:00
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:00+08:00`;
}

async function refresh() {
  const res = await fetch(HKO_NOWCAST, { headers: { "User-Agent": "hk-hazard-twin/1.0" } });
  if (!res.ok) throw new Error(`HKO nowcast ${res.status}`);
  const text = await res.text();
  const lines = text.split(/\r?\n/);
  // cell → { lat, lon, steps: Map<endingTime, mm> }
  const cells = new Map();
  let updated = null;
  const endings = new Set();
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    if (!row) continue;
    const [upd, end, latS, lonS, mmS] = row.split(",");
    const lat = +latS, lon = +lonS, mm = +mmS;
    if (!(lon >= BBOX.w && lon <= BBOX.e && lat >= BBOX.s && lat <= BBOX.n) || !Number.isFinite(mm)) continue;
    updated ??= upd;
    endings.add(end);
    const key = `${latS},${lonS}`;
    let c = cells.get(key);
    if (!c) { c = { lat, lon, steps: {} }; cells.set(key, c); }
    c.steps[end] = mm;
  }
  if (!updated || cells.size === 0) throw new Error("HKO nowcast: no Hong Kong cells parsed");
  const steps = [...endings].sort();
  const cellList = [...cells.values()];
  const kx = Math.cos((22.35 * Math.PI) / 180);
  const out = stations.map((st) => {
    let best = null, bestD = Infinity;
    for (const c of cellList) {
      const d = ((c.lon - st.lon) * kx) ** 2 + (c.lat - st.lat) ** 2;
      if (d < bestD) { bestD = d; best = c; }
    }
    const mm30 = steps.map((e) => Math.round((best?.steps[e] ?? 0) * 10) / 10);
    return { id: st.id, name: st.name, mm30, mm2h: Math.round(mm30.reduce((a, b) => a + b, 0) * 10) / 10 };
  });
  const all2h = cellList.map((c) => steps.reduce((a, e) => a + (c.steps[e] ?? 0), 0));
  return {
    updated: parseHkt(updated),
    steps: steps.map(parseHkt),
    fetchedAt: new Date().toISOString(),
    cells: cellList.length,
    territory: { max2h: Math.round(Math.max(0, ...all2h) * 10) / 10, mean2h: Math.round((all2h.reduce((a, b) => a + b, 0) / Math.max(1, all2h.length)) * 10) / 10 },
    stations: out,
  };
}

export async function getNowcast() {
  if (cache.payload && Date.now() - cache.at < TTL_MS) return cache.payload;
  if (!inflight) {
    inflight = refresh()
      .then((p) => { cache = { at: Date.now(), payload: p }; return p; })
      .finally(() => { inflight = null; });
  }
  try {
    return await inflight;
  } catch (err) {
    if (cache.payload) return cache.payload; // stale beats nothing
    throw err;
  }
}

export async function liveNowcastHandler(_req, res) {
  try {
    const payload = await getNowcast();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(payload));
  } catch (err) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: String(err?.message ?? err) }));
  }
}

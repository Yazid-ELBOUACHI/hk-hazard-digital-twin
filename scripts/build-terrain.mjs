// Bakes a compact slope/aspect/elevation grid for every hill-massif footprint from public
// AWS/Mapzen terrarium DEM tiles, so the synthetic generator can put slope features on real
// hillsides, oriented along real contours. Output: src/mock/terrainGrid.ts (base64 uint8 grids).
//
//   node scripts/build-terrain.mjs
//
// Real geography in, synthetic slopes out — no hazard data is derived from this.

import { PNG } from "pngjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEO_TS = path.join(__dirname, "..", "src", "mock", "geo.ts");
const OUT_TS = path.join(__dirname, "..", "src", "mock", "terrainGrid.ts");

const Z = 13; // ≈ 17.7 m/px at Hong Kong latitude
const DOWNSAMPLE = 3; // → ≈ 53 m cells
const TILE_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

// ---- read footprints straight out of geo.ts (single source of truth) ----
const geoSrc = fs.readFileSync(GEO_TS, "utf8");
const clusters = [];
const re = /name: "([^"]+)"[\s\S]*?footprint: \[([\s\S]*?)\]\s*,\s*\n\s*\}/g;
let m;
while ((m = re.exec(geoSrc))) {
  const ring = [...m[2].matchAll(/\[([\d.]+),\s*([\d.]+)\]/g)].map((x) => [+x[1], +x[2]]);
  clusters.push({ name: m[1], ring });
}
if (!clusters.length) throw new Error("no footprints parsed from geo.ts");

// ---- web-mercator helpers ----
const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
const x2lon = (x, z) => (x / 2 ** z) * 360 - 180;
const y2lat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

const tileCache = new Map();
async function tile(x, y) {
  const k = `${x}/${y}`;
  if (tileCache.has(k)) return tileCache.get(k);
  const res = await fetch(TILE_URL(Z, x, y));
  if (!res.ok) throw new Error(`tile ${k}: HTTP ${res.status}`);
  const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
  const elev = new Float32Array(256 * 256);
  for (let i = 0; i < 256 * 256; i++) {
    const r = png.data[i * 4], g = png.data[i * 4 + 1], b = png.data[i * 4 + 2];
    elev[i] = r * 256 + g + b / 256 - 32768; // terrarium encoding
  }
  tileCache.set(k, elev);
  return elev;
}

const out = [];
for (const c of clusters) {
  const lons = c.ring.map((p) => p[0]), lats = c.ring.map((p) => p[1]);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);

  // pixel bbox (global pixel coords at zoom Z)
  const px0 = Math.floor(lon2x(minLon, Z) * 256), px1 = Math.ceil(lon2x(maxLon, Z) * 256);
  const py0 = Math.floor(lat2y(maxLat, Z) * 256), py1 = Math.ceil(lat2y(minLat, Z) * 256);
  const W = px1 - px0 + 2, H = py1 - py0 + 2; // +1 px margin for gradients
  const elev = new Float32Array(W * H);

  for (let ty = Math.floor((py0 - 1) / 256); ty <= Math.floor((py1 + 1) / 256); ty++) {
    for (let tx = Math.floor((px0 - 1) / 256); tx <= Math.floor((px1 + 1) / 256); tx++) {
      const t = await tile(tx, ty);
      for (let yy = 0; yy < 256; yy++) {
        const gy = ty * 256 + yy - (py0 - 1);
        if (gy < 0 || gy >= H) continue;
        for (let xx = 0; xx < 256; xx++) {
          const gx = tx * 256 + xx - (px0 - 1);
          if (gx < 0 || gx >= W) continue;
          elev[gy * W + gx] = t[yy * 256 + xx];
        }
      }
    }
  }

  // metres per pixel at this latitude
  const midLat = (minLat + maxLat) / 2;
  const mpp = (40075016.686 / (256 * 2 ** Z)) * Math.cos((midLat * Math.PI) / 180);

  const cols = Math.floor((W - 2) / DOWNSAMPLE), rows = Math.floor((H - 2) / DOWNSAMPLE);
  const slope = new Uint8Array(cols * rows); // degrees 0..90
  const aspect = new Uint8Array(cols * rows); // downhill direction, 0..255 ≙ 0..360° from north
  const height = new Uint8Array(cols * rows); // elevation / 4 m (0..1020 m)
  const inside = new Uint8Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      const gx = 1 + q * DOWNSAMPLE + Math.floor(DOWNSAMPLE / 2);
      const gy = 1 + r * DOWNSAMPLE + Math.floor(DOWNSAMPLE / 2);
      const e = (x, y) => elev[y * W + x];
      const dzdx = (e(gx + 1, gy) - e(gx - 1, gy)) / (2 * mpp);
      const dzdy = (e(gx, gy - 1) - e(gx, gy + 1)) / (2 * mpp); // north positive
      const s = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
      // downhill = -gradient; bearing from north, clockwise
      let a = (Math.atan2(-dzdx, -dzdy) * 180) / Math.PI;
      if (a < 0) a += 360;
      const i = r * cols + q;
      slope[i] = Math.max(0, Math.min(90, Math.round(s)));
      aspect[i] = Math.round((a / 360) * 255);
      height[i] = Math.max(0, Math.min(255, Math.round(e(gx, gy) / 4)));
      const lon = x2lon((px0 - 1 + gx + 0.5) / 256, Z), lat = y2lat((py0 - 1 + gy + 0.5) / 256, Z);
      inside[i] = pointInRing([lon, lat], c.ring) ? 1 : 0;
    }
  }

  const steep = inside.reduce((n, v, i) => n + (v && slope[i] >= 15 ? 1 : 0), 0);
  const total = inside.reduce((n, v) => n + v, 0);
  console.log(`${c.name.padEnd(28)} ${cols}×${rows} cells · ${total} on land · ${steep} steep (≥15°) · ${((steep / total) * 100).toFixed(0)}%`);

  out.push({
    name: c.name,
    cols, rows,
    // cell → lon/lat: lon = x2lon((px0 - 1 + 1 + q*D + D/2 + 0.5)/256); we store the pixel origin instead
    px0: px0 - 1, py0: py0 - 1, z: Z, ds: DOWNSAMPLE,
    slope: Buffer.from(slope).toString("base64"),
    aspect: Buffer.from(aspect).toString("base64"),
    height: Buffer.from(height).toString("base64"),
  });
}

const ts = `// GENERATED by scripts/build-terrain.mjs — do not edit.
// Per-massif terrain grids (≈53 m cells) from AWS/Mapzen terrarium DEM tiles: slope angle (°),
// downhill aspect (0..255 ≙ 0..360° from north), elevation (÷4 m). Land mask is recomputed at runtime from the footprint ring.
// Real relief; used only to place synthetic slope features plausibly.

export interface TerrainGrid {
  name: string;
  cols: number;
  rows: number;
  px0: number; // global pixel origin at zoom z (web mercator)
  py0: number;
  z: number;
  ds: number; // downsample factor (source px per cell)
  slope: string; // base64 uint8[cols*rows]
  aspect: string;
  height: string;
}

export const TERRAIN_GRIDS: TerrainGrid[] = ${JSON.stringify(out)};
`;
fs.writeFileSync(OUT_TS, ts);
console.log(`\nwrote ${OUT_TS} (${(fs.statSync(OUT_TS).size / 1024).toFixed(0)} KB), ${tileCache.size} tiles fetched`);

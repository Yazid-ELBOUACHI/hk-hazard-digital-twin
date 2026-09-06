// Deterministic seeded RNG so every demo run is reproducible.

export const GLOBAL_SEED = 20260904;

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable numeric hash of a string (for per-entity sub-seeds). */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rngFor(...keys: (string | number)[]) {
  const seed = keys.reduce<number>((acc, k) => (acc ^ hashStr(String(k))) >>> 0, GLOBAL_SEED);
  return mulberry32(seed);
}

// Hot-path caches: the risk pass evaluates ~40k noise samples per refresh, so key strings are hashed
// once and small integer hashes are tabulated. Outputs are identical to the string-keyed form.
const keySeeds = new Map<string, number>();
export function keySeed(key: string): number {
  let h = keySeeds.get(key);
  if (h === undefined) {
    h = hashStr(key);
    keySeeds.set(key, h);
  }
  return h;
}
const INT_HASH: number[] = [];
function intHash(i: number): number {
  if (i >= 0 && i < 8192) {
    let h = INT_HASH[i];
    if (h === undefined) {
      h = hashStr(String(i));
      INT_HASH[i] = h;
    }
    return h;
  }
  return hashStr(String(i));
}

/** smoothNoise on a precomputed key seed (see keySeed) — same values, no string work. */
export function smoothNoiseSeed(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = mulberry32((GLOBAL_SEED ^ seed ^ intHash(i)) >>> 0)();
  const b = mulberry32((GLOBAL_SEED ^ seed ^ intHash(i + 1)) >>> 0)();
  const u = f * f * (3 - 2 * f); // smoothstep
  return a * (1 - u) + b * u;
}

/** Deterministic smooth-ish noise in [0,1] as a function of continuous x, per key. */
export function smoothNoise(key: string, x: number): number {
  return smoothNoiseSeed(keySeed(key), x);
}

export function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function rangeInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function range(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

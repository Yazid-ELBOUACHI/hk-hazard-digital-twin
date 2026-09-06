// Cooperative scheduling for long computations: yield to the browser between chunks so input and
// rendering stay responsive (the map keeps zooming while the risk pass runs).

export function yieldToMain(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (s?.yield) return s.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

let mapInteracting = false;
export function setMapInteracting(moving: boolean): void {
  mapInteracting = moving;
}

/** Let camera input/rendering finish before resuming background calculations. */
export async function yieldForMap(): Promise<void> {
  await yieldToMain();
  while (mapInteracting) await new Promise((resolve) => setTimeout(resolve, 50));
}

/** Time a phase and log it when it is long enough to matter (dev diagnostics for the refresh loop). */
export async function timed<T>(label: string, fn: () => T | Promise<T>, warnAboveMs = 80): Promise<T> {
  const t0 = performance.now();
  const out = await fn();
  const ms = performance.now() - t0;
  try {
    performance.measure(`twin:${label}`, { start: t0, end: performance.now() });
  } catch {
    /* older browsers */
  }
  if (ms >= warnAboveMs) console.info(`[perf] ${label}: ${ms.toFixed(0)} ms`);
  return out;
}

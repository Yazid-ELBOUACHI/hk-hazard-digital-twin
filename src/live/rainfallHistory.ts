// Accessors over the baked GEO raingauge record (REAL: CEDD/GEO via CSDI, 1984 → present).
// The ~300 KB chunk is imported lazily on first use — the History tab and the Reports page pay for
// it, the boot path does not.

import { u8, u16 } from "@/live/baked/decode";
import type { RainGauge, StormDay } from "@/live/baked/rainfall";
import { reportSource } from "@/core/dataSources";

export interface RainfallHistory {
  epochYear: number;
  years: number;
  days: number;
  lastDate: string; // YYYY-MM-DD
  gauges: RainGauge[];
  gaugeIndex(id: string): number; // -1 when unknown
  annualMaxMm(g: number): number[]; // wettest day of each year at gauge g (0 = no record)
  annualTotalMm(g: number): number[];
  monthlyMm(g: number): number[]; // per month since epoch
  dayMaxMm: Float32Array; // territory maximum daily total
  dayMeanMm: Float32Array; // mean over reporting gauges
  dayGauges: Uint8Array; // gauges reporting that day
  dayIncidents: Uint16Array; // CEDD landslide incidents reported that day
  dateOfDay(d: number): string; // YYYY-MM-DD
  yearOfDay(d: number): number;
  dayOfDate(iso: string): number; // -1 when outside the record
  storms: StormDay[]; // top days by territory maximum
}

let cache: Promise<RainfallHistory> | null = null;

export function loadRainfallHistory(): Promise<RainfallHistory> {
  cache ??= import("@/live/baked/rainfall")
    .then(({ RAINFALL: R }) => {
      const epochMs = Date.UTC(R.epochYear, 0, 1);
      const aMax = u16(R.annualMaxX10);
      const aTot = u16(R.annualTotalMm);
      const mon = u16(R.monthlyX10);
      const dMax = u16(R.dayMaxX10);
      const dMean = u16(R.dayMeanX10);
      const idx = new Map(R.gauges.map((g, i) => [g.id, i]));
      const nY = R.years;
      const lastDate = `${R.lastDate.slice(0, 4)}-${R.lastDate.slice(4, 6)}-${R.lastDate.slice(6, 8)}`;
      const h: RainfallHistory = {
        epochYear: R.epochYear,
        years: nY,
        days: R.days,
        lastDate,
        gauges: R.gauges,
        gaugeIndex: (id) => idx.get(id) ?? -1,
        annualMaxMm: (g) => Array.from(aMax.subarray(g * nY, (g + 1) * nY), (v) => v / 10),
        annualTotalMm: (g) => Array.from(aTot.subarray(g * nY, (g + 1) * nY)),
        monthlyMm: (g) => Array.from(mon.subarray(g * nY * 12, (g + 1) * nY * 12), (v) => v / 10),
        dayMaxMm: Float32Array.from(dMax, (v) => v / 10),
        dayMeanMm: Float32Array.from(dMean, (v) => v / 10),
        dayGauges: u8(R.dayGauges),
        dayIncidents: u16(R.dayIncidents),
        dateOfDay: (d) => new Date(epochMs + d * 86400_000).toISOString().slice(0, 10),
        yearOfDay: (d) => new Date(epochMs + d * 86400_000).getUTCFullYear(),
        dayOfDate: (iso) => {
          const d = Math.floor((Date.parse(iso.slice(0, 10)) - epochMs) / 86400_000);
          return d >= 0 && d < R.days ? d : -1;
        },
        storms: R.storms,
      };
      reportSource("geo-raingauge", { ok: true, count: R.gauges.length, note: `record 1984-01-01 → ${lastDate}` });
      return h;
    })
    .catch((err) => {
      cache = null;
      reportSource("geo-raingauge", { ok: false, note: String((err as Error)?.message ?? err) });
      throw err;
    });
  return cache;
}

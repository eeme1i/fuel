import type { FxRow, MarketRow } from "../repository";
import { normalizeToEurPerLitre } from "./normalize";
import type { MarketObservation } from "./types";

const DAY = 86_400_000;

/**
 * Retail prices follow wholesale prices with a delay. The benchmark used for a pump-price
 * date t is the mean of trading-day observations in [t - lag - window + 1, t - lag].
 * Chosen by out-of-sample evaluation against Statistics Finland monthly averages 2016-2026.
 */
export const BENCHMARK_LAG_DAYS = 5;
export const BENCHMARK_WINDOW_DAYS = 21;
export const MIN_WINDOW_OBSERVATIONS = 5;
/** Share of calendar days in a month that must have a benchmark value. */
const MIN_MONTH_COVERAGE = 0.8;

export const toTime = (date: string) =>
  Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
export const toDate = (time: number) =>
  new Date(time).toISOString().slice(0, 10);
export const addDays = (date: string, days: number) =>
  toDate(toTime(date) + days * DAY);

export interface BenchmarkPoint {
  date: string;
  eurL: number;
}

function asObservation(row: MarketRow): MarketObservation {
  const unit =
    row.currency === "EUR" && row.unit === "litre"
      ? "eur_litre"
      : row.unit === "us_gallon"
        ? "usd_gallon"
        : row.unit === "barrel"
          ? "usd_barrel"
          : "usd_metric_tonne";
  return {
    fuel: row.fuel,
    date: row.observed_at.slice(0, 10),
    price: row.price,
    unit,
    densityKgPerLitre: row.density_kg_l ?? undefined,
    benchmark: row.benchmark,
    source: row.source,
  };
}

/**
 * Picks one benchmark series so the anchor and current windows are always comparable.
 * Preferred-quality series win over proxies; otherwise the series with the latest data.
 */
export function selectBenchmark(rows: MarketRow[]): string | undefined {
  const latest = new Map<string, { date: string; preferred: boolean }>();
  for (const row of rows) {
    const seen = latest.get(row.benchmark);
    if (!seen || row.observed_at > seen.date)
      latest.set(row.benchmark, {
        date: row.observed_at,
        preferred: row.benchmark_quality === "preferred",
      });
  }
  return [...latest.entries()].sort(
    ([, a], [, b]) =>
      Number(b.preferred) - Number(a.preferred) || b.date.localeCompare(a.date),
  )[0]?.[0];
}

/** Returns the rate function for "latest ECB rate on or before date" over ascending rows. */
export function fxLookup(fx: FxRow[]) {
  const dates = fx.map((row) => row.observed_on);
  return (date: string): number | undefined => {
    let lo = 0,
      hi = dates.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (dates[mid] <= date) lo = mid + 1;
      else hi = mid;
    }
    return lo ? fx[lo - 1].rate : undefined;
  };
}

/**
 * Converts one benchmark's rows to EUR/L. `fixedRate`, when given, replaces the daily
 * FX rate; it is used to separate product-price movement from currency movement.
 */
export function toBenchmarkPoints(
  rows: MarketRow[],
  fx: FxRow[],
  fixedRate?: number,
): BenchmarkPoint[] {
  const rateOn = fxLookup(fx);
  const points: BenchmarkPoint[] = [];
  for (const row of rows) {
    const date = row.observed_at.slice(0, 10);
    const rate =
      row.currency === "USD" ? (fixedRate ?? rateOn(date)) : undefined;
    if (row.currency === "USD" && !rate) continue;
    points.push({
      date,
      eurL: normalizeToEurPerLitre(asObservation(row), rate),
    });
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

/** Lagged, smoothed benchmark with O(log n) window queries. */
export class BenchmarkSeries {
  private readonly times: number[];
  private readonly prefix: number[];

  constructor(
    readonly points: BenchmarkPoint[],
    readonly lagDays = BENCHMARK_LAG_DAYS,
    readonly windowDays = BENCHMARK_WINDOW_DAYS,
  ) {
    this.times = points.map((point) => toTime(point.date));
    this.prefix = [0];
    for (const point of points)
      this.prefix.push(this.prefix.at(-1)! + point.eurL);
  }

  private lowerBound(time: number) {
    let lo = 0,
      hi = this.times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.times[mid] < time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Observations inside the window that feeds the pump price on `date`. */
  window(date: string) {
    const end = toTime(date) - this.lagDays * DAY;
    const start = end - (this.windowDays - 1) * DAY;
    const from = this.lowerBound(start),
      to = this.lowerBound(end + DAY);
    return {
      start: toDate(start),
      end: toDate(end),
      count: to - from,
      mean:
        to > from
          ? (this.prefix[to] - this.prefix[from]) / (to - from)
          : Number.NaN,
      latestDate: to > from ? this.points[to - 1].date : undefined,
    };
  }

  /** Lagged smoothed benchmark for a pump-price date, or NaN when the window is too thin. */
  at(date: string) {
    const window = this.window(date);
    return window.count >= MIN_WINDOW_OBSERVATIONS ? window.mean : Number.NaN;
  }

  /** Mean of `at(d)` over the calendar days of a period, matching a monthly average price. */
  periodMean(start: string, end: string) {
    let sum = 0,
      count = 0,
      days = 0;
    for (let time = toTime(start); time <= toTime(end); time += DAY) {
      days++;
      const value = this.at(toDate(time));
      if (Number.isFinite(value)) {
        sum += value;
        count++;
      }
    }
    return days && count / days >= MIN_MONTH_COVERAGE
      ? sum / count
      : Number.NaN;
  }
}

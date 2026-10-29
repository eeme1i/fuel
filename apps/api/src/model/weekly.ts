import type { OfficialRow, TaxRow, WeeklyRow } from "../repository";
import { addDays, type BenchmarkSeries } from "./benchmark";
import { taxFromRow } from "./calibration";
import type { FuelType, WeeklyInput } from "./types";

/** The bulletin reports prices in force on Monday and is published on Thursday. */
export const WEEKLY_PUBLICATION_LAG_DAYS = 3;
/**
 * Weeks averaged into the current weekly price. Single Monday readings swing by up to 20c and
 * back since 2025; two weeks halve that noise for about half a week of extra delay. Chosen on
 * daily reconstructions 2017-2026 against the official monthly averages.
 */
export const WEEKLY_WINDOW = 2;
/**
 * Official months averaged into the official-minus-weekly gap. The gap jumps by several cents
 * from month to month since 2024, the same way for both fuels, so a single month's gap mostly
 * adds noise; six months cut the error of daily reconstructions since 2024 by about a tenth.
 */
export const GAP_MONTHS = 6;

/**
 * Weekly national pump prices. Their level differs from the official monthly average (survey
 * and product mix differ), so the model uses only their change since the anchor month.
 */
export class WeeklySeries {
  constructor(readonly rows: WeeklyRow[]) {}

  /** The latest `count` weeks whose bulletins had been published by `date`, oldest first. */
  recent(date: string, count = WEEKLY_WINDOW) {
    const cutoff = addDays(date, -WEEKLY_PUBLICATION_LAG_DAYS);
    let end = this.rows.length;
    while (end > 0 && this.rows[end - 1].observed_on > cutoff) end--;
    return this.rows.slice(Math.max(0, end - count), end);
  }

  /** Period means by "start/end"; the baseline asks for the same months for every daily point. */
  private readonly means = new Map<string, number>();

  /** Mean of the weeks observed inside a period, or NaN when none were. */
  periodMean(start: string, end: string) {
    const key = `${start}/${end}`;
    const cached = this.means.get(key);
    if (cached !== undefined) return cached;
    let sum = 0,
      count = 0;
    for (const row of this.rows)
      if (row.observed_on >= start && row.observed_on <= end) {
        sum += row.price_eur_l;
        count++;
      }
    const mean = count ? sum / count : Number.NaN;
    this.means.set(key, mean);
    return mean;
  }

  /**
   * The weekly price that corresponds to the anchor, the last of `months`: the anchor minus
   * the mean official-minus-weekly gap over the latest GAP_MONTHS months. NaN without overlap.
   */
  baseline(months: OfficialRow[]) {
    const gaps = months
      .slice(-GAP_MONTHS)
      .map(
        (month) =>
          month.price_eur_l -
          this.periodMean(month.period_start, month.period_end),
      )
      .filter(Number.isFinite);
    const anchor = months.at(-1);
    return anchor && gaps.length
      ? anchor.price_eur_l - gaps.reduce((a, b) => a + b, 0) / gaps.length
      : Number.NaN;
  }
}

/**
 * The weekly input for an estimate on `date`: the mean of the latest published weeks, if the
 * newest is no older than the anchor month (the last of `months`, the official months published
 * by then). Market movement is counted from the newest week.
 */
export function weeklyInput(
  fuel: FuelType,
  weekly: WeeklySeries,
  series: BenchmarkSeries,
  taxAt: (date: string) => TaxRow | undefined,
  months: OfficialRow[],
  date: string,
): WeeklyInput | undefined {
  const anchor = months.at(-1);
  const weeks = weekly.recent(date);
  const latest = weeks.at(-1);
  if (!anchor || !latest || latest.observed_on < anchor.period_start)
    return undefined;
  const baselineEurL = weekly.baseline(months);
  const benchmarkEurL = series.at(latest.observed_on);
  const tax = taxAt(latest.observed_on);
  if (!Number.isFinite(baselineEurL) || !Number.isFinite(benchmarkEurL) || !tax)
    return undefined;
  return {
    date: latest.observed_on,
    priceEurL:
      weeks.reduce((sum, week) => sum + week.price_eur_l, 0) / weeks.length,
    baselineEurL,
    benchmarkEurL,
    tax: taxFromRow(fuel, tax),
  };
}

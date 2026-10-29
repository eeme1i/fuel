import type { OfficialRow, TaxRow } from "../repository";
import { addDays, type BenchmarkSeries, toTime } from "./benchmark";
import { anchorTaxAdjustment } from "./estimate";
import type { FuelType, TaxObservation } from "./types";
import type { WeeklySeries } from "./weekly";

const DAY = 86_400_000;
export const DEFAULT_BETA = 1;
const BETA_BOUNDS = [0, 1.5] as const;
/** Pairs needed before β is fitted instead of using DEFAULT_BETA. */
const MIN_FIT_SAMPLES = 12;
/** Training pairs required before a pair counts as an out-of-sample test. */
const MIN_TRAIN_SAMPLES = 24;
/** Error bound used before enough out-of-sample errors exist. */
const FALLBACK_ERROR_BOUND = 0.1;
/**
 * Finnish general VAT was 24% from 2013 until 2024-08-31. Used only for calibration months
 * that predate the stored tax records.
 */
const VAT_BEFORE_TAX_RECORDS = 0.24;
/** Months in which Finnish fuel excise or the biofuel obligation has typically changed. */
const TAX_CHANGE_MONTHS = new Set(["01", "07", "08"]);

export function taxFromRow(fuel: FuelType, row: TaxRow): TaxObservation {
  return {
    fuel,
    effectiveFrom: row.effective_from,
    vatRate: row.vat_rate,
    energyTaxEurL: row.energy_tax_eur_l,
    co2TaxEurL: row.co2_tax_eur_l,
    strategicStockFeeEurL: row.strategic_stock_fee_eur_l,
    otherTaxEurL: row.other_tax_eur_l,
  };
}

export function taxLookup(taxes: TaxRow[]) {
  return (date: string) =>
    taxes.filter((tax) => tax.effective_from <= date).at(-1);
}

/** Midpoint of an official averaging period; the date a monthly average best represents. */
export function periodMidpoint(row: OfficialRow) {
  return new Date((toTime(row.period_start) + toTime(row.period_end)) / 2)
    .toISOString()
    .slice(0, 10);
}

/** Months between an anchor's midpoint and a date, at least one. */
export function horizonMonths(anchor: OfficialRow, date: string) {
  return Math.max(
    1,
    (toTime(date) - toTime(periodMidpoint(anchor))) / (30.44 * DAY),
  );
}

export interface CalibrationPair {
  anchor: OfficialRow;
  target: OfficialRow;
  anchorBenchmark: number;
  targetBenchmark: number;
  vatRate: number;
  taxAdjustment: number;
  /** VAT-inclusive benchmark movement. */
  x: number;
  /** Official price movement not explained by tax changes. */
  y: number;
  /**
   * Target month's mean weekly price minus the weekly baseline of the anchor (taxes included);
   * NaN without weekly data.
   */
  weeklyChange: number;
}

export interface OutOfSamplePrediction {
  pair: CalibrationPair;
  beta: number;
  /** True when the prediction used the weekly change. */
  weekly: boolean;
  predicted: number;
  error: number;
  naiveError: number;
}

export interface BacktestMetrics {
  samples: number;
  from: string | null;
  to: string | null;
  mae: number;
  rmse: number;
  bias: number;
  maxAbsoluteError: number;
  errorBound80: number;
  correlation: number | null;
  directionAccuracy: number;
  naiveMae: number;
  naiveRmse: number;
  /** 1 - MAE / naive MAE; positive when the model beats "no change since last month". */
  skill: number;
  /** Months predicted from the weekly change rather than the benchmark. */
  weeklySamples: number;
}

export function fitBeta(pairs: CalibrationPair[]) {
  if (pairs.length < MIN_FIT_SAMPLES) return DEFAULT_BETA;
  let xy = 0,
    xx = 0;
  for (const pair of pairs) {
    xy += pair.x * pair.y;
    xx += pair.x * pair.x;
  }
  if (!xx) return DEFAULT_BETA;
  return Math.min(BETA_BOUNDS[1], Math.max(BETA_BOUNDS[0], xy / xx));
}

const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

function quantile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

function metrics(predictions: OutOfSamplePrediction[]): BacktestMetrics | null {
  if (!predictions.length) return null;
  const errors = predictions.map((p) => p.error);
  const naive = predictions.map((p) => p.naiveError);
  const actual = predictions.map(
    (p) => p.pair.target.price_eur_l - p.pair.anchor.price_eur_l,
  );
  const predicted = predictions.map(
    (p) => p.predicted - p.pair.anchor.price_eur_l,
  );
  const ma = mean(actual),
    mp = mean(predicted);
  const covariance = mean(actual.map((v, i) => (v - ma) * (predicted[i] - mp)));
  const denominator = Math.sqrt(
    mean(actual.map((v) => (v - ma) ** 2)) *
      mean(predicted.map((v) => (v - mp) ** 2)),
  );
  const mae = mean(errors.map(Math.abs));
  const naiveMae = mean(naive.map(Math.abs));
  return {
    samples: predictions.length,
    from: predictions[0].pair.target.observation_date,
    to: predictions.at(-1)!.pair.target.observation_date,
    mae,
    rmse: Math.sqrt(mean(errors.map((e) => e * e))),
    bias: mean(errors),
    maxAbsoluteError: Math.max(...errors.map(Math.abs)),
    errorBound80: quantile(errors.map(Math.abs), 0.8),
    correlation: denominator ? covariance / denominator : null,
    directionAccuracy: mean(
      actual.map((v, i) => (Math.sign(v) === Math.sign(predicted[i]) ? 1 : 0)),
    ),
    naiveMae,
    naiveRmse: Math.sqrt(mean(naive.map((e) => e * e))),
    skill: naiveMae ? 1 - mae / naiveMae : 0,
    weeklySamples: predictions.filter((p) => p.weekly).length,
  };
}

/**
 * Builds consecutive official-month pairs (anchor month → next month) and fits the
 * pass-through coefficient β by least squares through the origin:
 *   P_next − P_anchor − tax change = β (1 + VAT) (B̄_next − B̄_anchor)
 * Out-of-sample errors use an expanding window, so each month is predicted only from
 * months that were complete before it. Where weekly prices cover both months, the prediction
 * is the anchor plus the weekly change instead (weekly prices already include taxes).
 */
export function calibrate(
  fuel: FuelType,
  official: OfficialRow[],
  series: BenchmarkSeries,
  taxes: TaxRow[],
  weekly?: WeeklySeries,
) {
  const taxAt = taxLookup(taxes);
  const benchmarks = official.map((row) =>
    series.periodMean(row.period_start, row.period_end),
  );
  const pairs: CalibrationPair[] = [];
  for (let index = 1; index < official.length; index++) {
    const anchor = official[index - 1],
      target = official[index];
    const anchorBenchmark = benchmarks[index - 1],
      targetBenchmark = benchmarks[index];
    if (!Number.isFinite(anchorBenchmark) || !Number.isFinite(targetBenchmark))
      continue;
    if (addDays(anchor.period_end, 1) !== target.period_start) continue;
    const anchorTax = taxAt(anchor.period_end),
      targetTax = taxAt(target.period_end);
    let vatRate: number, taxAdjustment: number;
    if (anchorTax && targetTax) {
      vatRate = targetTax.vat_rate;
      taxAdjustment = anchorTaxAdjustment(
        anchor.price_eur_l,
        taxFromRow(fuel, anchorTax),
        taxFromRow(fuel, targetTax),
      );
    } else if (
      !anchorTax &&
      !targetTax &&
      !TAX_CHANGE_MONTHS.has(target.period_start.slice(5, 7))
    ) {
      // No tax records yet; outside the usual change months taxes are assumed unchanged.
      vatRate = VAT_BEFORE_TAX_RECORDS;
      taxAdjustment = 0;
    } else continue;
    const x = (1 + vatRate) * (targetBenchmark - anchorBenchmark);
    pairs.push({
      anchor,
      target,
      anchorBenchmark,
      targetBenchmark,
      vatRate,
      taxAdjustment,
      x,
      y: target.price_eur_l - anchor.price_eur_l - taxAdjustment,
      weeklyChange: weekly
        ? weekly.periodMean(target.period_start, target.period_end) -
          weekly.baseline(official.slice(0, index))
        : Number.NaN,
    });
  }

  const outOfSample: OutOfSamplePrediction[] = [];
  for (let index = MIN_TRAIN_SAMPLES; index < pairs.length; index++) {
    const pair = pairs[index];
    const beta = fitBeta(pairs.slice(0, index));
    const useWeekly = Number.isFinite(pair.weeklyChange);
    const predicted = useWeekly
      ? pair.anchor.price_eur_l + pair.weeklyChange
      : pair.anchor.price_eur_l + beta * pair.x + pair.taxAdjustment;
    outOfSample.push({
      pair,
      beta,
      weekly: useWeekly,
      predicted,
      error: predicted - pair.target.price_eur_l,
      naiveError: pair.anchor.price_eur_l - pair.target.price_eur_l,
    });
  }
  const backtest = metrics(outOfSample);

  return {
    beta: fitBeta(pairs),
    samples: pairs.length,
    pairs,
    outOfSample,
    backtest,
    /** 80% absolute-error bound for a one-month horizon. */
    errorBound80:
      backtest && backtest.samples >= 12
        ? backtest.errorBound80
        : FALLBACK_ERROR_BOUND,
    /** β using only months that had ended before `date`, for honest reconstruction. */
    betaAsOf: (date: string) =>
      fitBeta(pairs.filter((pair) => pair.target.period_end < date)),
  };
}

export type Calibration = ReturnType<typeof calibrate>;

/** 80% range half-width: one-month error bound, widened with the square root of the horizon. */
export function errorBound(
  calibration: Calibration,
  anchor: OfficialRow,
  date: string,
) {
  return calibration.errorBound80 * Math.sqrt(horizonMonths(anchor, date));
}

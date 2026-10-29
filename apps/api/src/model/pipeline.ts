import type { D1Database } from "../db";
import {
  addDays,
  BenchmarkSeries,
  fxLookup,
  toBenchmarkPoints,
} from "./benchmark";
import { errorBound, taxFromRow, taxLookup } from "./calibration";
import { estimateFuelPrice } from "./estimate";
import { loadModel, MODEL_VERSION } from "./load";
import type { FuelType } from "./types";
import { weeklyInput } from "./weekly";

export async function calculate(
  db: D1Database,
  fuel: FuelType,
  at = new Date(),
) {
  const today = at.toISOString().slice(0, 10);
  const model = await loadModel(db, fuel, today);
  if (!model)
    throw new Error("missing official anchor or benchmark observations");
  const { benchmark, rows, fx, official, taxes, series, calibration, weekly } =
    model;
  const anchor = official.at(-1)!;

  const anchorBenchmark = series.periodMean(
    anchor.period_start,
    anchor.period_end,
  );
  const window = series.window(today);
  const currentBenchmark = series.at(today);
  if (!Number.isFinite(anchorBenchmark) || !Number.isFinite(currentBenchmark))
    throw new Error("benchmark does not cover anchor and current periods");

  const taxAt = taxLookup(taxes);
  const anchorTaxRow = taxAt(anchor.period_end),
    currentTaxRow = taxAt(today);
  if (!anchorTaxRow || !currentTaxRow)
    throw new Error("missing applicable tax observation");

  const currentRows = rows.filter((row) => {
    const date = row.observed_at.slice(0, 10);
    return date >= window.start && date <= window.end;
  });
  const prices = currentRows.map((row) => row.price);
  const calculatedAt = at.toISOString();
  const result = estimateFuelPrice({
    fuel,
    calculatedAt,
    anchor: {
      id: anchor.id,
      fuel,
      date: anchor.observation_date,
      period: `${anchor.period_start}/${anchor.period_end}`,
      periodStart: anchor.period_start,
      periodEnd: anchor.period_end,
      priceEurL: anchor.price_eur_l,
      source: anchor.source,
    },
    anchorBenchmarkEurL: anchorBenchmark,
    currentBenchmarkEurL: currentBenchmark,
    anchorTax: taxFromRow(fuel, anchorTaxRow),
    currentTax: taxFromRow(fuel, currentTaxRow),
    marketObservationDate: rows.at(-1)!.observed_at.slice(0, 10),
    benchmark,
    benchmarkQuality: rows.at(-1)!.benchmark_quality,
    errorBoundEurL: errorBound(calibration, anchor, today),
    beta: calibration.beta,
    // The lagged window must still reach its last week; EIA publishes weekly.
    dataComplete:
      !!window.latestDate && window.latestDate >= addDays(window.end, -7),
    highVolatility:
      Math.max(...prices) - Math.min(...prices) >
      (prices.reduce((a, b) => a + b, 0) / prices.length) * 0.15,
    taxCertain: true,
    modelVersion: MODEL_VERSION,
    weekly: weeklyInput(fuel, weekly, series, taxAt, official, today),
  });

  // Attribute the benchmark movement: product price at the anchor period's average FX,
  // with the remainder due to currency.
  const rateOn = fxLookup(fx);
  const anchorWindowRates = rows
    .filter((row) => {
      const date = row.observed_at.slice(0, 10);
      return (
        row.currency === "USD" &&
        date >= series.window(anchor.period_start).start &&
        date <= series.window(anchor.period_end).end
      );
    })
    .map((row) => rateOn(row.observed_at.slice(0, 10)))
    .filter((rate): rate is number => !!rate);
  let productEffectEurL = result.marketEffectEurL;
  if (anchorWindowRates.length) {
    const anchorFx =
      anchorWindowRates.reduce((a, b) => a + b, 0) / anchorWindowRates.length;
    const fixedFx = new BenchmarkSeries(toBenchmarkPoints(rows, fx, anchorFx));
    productEffectEurL =
      (fixedFx.at(today) -
        (result.weekly ? fixedFx.at(result.weekly.date) : anchorBenchmark)) *
      (1 + result.inputs.vatRate) *
      result.inputs.beta;
  }
  const currencyEffectEurL = result.marketEffectEurL - productEffectEurL;

  const inputSnapshot = JSON.stringify({
    anchor,
    benchmark,
    currentWindow: window,
    currentRows,
    fxUsed: [
      ...new Set(currentRows.map((row) => row.observed_at.slice(0, 10))),
    ].map((date) => ({ date, rate: rateOn(date) })),
    anchorTax: anchorTaxRow,
    currentTax: currentTaxRow,
    calibration: {
      beta: calibration.beta,
      samples: calibration.samples,
      errorBound80: calibration.errorBound80,
      backtest: calibration.backtest,
    },
    weekly: result.weekly && {
      ...result.weekly,
      effectEurL: result.weeklyEffectEurL,
    },
    model: {
      ...result.inputs,
      lagDays: series.lagDays,
      windowDays: series.windowDays,
      range: result.range,
    },
  });
  await db
    .prepare(
      `INSERT INTO estimate_snapshots (fuel,calculated_at,model_version,estimated_price_eur_l,change_eur_l,market_effect_eur_l,product_effect_eur_l,currency_effect_eur_l,tax_effect_eur_l,confidence,anchor_age_days,market_data_age_days,benchmark,benchmark_quality,anchor_id,input_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      fuel,
      calculatedAt,
      MODEL_VERSION,
      result.priceEurL,
      result.changeSinceAnchorEurL,
      result.marketEffectEurL,
      productEffectEurL,
      currencyEffectEurL,
      result.taxAdjustmentEurL,
      result.confidence,
      result.anchorAgeDays,
      result.marketDataAgeDays,
      result.benchmark,
      rows.at(-1)!.benchmark_quality,
      anchor.id,
      inputSnapshot,
    )
    .run();
  return { ...result, productEffectEurL, currencyEffectEurL };
}

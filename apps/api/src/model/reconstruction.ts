import type { D1Database } from "../db";
import type { OfficialRow } from "../repository";
import { addDays } from "./benchmark";
import { errorBound, taxFromRow, taxLookup } from "./calibration";
import { estimateFuelPrice } from "./estimate";
import { loadModel, MODEL_VERSION } from "./load";
import type { FuelType } from "./types";
import { weeklyInput } from "./weekly";

/**
 * Statistics Finland's monthly liquid-fuel prices (11xx) come out around month-end: the table
 * already held September 2026 when it was updated on 2026-09-28. Release dates aren't stored,
 * so reconstructed days use an anchor from five days after its month ends.
 */
const OFFICIAL_PUBLICATION_LAG_DAYS = 5;
const DAILY_HISTORY_DAYS = 400;

function anchorFields(fuel: FuelType, anchor: OfficialRow) {
  return {
    id: anchor.id,
    fuel,
    date: anchor.observation_date,
    period: `${anchor.period_start}/${anchor.period_end}`,
    periodStart: anchor.period_start,
    periodEnd: anchor.period_end,
    priceEurL: anchor.price_eur_l,
    source: anchor.source,
  };
}

/**
 * Retrospective evaluation, not forecasts published at the time. Monthly points are
 * out-of-sample: β is fitted only on months before the one being predicted. Daily points use
 * the anchor and weekly price that were published by that day, β from months already
 * complete, and no market or FX observation after that day. The 80% range uses the full-history error bound.
 */
export async function reconstructHistory(
  db: D1Database,
  fuel: FuelType,
  today = new Date().toISOString().slice(0, 10),
) {
  const model = await loadModel(db, fuel, today);
  if (!model || model.official.length < 2)
    return { monthly: [], daily: [], calibration: null, backtest: null };
  const { official, taxes, series, calibration, benchmark, rows, weekly } =
    model;

  const monthly = calibration.outOfSample.map(
    ({ pair, beta, weekly: usedWeekly, predicted, error, naiveError }) => ({
      date: pair.target.observation_date,
      official_price: pair.target.price_eur_l,
      estimated_price: predicted,
      error,
      naive_error: naiveError,
      confidence:
        calibration.errorBound80 <= 0.035
          ? "high"
          : calibration.errorBound80 <= 0.07
            ? "medium"
            : "low",
      estimate_timestamp: pair.target.period_end,
      anchor_price: pair.anchor.price_eur_l,
      anchor_date: pair.anchor.observation_date,
      anchor_benchmark: pair.anchorBenchmark,
      current_benchmark: pair.targetBenchmark,
      vat_rate: pair.vatRate,
      tax_adjustment: pair.taxAdjustment,
      beta,
      weekly_change: usedWeekly ? pair.weeklyChange : null,
      kind: "reconstructed",
    }),
  );

  const taxAt = taxLookup(taxes);
  const daily: Array<Record<string, unknown>> = [];
  const lastMarket = rows.at(-1)!.observed_at.slice(0, 10);
  const end = [today, addDays(lastMarket, series.lagDays)].sort()[0];
  let anchorIndex = -1;
  for (
    let date = addDays(end, -DAILY_HISTORY_DAYS);
    date <= end;
    date = addDays(date, 1)
  ) {
    while (
      anchorIndex + 1 < official.length &&
      addDays(
        official[anchorIndex + 1].period_end,
        OFFICIAL_PUBLICATION_LAG_DAYS,
      ) <= date
    )
      anchorIndex++;
    if (anchorIndex < 0) continue;
    const anchor = official[anchorIndex];
    const anchorBenchmark = series.periodMean(
      anchor.period_start,
      anchor.period_end,
    );
    const currentBenchmark = series.at(date);
    const anchorTax = taxAt(anchor.period_end),
      currentTax = taxAt(date);
    if (
      !Number.isFinite(anchorBenchmark) ||
      !Number.isFinite(currentBenchmark) ||
      !anchorTax ||
      !currentTax
    )
      continue;
    const result = estimateFuelPrice({
      fuel,
      calculatedAt: `${date}T23:59:59Z`,
      anchor: anchorFields(fuel, anchor),
      anchorBenchmarkEurL: anchorBenchmark,
      currentBenchmarkEurL: currentBenchmark,
      anchorTax: taxFromRow(fuel, anchorTax),
      currentTax: taxFromRow(fuel, currentTax),
      marketObservationDate: series.window(date).latestDate ?? date,
      benchmark,
      beta: calibration.betaAsOf(date),
      errorBoundEurL: errorBound(calibration, anchor, date),
      modelVersion: MODEL_VERSION,
      weekly: weeklyInput(
        fuel,
        weekly,
        series,
        taxAt,
        official.slice(0, anchorIndex + 1),
        date,
      ),
    });
    daily.push({
      date,
      price: result.priceEurL,
      low: result.range.low,
      high: result.range.high,
      confidence: result.confidence,
      anchor_date: anchor.observation_date,
      weekly_date: result.weekly?.date ?? null,
      kind: "reconstructed",
    });
  }

  return {
    monthly,
    daily,
    calibration,
    backtest: calibration.backtest && {
      ...calibration.backtest,
      beta: calibration.beta,
      calibrationSamples: calibration.samples,
      benchmark,
      lagDays: series.lagDays,
      windowDays: series.windowDays,
    },
  };
}

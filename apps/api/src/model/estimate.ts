import type { Confidence, EstimateInput, TaxObservation } from "./types";

const DAY_MS = 86_400_000;

function daysBetween(earlier: string, later: string): number {
  const difference = Date.parse(later) - Date.parse(`${earlier}T00:00:00Z`);
  if (!Number.isFinite(difference)) throw new Error("invalid ISO date");
  return Math.max(0, Math.floor(difference / DAY_MS));
}

export function totalPerLitreTax(tax: TaxObservation): number {
  return (
    (tax.energyTaxEurL ?? 0) +
    (tax.co2TaxEurL ?? 0) +
    (tax.strategicStockFeeEurL ?? 0) +
    (tax.otherTaxEurL ?? 0)
  );
}

/** Tax rates are stored pre-VAT; their change is grossed up at the current VAT rate. */
export function taxAdjustment(
  anchor: TaxObservation,
  current: TaxObservation,
): number {
  return (
    (totalPerLitreTax(current) - totalPerLitreTax(anchor)) *
    (1 + current.vatRate)
  );
}

/** Excise change plus the effect of a VAT-rate change on the anchor's pre-VAT price. */
export function anchorTaxAdjustment(
  anchorPriceEurL: number,
  anchor: TaxObservation,
  current: TaxObservation,
): number {
  return (
    taxAdjustment(anchor, current) +
    (anchorPriceEurL / (1 + anchor.vatRate)) *
      (current.vatRate - anchor.vatRate)
  );
}

/**
 * Confidence follows the measured out-of-sample error for the estimate's horizon, then
 * drops one level for each known data problem.
 */
export function confidenceFor(
  input: EstimateInput,
  anchorAgeDays: number,
): Confidence {
  let score =
    input.errorBoundEurL <= 0.035 ? 2 : input.errorBoundEurL <= 0.07 ? 1 : 0;
  if (anchorAgeDays > 62) score--;
  if (input.highVolatility) score--;
  if (input.taxCertain === false) score--;
  if (input.dataComplete === false) score--;
  return score >= 2 ? "high" : score === 1 ? "medium" : "low";
}

export function estimateFuelPrice(input: EstimateInput) {
  if (input.anchor.fuel !== input.fuel)
    throw new Error("anchor fuel does not match estimate fuel");
  if (
    input.anchorTax.fuel !== input.fuel ||
    input.currentTax.fuel !== input.fuel
  ) {
    throw new Error("tax fuel does not match estimate fuel");
  }
  const beta = input.beta ?? 1;
  if (!Number.isFinite(beta) || beta < 0)
    throw new Error("beta must be a non-negative number");

  // With a weekly price, the anchor moves by the weekly change since the anchor month, and only
  // the market and tax changes after that week are modelled.
  const weekly = input.weekly;
  const weeklyEffectEurL = weekly ? weekly.priceEurL - weekly.baselineEurL : 0;
  const marketEffectEurL =
    beta *
    (1 + input.currentTax.vatRate) *
    (input.currentBenchmarkEurL -
      (weekly?.benchmarkEurL ?? input.anchorBenchmarkEurL));
  const taxAdjustmentEurL = weekly
    ? anchorTaxAdjustment(
        input.anchor.priceEurL + weeklyEffectEurL,
        weekly.tax,
        input.currentTax,
      )
    : anchorTaxAdjustment(
        input.anchor.priceEurL,
        input.anchorTax,
        input.currentTax,
      );
  const changeSinceAnchorEurL =
    weeklyEffectEurL + marketEffectEurL + taxAdjustmentEurL;
  const anchorAgeDays = daysBetween(input.anchor.date, input.calculatedAt);
  const priceEurL = input.anchor.priceEurL + changeSinceAnchorEurL;

  return {
    fuel: input.fuel,
    calculatedAt: input.calculatedAt,
    priceEurL,
    range: {
      low: priceEurL - input.errorBoundEurL,
      high: priceEurL + input.errorBoundEurL,
      coverage: 0.8,
    },
    changeSinceAnchorEurL,
    weeklyEffectEurL,
    marketEffectEurL,
    taxAdjustmentEurL,
    confidence: confidenceFor(input, anchorAgeDays),
    anchorAgeDays,
    marketDataAgeDays: daysBetween(
      input.marketObservationDate,
      input.calculatedAt,
    ),
    anchor: input.anchor,
    benchmark: input.benchmark,
    weekly: weekly && {
      date: weekly.date,
      priceEurL: weekly.priceEurL,
      baselineEurL: weekly.baselineEurL,
      benchmarkEurL: weekly.benchmarkEurL,
    },
    modelVersion: input.modelVersion ?? "2.0.0",
    inputs: {
      anchorBenchmarkEurL: input.anchorBenchmarkEurL,
      currentBenchmarkEurL: input.currentBenchmarkEurL,
      vatRate: input.currentTax.vatRate,
      beta,
      errorBoundEurL: input.errorBoundEurL,
    },
  };
}

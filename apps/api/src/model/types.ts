export const fuelTypes = ["95E10", "DIESEL"] as const;
export type FuelType = (typeof fuelTypes)[number];
export type Confidence = "high" | "medium" | "low";

export interface OfficialPriceObservation {
  id?: number;
  fuel: FuelType;
  date: string;
  period: string;
  periodStart?: string;
  periodEnd?: string;
  priceEurL: number;
  source: string;
}

export type BenchmarkUnit =
  "eur_litre" | "usd_gallon" | "usd_barrel" | "usd_metric_tonne";

export interface MarketObservation {
  fuel: FuelType;
  date: string;
  price: number;
  unit: BenchmarkUnit;
  benchmark: string;
  source: string;
  densityKgPerLitre?: number;
}

export interface FxObservation {
  date: string;
  pair: "EURUSD";
  rate: number;
  source: string;
}

export interface TaxObservation {
  fuel: FuelType;
  effectiveFrom: string;
  vatRate: number;
  energyTaxEurL?: number;
  co2TaxEurL?: number;
  strategicStockFeeEurL?: number;
  otherTaxEurL?: number;
}

/** A weekly national price that carries the anchor forward past the anchor month. */
export interface WeeklyInput {
  /** Monday the weekly price was in force. */
  date: string;
  priceEurL: number;
  /**
   * Weekly price level matching the anchor (the anchor minus the recent official-minus-weekly
   * gap); the weekly effect is measured from it.
   */
  baselineEurL: number;
  /** Lagged benchmark on the weekly date; market movement is counted from there. */
  benchmarkEurL: number;
  /** Tax in force on the weekly date; changes after it are added like any tax change. */
  tax: TaxObservation;
}

export interface EstimateInput {
  fuel: FuelType;
  calculatedAt: string;
  anchor: OfficialPriceObservation;
  anchorBenchmarkEurL: number;
  currentBenchmarkEurL: number;
  anchorTax: TaxObservation;
  currentTax: TaxObservation;
  marketObservationDate: string;
  benchmark: string;
  /** Half-width of the 80% error range, from out-of-sample calibration errors. */
  errorBoundEurL: number;
  modelVersion?: string;
  beta?: number;
  dataComplete?: boolean;
  benchmarkQuality?: "preferred" | "proxy";
  highVolatility?: boolean;
  taxCertain?: boolean;
  weekly?: WeeklyInput;
}

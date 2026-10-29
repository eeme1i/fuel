import type { FuelType } from "./model/types";

type Result<T> = { value: T } | { error: string; message: string };

const fuels: Record<string, FuelType> = { "95e10": "95E10", diesel: "DIESEL" };
/** Upper bound for any single per-litre tax, to catch c/L values sent as EUR/L. */
const MAX_TAX_EUR_L = 2;
const MAX_TEXT = 300;

const invalid = (message: string) => ({
  error: "invalid_observation",
  message,
});

function isoDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const time = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(time)) return undefined;
  // Reject impossible dates such as 2026-02-31, which Date.parse would roll over.
  return new Date(`${date}T00:00:00Z`).toISOString().startsWith(date)
    ? date
    : undefined;
}

function text(value: unknown, required: true): string | undefined;
function text(value: unknown, required: false): string | null | undefined;
function text(value: unknown, required: boolean) {
  if (value == null || value === "") return required ? undefined : null;
  return typeof value === "string" && value.trim() && value.length <= MAX_TEXT
    ? value.trim()
    : undefined;
}

const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export interface MarketObservationInput {
  fuel: FuelType;
  observedAt: string;
  price: number;
  currency: "EUR" | "USD";
  unit: "litre" | "us_gallon" | "barrel" | "metric_tonne";
  densityKgPerLitre: number | null;
  benchmark: string;
  benchmarkQuality: "preferred" | "proxy";
  source: string;
  sourceRef: string | null;
}

/** Units the model can convert for each currency. */
const UNITS = {
  EUR: ["litre"],
  USD: ["us_gallon", "barrel", "metric_tonne"],
} as const;

export function parseMarketObservation(
  body: Record<string, unknown>,
): Result<MarketObservationInput> {
  const fuel = fuels[String(body.fuel ?? "").toLowerCase()];
  if (!fuel) return invalid("fuel must be 95e10 or diesel");
  const observedOn = isoDate(body.observedAt);
  if (!observedOn) return invalid("observedAt must be an ISO date");
  if (!positive(body.price)) return invalid("price must be a positive number");
  const currency = body.currency;
  if (currency !== "EUR" && currency !== "USD")
    return invalid("currency must be EUR or USD");
  const unit = body.unit as MarketObservationInput["unit"];
  if (!(UNITS[currency] as readonly string[]).includes(unit))
    return invalid(
      `unit for ${currency} must be one of ${UNITS[currency].join(", ")}`,
    );
  let densityKgPerLitre: number | null = null;
  if (unit === "metric_tonne" || body.densityKgPerLitre != null) {
    if (!positive(body.densityKgPerLitre) || body.densityKgPerLitre > 1.2)
      return {
        error: "density_required",
        message: "densityKgPerLitre must be a positive number up to 1.2",
      };
    densityKgPerLitre = body.densityKgPerLitre;
  }
  const quality = body.benchmarkQuality ?? "proxy";
  if (quality !== "proxy" && quality !== "preferred")
    return invalid("benchmarkQuality must be proxy or preferred");
  const benchmark = text(body.benchmark, true),
    source = text(body.source, true),
    sourceRef = text(body.sourceRef, false);
  if (!benchmark || !source)
    return invalid("benchmark and source are required");
  if (sourceRef === undefined) return invalid("sourceRef must be a string");
  return {
    value: {
      fuel,
      // Stored as a UTC day, the same shape as synchronized observations.
      observedAt: `${observedOn}T00:00:00Z`,
      price: body.price,
      currency,
      unit,
      densityKgPerLitre,
      benchmark,
      benchmarkQuality: quality,
      source,
      sourceRef,
    },
  };
}

export interface TaxObservationInput {
  fuel: FuelType;
  effectiveFrom: string;
  energyTaxEurL: number;
  co2TaxEurL: number;
  strategicStockFeeEurL: number;
  otherTaxEurL: number;
  vatRate: number;
  source: string;
  sourceRef: string | null;
}

export function parseTaxObservation(
  body: Record<string, unknown>,
): Result<TaxObservationInput> {
  const fuel = fuels[String(body.fuel ?? "").toLowerCase()];
  if (!fuel) return invalid("fuel must be 95e10 or diesel");
  const effectiveFrom = isoDate(body.effectiveFrom);
  if (!effectiveFrom || String(body.effectiveFrom).length !== 10)
    return invalid("effectiveFrom must be a YYYY-MM-DD date");
  if (
    typeof body.vatRate !== "number" ||
    !(body.vatRate >= 0 && body.vatRate < 1)
  )
    return invalid("vatRate must be a fraction such as 0.255");
  const amounts: Record<string, number> = {};
  for (const key of [
    "energyTaxEurL",
    "co2TaxEurL",
    "strategicStockFeeEurL",
    "otherTaxEurL",
  ]) {
    const value = body[key] ?? 0;
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > MAX_TAX_EUR_L
    )
      return invalid(
        `${key} must be EUR per litre between 0 and ${MAX_TAX_EUR_L}`,
      );
    amounts[key] = value;
  }
  const source = text(body.source, true),
    sourceRef = text(body.sourceRef, false);
  if (!source) return invalid("source is required");
  if (sourceRef === undefined) return invalid("sourceRef must be a string");
  return {
    value: {
      fuel,
      effectiveFrom,
      energyTaxEurL: amounts.energyTaxEurL,
      co2TaxEurL: amounts.co2TaxEurL,
      strategicStockFeeEurL: amounts.strategicStockFeeEurL,
      otherTaxEurL: amounts.otherTaxEurL,
      vatRate: body.vatRate,
      source,
      sourceRef,
    },
  };
}

/** Rounds for the public response; missing values stay null instead of becoming 0. */
export function rounded(value: unknown, digits: number): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
}

/** Plausible range for a Finnish pump price, to catch EUR per 1000 L sent as EUR/L. */
const PUMP_PRICE_EUR_L = [0.5, 5] as const;
const MAX_WEEKLY_ROWS = 5000;

export interface WeeklyObservationInput {
  fuel: FuelType;
  date: string;
  priceEurL: number;
}

/** A batch of weekly pump prices: `{ observations: [{ fuel, date, priceEurL }] }`. */
export function parseWeeklyObservations(
  body: Record<string, unknown>,
): Result<WeeklyObservationInput[]> {
  const items = body.observations;
  if (!Array.isArray(items) || !items.length || items.length > MAX_WEEKLY_ROWS)
    return invalid(
      `observations must be a non-empty array of at most ${MAX_WEEKLY_ROWS} items`,
    );
  const values: WeeklyObservationInput[] = [];
  for (const [index, item] of items.entries()) {
    const row = (item ?? {}) as Record<string, unknown>;
    const fuel = fuels[String(row.fuel).toLowerCase()];
    const date = isoDate(row.date);
    const price = row.priceEurL;
    if (!fuel)
      return invalid(`observations[${index}].fuel must be 95E10 or DIESEL`);
    if (!date) return invalid(`observations[${index}].date must be YYYY-MM-DD`);
    if (
      !positive(price) ||
      price < PUMP_PRICE_EUR_L[0] ||
      price > PUMP_PRICE_EUR_L[1]
    )
      return invalid(
        `observations[${index}].priceEurL must be EUR per litre between ${PUMP_PRICE_EUR_L[0]} and ${PUMP_PRICE_EUR_L[1]}`,
      );
    values.push({ fuel, date, priceEurL: price });
  }
  return { value: values };
}

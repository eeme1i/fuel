import type { D1Database } from "./db";
import type { FuelType } from "./model/types";

export interface OfficialRow {
  id: number;
  fuel: FuelType;
  observation_date: string;
  period_start: string;
  period_end: string;
  price_eur_l: number;
  source: string;
}
export interface MarketRow {
  id: number;
  fuel: FuelType;
  observed_at: string;
  price: number;
  currency: "EUR" | "USD";
  unit: "litre" | "us_gallon" | "barrel" | "metric_tonne";
  density_kg_l: number | null;
  benchmark: string;
  benchmark_quality: "preferred" | "proxy";
  source: string;
}
export interface FxRow {
  observed_on: string;
  rate: number;
  source: string;
}
export interface WeeklyRow {
  fuel: FuelType;
  observed_on: string;
  price_eur_l: number;
  source: string;
}
export interface TaxRow {
  fuel: FuelType;
  effective_from: string;
  energy_tax_eur_l: number;
  co2_tax_eur_l: number;
  strategic_stock_fee_eur_l: number;
  other_tax_eur_l: number;
  vat_rate: number;
  source: string;
}

export async function latestOfficial(
  db: D1Database,
  fuel: FuelType,
  before?: string,
) {
  const clause = before ? "AND observation_date <= ?" : "";
  return db
    .prepare(
      `SELECT * FROM official_prices WHERE fuel = ? ${clause} ORDER BY observation_date DESC LIMIT 1`,
    )
    .bind(...(before ? [fuel, before] : [fuel]))
    .first<OfficialRow>();
}

export async function latestTax(db: D1Database, fuel: FuelType, on: string) {
  return db
    .prepare(
      "SELECT * FROM tax_observations WHERE fuel=? AND effective_from<=? ORDER BY effective_from DESC LIMIT 1",
    )
    .bind(fuel, on)
    .first<TaxRow>();
}

export async function marketBetween(
  db: D1Database,
  fuel: FuelType,
  start: string,
  end: string,
) {
  return (
    await db
      .prepare(
        "SELECT * FROM market_observations WHERE fuel=? AND date(observed_at)>=? AND date(observed_at)<=? ORDER BY observed_at",
      )
      .bind(fuel, start, end)
      .all<MarketRow>()
  ).results;
}

export async function fxThrough(db: D1Database, end: string) {
  return (
    await db
      .prepare(
        "SELECT * FROM fx_observations WHERE observed_on<=? ORDER BY observed_on",
      )
      .bind(end)
      .all<FxRow>()
  ).results;
}

export async function officialThrough(
  db: D1Database,
  fuel: FuelType,
  end: string,
) {
  return (
    await db
      .prepare(
        "SELECT * FROM official_prices WHERE fuel=? AND observation_date<=? ORDER BY observation_date",
      )
      .bind(fuel, end)
      .all<OfficialRow>()
  ).results;
}

export async function taxesFor(db: D1Database, fuel: FuelType) {
  return (
    await db
      .prepare(
        "SELECT * FROM tax_observations WHERE fuel=? ORDER BY effective_from",
      )
      .bind(fuel)
      .all<TaxRow>()
  ).results;
}

export async function weeklyThrough(
  db: D1Database,
  fuel: FuelType,
  end: string,
) {
  return (
    await db
      .prepare(
        "SELECT fuel,observed_on,price_eur_l,source FROM weekly_prices WHERE fuel=? AND observed_on<=? ORDER BY observed_on",
      )
      .bind(fuel, end)
      .all<WeeklyRow>()
  ).results;
}

/** Everything the model needs for one fuel, as known on `end`. */
export async function modelInputs(db: D1Database, fuel: FuelType, end: string) {
  const [official, markets, fx, taxes, weekly] = await Promise.all([
    officialThrough(db, fuel, end),
    marketBetween(db, fuel, "0000-01-01", end),
    fxThrough(db, end),
    taxesFor(db, fuel),
    weeklyThrough(db, fuel, end),
  ]);
  return { official, markets, fx, taxes, weekly };
}

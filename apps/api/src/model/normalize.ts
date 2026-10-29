import type { MarketObservation } from "./types";

const LITRES_PER_US_GALLON = 3.785411784;
const LITRES_PER_BARREL = 158.9872949;

function requirePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${name} must be a positive finite number`);
  return value;
}

/** Converts a product benchmark to EUR/L. FX is expressed as USD per EUR. */
export function normalizeToEurPerLitre(
  observation: MarketObservation,
  eurUsd?: number,
): number {
  const price = requirePositive(observation.price, "benchmark price");
  if (observation.unit === "eur_litre") return price;

  const priceEur =
    price / requirePositive(eurUsd ?? Number.NaN, "EUR/USD rate");
  switch (observation.unit) {
    case "usd_gallon":
      return priceEur / LITRES_PER_US_GALLON;
    case "usd_barrel":
      return priceEur / LITRES_PER_BARREL;
    case "usd_metric_tonne": {
      const density = requirePositive(
        observation.densityKgPerLitre ?? Number.NaN,
        "product density",
      );
      return priceEur / (1000 / density);
    }
  }
}

import { describe, expect, it } from "vitest";
import { app } from "../index";
import type { FxRow, MarketRow, OfficialRow, TaxRow } from "../repository";
import {
  addDays,
  BenchmarkSeries,
  selectBenchmark,
  toBenchmarkPoints,
} from "./benchmark";
import { calibrate } from "./calibration";
import { estimateFuelPrice } from "./estimate";
import { normalizeToEurPerLitre } from "./normalize";
import { reconstructHistory } from "./reconstruction";
import type { EstimateInput, MarketObservation } from "./types";
import { WeeklySeries } from "./weekly";

const tax = {
  fuel: "95E10" as const,
  effectiveFrom: "2026-01-01",
  vatRate: 0.255,
};

function exampleInput(overrides: Partial<EstimateInput> = {}): EstimateInput {
  return {
    fuel: "95E10",
    calculatedAt: "2026-09-10T00:00:00Z",
    anchor: {
      fuel: "95E10",
      date: "2026-08-31",
      period: "2026-08",
      priceEurL: 1.8,
      source: "official",
    },
    anchorBenchmarkEurL: 0.6,
    currentBenchmarkEurL: 0.68,
    anchorTax: tax,
    currentTax: tax,
    marketObservationDate: "2026-09-10",
    benchmark: "ARA EUROBOB",
    errorBoundEurL: 0.03,
    ...overrides,
  };
}

/** Synthetic world: weekday benchmark, official prices generated with a known β. */
function syntheticHistory(beta = 0.8, months = 36) {
  const market: MarketRow[] = [];
  for (let date = "2022-10-01"; date <= "2025-12-31"; date = addDays(date, 1)) {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (day === 0 || day === 6) continue;
    const t = Date.parse(date) / 86_400_000;
    const eurL = 0.6 + 0.12 * Math.sin(t / 45) + 0.05 * Math.sin(t / 11);
    market.push({
      id: market.length + 1,
      fuel: "95E10",
      observed_at: `${date}T00:00:00Z`,
      price: eurL * 3.785411784,
      currency: "USD",
      unit: "us_gallon",
      density_kg_l: null,
      benchmark: "proxy",
      benchmark_quality: "proxy",
      source: "U.S. EIA",
    });
  }
  const fx: FxRow[] = [{ observed_on: "2022-01-01", rate: 1, source: "ECB" }];
  const taxes: TaxRow[] = [
    {
      fuel: "95E10",
      effective_from: "2020-01-01",
      energy_tax_eur_l: 0.5,
      co2_tax_eur_l: 0.1,
      strategic_stock_fee_eur_l: 0,
      other_tax_eur_l: 0,
      vat_rate: 0.255,
      source: "tax",
    },
  ];
  const series = new BenchmarkSeries(toBenchmarkPoints(market, fx));
  const official: OfficialRow[] = Array.from({ length: months }, (_, index) => {
    const year = 2023 + Math.floor(index / 12),
      month = (index % 12) + 1;
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    return {
      id: index + 1,
      fuel: "95E10",
      observation_date: end,
      period_start: start,
      period_end: end,
      price_eur_l: 1.2 + beta * 1.255 * series.periodMean(start, end),
      source: "official",
    };
  });
  return { market, fx, taxes, series, official };
}

describe("fuel estimate", () => {
  it("implements the anchored VAT-inclusive pass-through example", () => {
    const result = estimateFuelPrice(exampleInput());
    expect(result.marketEffectEurL).toBeCloseTo(0.1004, 10);
    expect(result.priceEurL).toBeCloseTo(1.9004, 10);
    expect(result.range.low).toBeCloseTo(1.8704, 10);
    expect(result.range.high).toBeCloseTo(1.9304, 10);
    expect(result.confidence).toBe("high");
  });

  it("applies the fitted pass-through coefficient", () => {
    const result = estimateFuelPrice(exampleInput({ beta: 0.8 }));
    expect(result.marketEffectEurL).toBeCloseTo(0.8 * 0.1004, 10);
  });

  it("does not add tax already present in the anchor", () => {
    const unchanged = { ...tax, energyTaxEurL: 0.5 };
    const result = estimateFuelPrice(
      exampleInput({ anchorTax: unchanged, currentTax: unchanged }),
    );
    expect(result.taxAdjustmentEurL).toBe(0);
  });

  it("derives confidence from the measured error bound", () => {
    expect(
      estimateFuelPrice(exampleInput({ errorBoundEurL: 0.05 })).confidence,
    ).toBe("medium");
    expect(
      estimateFuelPrice(exampleInput({ errorBoundEurL: 0.1 })).confidence,
    ).toBe("low");
  });

  it("reduces confidence for stale anchors and incomplete data", () => {
    const result = estimateFuelPrice(
      exampleInput({
        calculatedAt: "2026-11-15T00:00:00Z",
        dataComplete: false,
      }),
    );
    expect(result.confidence).toBe("low");
  });

  it("accounts for a VAT rate change since the anchor", () => {
    const result = estimateFuelPrice(
      exampleInput({
        currentBenchmarkEurL: 0.6,
        anchorTax: { ...tax, vatRate: 0.24 },
        currentTax: { ...tax, vatRate: 0.255 },
      }),
    );
    expect(result.taxAdjustmentEurL).toBeCloseTo((1.8 / 1.24) * 0.015, 10);
  });

  it("carries the anchor forward by the weekly change, then the market since that week", () => {
    const result = estimateFuelPrice(
      exampleInput({
        weekly: {
          date: "2026-09-07",
          priceEurL: 1.95,
          baselineEurL: 1.88,
          benchmarkEurL: 0.66,
          tax,
        },
      }),
    );
    expect(result.weeklyEffectEurL).toBeCloseTo(0.07, 10);
    expect(result.marketEffectEurL).toBeCloseTo(1.255 * 0.02, 10);
    expect(result.priceEurL).toBeCloseTo(1.8 + 0.07 + 1.255 * 0.02, 10);
  });
});

describe("weekly prices", () => {
  const rows = ["2026-08-24", "2026-08-31", "2026-09-07"].map(
    (observed_on, index) => ({
      fuel: "95E10" as const,
      observed_on,
      price_eur_l: 1.9 + index / 100,
      source: "eu_oil_bulletin",
    }),
  );

  it("uses a week only after its bulletin is published", () => {
    const weekly = new WeeklySeries(rows);
    const dates = (date: string) =>
      weekly.recent(date).map((row) => row.observed_on);
    expect(dates("2026-09-09")).toEqual(["2026-08-24", "2026-08-31"]);
    expect(dates("2026-09-10")).toEqual(["2026-08-31", "2026-09-07"]);
  });

  it("averages the weeks inside a period", () => {
    const weekly = new WeeklySeries(rows);
    expect(weekly.periodMean("2026-08-01", "2026-08-31")).toBeCloseTo(1.905);
    expect(weekly.periodMean("2026-07-01", "2026-07-31")).toBeNaN();
  });

  it("measures the weekly change from the anchor minus the recent official gap", () => {
    const weekly = new WeeklySeries(rows);
    const month = (start: string, end: string, price: number) => ({
      id: 1,
      fuel: "95E10" as const,
      observation_date: end,
      period_start: start,
      period_end: end,
      price_eur_l: price,
      source: "official",
    });
    // July has no weekly prices, so only August's gap (1.85 - 1.905) counts.
    const months = [
      month("2026-07-01", "2026-07-31", 1.8),
      month("2026-08-01", "2026-08-31", 1.85),
    ];
    expect(weekly.baseline(months)).toBeCloseTo(1.905);
  });
});

describe("market normalization", () => {
  it("converts USD per metric tonne using product-specific density", () => {
    const observation: MarketObservation = {
      fuel: "95E10",
      date: "2026-09-21",
      price: 850,
      unit: "usd_metric_tonne",
      densityKgPerLitre: 0.75,
      benchmark: "ARA EUROBOB",
      source: "provider",
    };
    expect(normalizeToEurPerLitre(observation, 1.18)).toBeCloseTo(0.540254, 6);
  });

  it("rejects tonne conversion without a density", () => {
    const observation: MarketObservation = {
      fuel: "DIESEL",
      date: "2026-09-21",
      price: 850,
      unit: "usd_metric_tonne",
      benchmark: "NWE diesel",
      source: "provider",
    };
    expect(() => normalizeToEurPerLitre(observation, 1.18)).toThrow(
      "product density",
    );
  });
});

describe("benchmark series", () => {
  const points = [
    { date: "2026-09-01", eurL: 0.5 },
    { date: "2026-09-07", eurL: 0.6 },
    { date: "2026-09-14", eurL: 0.7 },
    { date: "2026-09-21", eurL: 0.8 },
  ];

  it("lags and smooths over calendar days", () => {
    const series = new BenchmarkSeries(points, 5, 14);
    const window = series.window("2026-09-21");
    expect(window).toMatchObject({
      start: "2026-09-03",
      end: "2026-09-16",
      count: 2,
    });
    expect(window.mean).toBeCloseTo(0.65);
  });

  it("refuses a window with too few observations", () => {
    expect(new BenchmarkSeries(points, 5, 14).at("2026-09-21")).toBeNaN();
  });

  it("uses one benchmark, preferring preferred-quality series", () => {
    const row = (
      benchmark: string,
      quality: "proxy" | "preferred",
      date: string,
    ) =>
      ({
        benchmark,
        benchmark_quality: quality,
        observed_at: date,
      }) as MarketRow;
    expect(
      selectBenchmark([
        row("EIA", "proxy", "2026-09-20"),
        row("ARA", "preferred", "2026-09-18"),
      ]),
    ).toBe("ARA");
  });
});

describe("calibration", () => {
  it("recovers the pass-through coefficient and beats the naive baseline", () => {
    const { official, series, taxes } = syntheticHistory(0.8);
    const calibration = calibrate("95E10", official, series, taxes);
    expect(calibration.samples).toBe(35);
    expect(calibration.beta).toBeCloseTo(0.8, 6);
    expect(calibration.backtest!.samples).toBe(11);
    expect(calibration.backtest!.mae).toBeLessThan(1e-9);
    expect(calibration.backtest!.skill).toBeGreaterThan(0.99);
  });

  it("skips likely tax-change months when tax records are missing", () => {
    const { official, series } = syntheticHistory(0.8);
    const calibration = calibrate("95E10", official, series, []);
    const months = calibration.pairs.map((pair) =>
      pair.target.period_start.slice(5, 7),
    );
    expect(months).not.toContain("01");
    expect(months).not.toContain("07");
    expect(months).not.toContain("08");
  });
});

describe("historical reconstruction", () => {
  it("uses only published anchors and earlier months for daily points", async () => {
    const { official, market, fx, taxes } = syntheticHistory(0.8);
    const db = {
      prepare: (query: string) => ({
        bind: () => ({
          all: async () => ({
            results: query.includes("official_prices")
              ? official
              : query.includes("market_observations")
                ? market
                : query.includes("fx_observations")
                  ? fx
                  : query.includes("weekly_prices")
                    ? []
                    : taxes,
          }),
        }),
      }),
    };

    const history = await reconstructHistory(
      db as never,
      "95E10",
      "2025-12-31",
    );
    expect(history.monthly).toHaveLength(11);
    const daily = history.daily as Array<{
      date: string;
      anchor_date: string;
      price: number;
    }>;
    expect(daily.length).toBeGreaterThan(300);
    for (const point of daily)
      expect(addDays(point.anchor_date, 5) <= point.date).toBe(true);
    const early = daily.find((point) => point.date === "2025-03-04")!;
    expect(early.anchor_date).toBe("2025-01-31");
    const later = daily.find((point) => point.date === "2025-03-05")!;
    expect(later.anchor_date).toBe("2025-02-28");
  });
});

describe("public API", () => {
  it("publishes OpenAPI documentation and Swagger UI", async () => {
    const specification = await app.request("/openapi.json");
    expect(specification.status).toBe(200);
    expect(await specification.json()).toMatchObject({
      openapi: "3.1.0",
      paths: { "/api/v1/fuel/{fuel}": { get: {} } },
    });
    const documentation = await app.request("/docs");
    expect(documentation.status).toBe(200);
    expect(await documentation.text()).toContain("SwaggerUIBundle");
  });

  it("returns a structured 404 for an unsupported fuel", async () => {
    const response = await app.request("/api/v1/fuel/e85", {}, {} as never);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "unsupported_fuel" });
  });

  it("requires storage before publishing an estimate", async () => {
    const response = await app.request("/api/v1/fuel/95e10", {}, {
      DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) },
    } as never);
    expect(response.status).toBe(503);
  });
});

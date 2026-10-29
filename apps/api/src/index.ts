import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { backtest } from "./backtest";
import type { Bindings } from "./db";
import { cachedHistory, refreshHistory } from "./historyCache";
import { log, logError, loggedOperation } from "./log";
import { MODEL_VERSION } from "./model/load";
import { calculate } from "./model/pipeline";
import type { FuelType } from "./model/types";
import { openApiDocument, swaggerHtml } from "./openapi";
import {
  syncEcbFx,
  syncEiaMarket,
  syncOfficialPrices,
  OIL_BULLETIN_HISTORY_URL,
  syncOilBulletin,
  upsertWeekly,
} from "./providers";
import {
  parseWeeklyObservations,
  parseMarketObservation,
  parseTaxObservation,
  rounded,
} from "./validation";

const app = new Hono<{ Bindings: Bindings }>();
const fuels: Record<string, FuelType> = { "95e10": "95E10", diesel: "DIESEL" };
const fuelFrom = (value: string) => fuels[value.toLowerCase()];

interface AvailabilityRow {
  official_count: number;
  latest_official: string | null;
  market_count: number;
  latest_market: string | null;
  fx_count: number;
  latest_fx: string | null;
  tax_count: number;
  latest_tax: string | null;
}

async function availability(db: Bindings["DB"], fuel: FuelType) {
  return db
    .prepare(
      `SELECT
    (SELECT count(*) FROM official_prices WHERE fuel=?) official_count,
    (SELECT max(observation_date) FROM official_prices WHERE fuel=?) latest_official,
    (SELECT count(*) FROM market_observations WHERE fuel=?) market_count,
    (SELECT max(date(observed_at)) FROM market_observations WHERE fuel=?) latest_market,
    (SELECT count(*) FROM fx_observations) fx_count,
    (SELECT max(observed_on) FROM fx_observations) latest_fx,
    (SELECT count(*) FROM tax_observations WHERE fuel=?) tax_count,
    (SELECT max(effective_from) FROM tax_observations WHERE fuel=?) latest_tax`,
    )
    .bind(fuel, fuel, fuel, fuel, fuel, fuel)
    .first<AvailabilityRow>();
}

/**
 * Estimates change once per calculation (weekday evenings), so public reads can be cached
 * briefly by browsers and Cloudflare, and served stale while revalidating.
 */
app.use("/api/*", async (c, next) => {
  await next();
  if (c.req.method === "GET" && c.res.status === 200)
    c.header(
      "cache-control",
      "public, max-age=300, stale-while-revalidate=3600",
    );
});

app.use(
  "/api/*",
  cors({ origin: "*", allowMethods: ["GET"], allowHeaders: ["x-api-key"] }),
);

/**
 * Approved clients (`x-api-key`) share a generous per-key limit; everyone else is limited per
 * IP. The web app's service binding is trusted and bypasses both.
 */
app.use("/api/*", async (c, next) => {
  if (c.env.TRUSTED) return next();
  const apiKey = c.req.header("x-api-key");
  let limiter = c.env.ANON_RATE_LIMIT;
  let key = `ip:${c.req.header("cf-connecting-ip") ?? "unknown"}`;
  if (apiKey !== undefined) {
    const approved = (c.env.API_CLIENT_KEYS ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (!approved.includes(apiKey))
      return c.json(
        { error: "invalid_api_key", message: "Unknown x-api-key." },
        401,
      );
    limiter = c.env.CLIENT_RATE_LIMIT;
    key = `key:${apiKey}`;
  }
  if (limiter && !(await limiter.limit({ key })).success) {
    c.header("retry-after", "60");
    return c.json(
      {
        error: "rate_limited",
        message:
          "Too many requests. Retry later, or ask for an API key for higher limits.",
      },
      429,
    );
  }
  await next();
});

/** Parses a JSON object body, or returns a 400 response. */
async function jsonBody(c: Context) {
  try {
    const body: unknown = await c.req.json();
    if (body && typeof body === "object" && !Array.isArray(body))
      return body as Record<string, unknown>;
  } catch {
    // fall through to the error response
  }
  return c.json(
    { error: "invalid_json", message: "Body must be a JSON object." },
    400,
  );
}

/** Calculates both fuels, then refreshes each fuel's cached history. */
async function calculateAll(env: Bindings, trigger: string) {
  const results: Record<string, unknown> = {};
  for (const fuel of ["95E10", "DIESEL"] as const) {
    try {
      results[fuel] = await loggedOperation(
        "calculate",
        () => calculate(env.DB, fuel),
        { fuel, trigger },
      );
    } catch (error) {
      const inputs = await availability(env.DB, fuel);
      logError("calculate.skipped", error, { fuel, trigger, inputs });
      results[fuel] = { error: (error as Error).message, inputs };
    }
    try {
      await refreshHistory(env.DB, fuel);
    } catch (error) {
      logError("history.refresh_failed", error, { fuel, trigger });
    }
  }
  return results;
}

app.get("/", (c) =>
  c.json({ service: "Finnish fuel trend API", version: "v1", docs: "/docs" }),
);
app.get("/openapi.json", (c) => c.json(openApiDocument));
app.get("/docs", (c) => c.html(swaggerHtml));
app.get("/api/v1/fuel/:fuel", async (c) => {
  const fuel = fuelFrom(c.req.param("fuel"));
  if (!fuel)
    return c.json(
      { error: "unsupported_fuel", supported: Object.keys(fuels) },
      404,
    );
  const row = await c.env.DB.prepare(
    `SELECT e.*,a.price_eur_l anchor_price,a.observation_date anchor_date,a.source anchor_source FROM estimate_snapshots e JOIN official_prices a ON a.id=e.anchor_id WHERE e.fuel=? ORDER BY e.calculated_at DESC LIMIT 1`,
  )
    .bind(fuel)
    .first<Record<string, unknown>>();
  if (!row) {
    const inputs = await availability(c.env.DB, fuel);
    log("warn", "estimate.unavailable", { fuel, inputs });
    return c.json(
      {
        error: "estimate_unavailable",
        message:
          "Required official, benchmark, FX, or tax observations have not been ingested.",
      },
      503,
    );
  }
  const snapshot = JSON.parse(String(row.input_snapshot)) as {
    weekly?: {
      date: string;
      priceEurL: number;
      baselineEurL?: number;
      benchmarkEurL?: number;
      effectEurL: number;
    };
    model?: {
      anchorBenchmarkEurL?: number;
      currentBenchmarkEurL?: number;
      vatRate?: number;
      beta?: number;
      lagDays?: number;
      windowDays?: number;
      range?: { low: number; high: number; coverage: number };
    };
    calibration?: {
      samples?: number;
      backtest?: { samples: number; mae: number; naiveMae: number } | null;
    };
  };
  const range = snapshot.model?.range;
  return c.json({
    fuel,
    country: "FI",
    currency: "EUR",
    unit: "litre",
    estimate: {
      price: rounded(row.estimated_price_eur_l, 2),
      changeSinceAnchor: rounded(row.change_eur_l, 3),
      range: range
        ? {
            low: rounded(range.low, 2)!,
            high: rounded(range.high, 2)!,
            coverage: range.coverage,
          }
        : null,
      confidence: row.confidence,
      timestamp: row.calculated_at,
    },
    official: {
      price: row.anchor_price,
      date: row.anchor_date,
      source: row.anchor_source,
      ageDays: row.anchor_age_days,
    },
    components: {
      weeklyPrice: rounded(snapshot.weekly?.effectEurL, 4),
      refinedProduct: rounded(row.product_effect_eur_l, 4),
      currency: rounded(row.currency_effect_eur_l, 4),
      market: rounded(row.market_effect_eur_l, 4),
      tax: rounded(row.tax_effect_eur_l, 4),
    },
    calculation: {
      anchorPriceEurL: row.anchor_price,
      anchorBenchmarkEurL: snapshot.model?.anchorBenchmarkEurL,
      currentBenchmarkEurL: snapshot.model?.currentBenchmarkEurL,
      vatRate: snapshot.model?.vatRate,
      beta: snapshot.model?.beta,
      lagDays: snapshot.model?.lagDays,
      windowDays: snapshot.model?.windowDays,
      calibrationSamples: snapshot.calibration?.samples,
      backtestMae: snapshot.calibration?.backtest?.mae,
      backtestNaiveMae: snapshot.calibration?.backtest?.naiveMae,
      weeklyDate: snapshot.weekly?.date ?? null,
      weeklyPriceEurL: snapshot.weekly?.priceEurL ?? null,
      weeklyBaselineEurL: snapshot.weekly?.baselineEurL ?? null,
      weeklyBenchmarkEurL: snapshot.weekly?.benchmarkEurL ?? null,
      formula: snapshot.weekly
        ? "anchor + (mean of the latest two weekly prices − weekly baseline) + beta × (1 + VAT) × (lagged benchmark − benchmark on the latest weekly date) + tax change since that week; weekly baseline = anchor − mean(official − weekly) over the last six official months"
        : "anchor + beta × (1 + VAT) × (lagged benchmark − anchor-month benchmark) + tax adjustment",
    },
    marketDataAgeDays: row.market_data_age_days,
    model: {
      version: row.model_version,
      benchmark: row.benchmark,
      benchmarkQuality: row.benchmark_quality,
      method: snapshot.weekly
        ? "anchored weekly pump-price change plus lagged refined-product pass-through"
        : "anchored, lagged refined-product pass-through with fitted beta",
    },
    disclaimer:
      "Estimated Finnish average from official monthly prices carried forward with EU Weekly Oil Bulletin pump prices and a US finished-product proxy; not an observed current filling-station price.",
  });
});
app.get("/api/v1/fuel/:fuel/history", async (c) => {
  const fuel = fuelFrom(c.req.param("fuel"));
  if (!fuel) return c.json({ error: "unsupported_fuel" }, 404);
  const [estimates, official, comparisons] = await Promise.all([
    c.env.DB.prepare(
      `SELECT calculated_at timestamp,estimated_price_eur_l price,confidence,model_version
       FROM estimate_snapshots e
       WHERE e.fuel=? AND e.id=(
         SELECT e2.id FROM estimate_snapshots e2
         WHERE e2.fuel=e.fuel AND date(e2.calculated_at)=date(e.calculated_at)
         ORDER BY e2.calculated_at DESC,e2.id DESC LIMIT 1
       )
       ORDER BY calculated_at`,
    )
      .bind(fuel)
      .all<Record<string, unknown>>(),
    c.env.DB.prepare(
      `SELECT observation_date date,price_eur_l price,source FROM official_prices WHERE fuel=? ORDER BY observation_date`,
    )
      .bind(fuel)
      .all<Record<string, unknown>>(),
    c.env.DB.prepare(
      `SELECT o.observation_date date,o.price_eur_l official_price,e.estimated_price_eur_l estimated_price,e.confidence,e.calculated_at estimate_timestamp,(e.estimated_price_eur_l-o.price_eur_l) error FROM official_prices o JOIN estimate_snapshots e ON e.id=(SELECT e2.id FROM estimate_snapshots e2 JOIN official_prices a ON a.id=e2.anchor_id WHERE e2.fuel=o.fuel AND a.observation_date<o.observation_date AND date(e2.calculated_at)<=o.observation_date ORDER BY e2.calculated_at DESC LIMIT 1) WHERE o.fuel=? ORDER BY o.observation_date`,
    )
      .bind(fuel)
      .all<Record<string, unknown>>(),
  ]);
  const [reconstructed, weekly] = await Promise.all([
    cachedHistory(c.env.DB, fuel),
    c.env.DB.prepare(
      `SELECT observed_on date,price_eur_l price,source FROM weekly_prices WHERE fuel=? ORDER BY observed_on`,
    )
      .bind(fuel)
      .all<Record<string, unknown>>(),
  ]);
  return c.json({
    fuel,
    unit: "EUR/litre",
    estimates: estimates.results,
    official: official.results,
    weekly: weekly.results,
    comparisons: comparisons.results,
    reconstructed: reconstructed.monthly,
    reconstructedDaily: reconstructed.daily,
    /** Model behind the reconstruction; stored estimates from other versions are not comparable. */
    modelVersion: MODEL_VERSION,
    backtest: reconstructed.backtest,
    reconstructedAt: reconstructed.computedAt,
  });
});
app.get("/api/v1/backtests/:fuel", async (c) => {
  const fuel = fuelFrom(c.req.param("fuel"));
  if (!fuel) return c.json({ error: "unsupported_fuel" }, 404);
  try {
    return c.json({ fuel, metrics: await backtest(c.env.DB, fuel) });
  } catch (error) {
    return c.json(
      { error: "backtest_unavailable", message: (error as Error).message },
      503,
    );
  }
});

app.use("/internal/*", async (c, next) => {
  if (
    !c.env.INGEST_API_KEY ||
    c.req.header("authorization") !== `Bearer ${c.env.INGEST_API_KEY}`
  )
    return c.json({ error: "unauthorized" }, 401);
  await next();
});
app.post("/internal/sync/official", async (c) =>
  c.json({
    insertedOrUpdated: await loggedOperation("sync.official", () =>
      syncOfficialPrices(c.env.DB),
    ),
  }),
);
app.post("/internal/sync/fx", async (c) =>
  c.json({
    insertedOrUpdated: await loggedOperation("sync.fx", () =>
      syncEcbFx(c.env.DB),
    ),
  }),
);
app.post("/internal/sync/market", async (c) =>
  c.json({
    insertedOrUpdated: await loggedOperation("sync.market", () =>
      syncEiaMarket(c.env.DB, c.env.EIA_API_KEY),
    ),
  }),
);
app.post("/internal/sync/weekly", async (c) =>
  c.json({
    insertedOrUpdated: await loggedOperation("sync.weekly", () =>
      syncOilBulletin(c.env.DB),
    ),
  }),
);
/** Batch upsert of weekly pump prices; scripts/sync.mjs uses it to backfill the history. */
app.post("/internal/observations/weekly", async (c) => {
  const body = await jsonBody(c);
  if (body instanceof Response) return body;
  const parsed = parseWeeklyObservations(body);
  if ("error" in parsed) return c.json(parsed, 400);
  return c.json({
    insertedOrUpdated: await upsertWeekly(
      c.env.DB,
      parsed.value,
      OIL_BULLETIN_HISTORY_URL,
    ),
  });
});
app.post("/internal/observations/market", async (c) => {
  const body = await jsonBody(c);
  if (body instanceof Response) return body;
  const parsed = parseMarketObservation(body);
  if ("error" in parsed) return c.json(parsed, 400);
  const o = parsed.value;
  await c.env.DB.prepare(
    `INSERT INTO market_observations (fuel,observed_at,price,currency,unit,density_kg_l,benchmark,benchmark_quality,source,source_ref,ingested_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(fuel,observed_at,benchmark,source) DO UPDATE SET price=excluded.price,currency=excluded.currency,unit=excluded.unit,density_kg_l=excluded.density_kg_l,benchmark_quality=excluded.benchmark_quality,source_ref=excluded.source_ref,ingested_at=excluded.ingested_at`,
  )
    .bind(
      o.fuel,
      o.observedAt,
      o.price,
      o.currency,
      o.unit,
      o.densityKgPerLitre,
      o.benchmark,
      o.benchmarkQuality,
      o.source,
      o.sourceRef,
      new Date().toISOString(),
    )
    .run();
  return c.json({ ok: true, observation: o }, 201);
});
app.post("/internal/observations/tax", async (c) => {
  const body = await jsonBody(c);
  if (body instanceof Response) return body;
  const parsed = parseTaxObservation(body);
  if ("error" in parsed) return c.json(parsed, 400);
  const t = parsed.value;
  await c.env.DB.prepare(
    `INSERT INTO tax_observations (fuel,effective_from,energy_tax_eur_l,co2_tax_eur_l,strategic_stock_fee_eur_l,other_tax_eur_l,vat_rate,source,source_ref,ingested_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(fuel,effective_from) DO UPDATE SET energy_tax_eur_l=excluded.energy_tax_eur_l,co2_tax_eur_l=excluded.co2_tax_eur_l,strategic_stock_fee_eur_l=excluded.strategic_stock_fee_eur_l,other_tax_eur_l=excluded.other_tax_eur_l,vat_rate=excluded.vat_rate,source=excluded.source,source_ref=excluded.source_ref,ingested_at=excluded.ingested_at`,
  )
    .bind(
      t.fuel,
      t.effectiveFrom,
      t.energyTaxEurL,
      t.co2TaxEurL,
      t.strategicStockFeeEurL,
      t.otherTaxEurL,
      t.vatRate,
      t.source,
      t.sourceRef,
      new Date().toISOString(),
    )
    .run();
  return c.json({ ok: true, observation: t }, 201);
});
app.post("/internal/calculate", async (c) =>
  c.json(await calculateAll(c.env, "manual")),
);

export async function scheduled(_controller: unknown, env: Bindings) {
  log("info", "scheduled.started");
  try {
    const syncs = await Promise.allSettled([
      loggedOperation("sync.official", () => syncOfficialPrices(env.DB), {
        trigger: "scheduled",
      }),
      loggedOperation("sync.fx", () => syncEcbFx(env.DB), {
        trigger: "scheduled",
      }),
      loggedOperation(
        "sync.market",
        () => syncEiaMarket(env.DB, env.EIA_API_KEY),
        { trigger: "scheduled" },
      ),
      loggedOperation("sync.weekly", () => syncOilBulletin(env.DB), {
        trigger: "scheduled",
      }),
    ]);
    // A failed source must not block estimates from the data that is already stored.
    for (const sync of syncs)
      if (sync.status === "rejected")
        logError("scheduled.sync_failed", sync.reason);
    await calculateAll(env, "scheduled");
    log("info", "scheduled.completed");
  } catch (error) {
    logError("scheduled.failed", error);
    throw error;
  }
}
export { app };
export default { fetch: app.fetch, scheduled };
export type AppType = typeof app;

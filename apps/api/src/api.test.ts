import { describe, expect, it } from "vitest";
import { cachedHistory } from "./historyCache";
import { app } from "./index";
import { MODEL_VERSION } from "./model/load";
import { syncEiaMarket } from "./providers";
import {
  parseMarketObservation,
  parseTaxObservation,
  rounded,
} from "./validation";

const market = {
  fuel: "diesel",
  observedAt: "2026-09-21",
  price: 850,
  currency: "USD",
  unit: "metric_tonne",
  densityKgPerLitre: 0.845,
  benchmark: "NWE ULSD",
  source: "provider",
};
const taxBody = {
  fuel: "95e10",
  effectiveFrom: "2027-01-01",
  energyTaxEurL: 0.52,
  co2TaxEurL: 0.15,
  vatRate: 0.255,
  source: "vero.fi",
};

describe("market observation validation", () => {
  it("normalizes a valid observation and defaults to proxy quality", () => {
    expect(parseMarketObservation(market)).toEqual({
      value: expect.objectContaining({
        fuel: "DIESEL",
        observedAt: "2026-09-21T00:00:00Z",
        benchmarkQuality: "proxy",
        sourceRef: null,
      }),
    });
  });

  it.each([
    [{ currency: "EUR", unit: "us_gallon" }, "unit for EUR"],
    [{ currency: "USD", unit: "litre" }, "unit for USD"],
    [{ observedAt: "2026-02-31" }, "observedAt"],
    [{ observedAt: "yesterday" }, "observedAt"],
    [{ price: "850" }, "price"],
    [{ benchmarkQuality: "gold" }, "benchmarkQuality"],
    [{ densityKgPerLitre: undefined }, "densityKgPerLitre"],
  ])("rejects %o", (override, message) => {
    const result = parseMarketObservation({ ...market, ...override });
    expect(result).toMatchObject({ message: expect.stringContaining(message) });
  });
});

describe("tax observation validation", () => {
  it("accepts EUR/L amounts and a VAT fraction", () => {
    expect(parseTaxObservation(taxBody)).toMatchObject({
      value: { fuel: "95E10", strategicStockFeeEurL: 0, vatRate: 0.255 },
    });
  });

  it.each([
    [{ vatRate: 25.5 }, "vatRate"],
    [{ vatRate: "0.255" }, "vatRate"],
    [{ energyTaxEurL: 51.99 }, "energyTaxEurL"],
    [{ co2TaxEurL: -0.1 }, "co2TaxEurL"],
    [{ effectiveFrom: "2027-01-01T00:00:00Z" }, "effectiveFrom"],
  ])("rejects %o", (override, message) => {
    expect(parseTaxObservation({ ...taxBody, ...override })).toMatchObject({
      message: expect.stringContaining(message),
    });
  });
});

describe("public rounding", () => {
  it("keeps missing values null instead of zero", () => {
    expect(rounded(null, 4)).toBeNull();
    expect(rounded(undefined, 4)).toBeNull();
    expect(rounded(0.123456, 4)).toBe(0.1235);
    expect(rounded(0, 2)).toBe(0);
  });
});

describe("internal routes", () => {
  const env = { INGEST_API_KEY: "secret", DB: {} } as never;
  const post = (path: string, body: string) =>
    app.request(
      path,
      {
        method: "POST",
        headers: {
          authorization: "Bearer secret",
          "content-type": "application/json",
        },
        body,
      },
      env,
    );

  it("returns 400 for malformed JSON", async () => {
    const response = await post("/internal/observations/tax", "{not json");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_json" });
  });

  it("returns 400 with a reason for an invalid observation", async () => {
    const response = await post(
      "/internal/observations/tax",
      JSON.stringify({ ...taxBody, vatRate: 24 }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "invalid_observation",
      message: expect.stringContaining("vatRate"),
    });
  });
});

describe("history cache", () => {
  it("serves the stored reconstruction without recomputing", async () => {
    const payload = {
      monthly: [],
      daily: [],
      backtest: null,
      computedAt: "2026-09-22",
    };
    const queries: string[] = [];
    const db = {
      prepare: (query: string) => {
        queries.push(query);
        return {
          bind: () => ({
            first: async () => ({
              payload: JSON.stringify(payload),
              model_version: MODEL_VERSION,
            }),
          }),
        };
      },
    };
    expect(await cachedHistory(db as never, "95E10")).toEqual(payload);
    expect(queries).toHaveLength(1);
  });

  it("adds cache headers to successful public reads only", async () => {
    const payload = { monthly: [], daily: [], backtest: { mae: 0.034 } };
    const db = {
      prepare: () => ({
        bind: () => ({
          first: async () => ({
            payload: JSON.stringify(payload),
            model_version: MODEL_VERSION,
          }),
        }),
      }),
    };
    const ok = await app.request("/api/v1/backtests/95e10", {}, {
      DB: db,
    } as never);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toContain("max-age=300");
    const missing = await app.request("/api/v1/fuel/e85", {}, {} as never);
    expect(missing.headers.get("cache-control")).toBeNull();
  });
});

describe("public rate limits", () => {
  const limiter = (allowed: boolean) => {
    const keys: string[] = [];
    return {
      keys,
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: allowed };
      },
    };
  };
  const get = (headers: Record<string, string>, env: object) =>
    app.request("/api/v1/fuel/e85", { headers }, env as never);

  it("limits anonymous clients per IP", async () => {
    const anon = limiter(false);
    const response = await get(
      { "cf-connecting-ip": "203.0.113.7" },
      { ANON_RATE_LIMIT: anon },
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(anon.keys).toEqual(["ip:203.0.113.7"]);
  });

  it("uses the client limit for approved keys and rejects unknown keys", async () => {
    const anon = limiter(false);
    const client = limiter(true);
    const env = {
      API_CLIENT_KEYS: "alpha, beta",
      ANON_RATE_LIMIT: anon,
      CLIENT_RATE_LIMIT: client,
    };
    expect((await get({ "x-api-key": "beta" }, env)).status).toBe(404);
    expect(client.keys).toEqual(["key:beta"]);
    expect((await get({ "x-api-key": "gamma" }, env)).status).toBe(401);
    expect(anon.keys).toEqual([]);
  });

  it("does not limit the trusted service binding", async () => {
    const anon = limiter(false);
    const response = await get({}, { TRUSTED: true, ANON_RATE_LIMIT: anon });
    expect(response.status).toBe(404);
    expect(anon.keys).toEqual([]);
  });
});

describe("EIA sync", () => {
  it("retries a rate-limited request before giving up", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      return new Response("", { status: 429 });
    }) as unknown as typeof fetch;
    const db = {
      prepare: () => ({
        bind: () => ({ first: async () => null }),
        first: async () => null,
      }),
    };
    await expect(
      syncEiaMarket(db as never, "key", fetcher, [0, 0]),
    ).rejects.toThrow("EIA_API_KEY");
    expect(calls).toBe(3);
  });
});

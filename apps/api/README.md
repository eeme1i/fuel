# Finnish fuel trend API

Hono/Cloudflare Workers API for an anchored Finnish national-average fuel price estimate.
It uses D1 for immutable calculation snapshots and source observations. Statistics Finland
official prices, EU Weekly Oil Bulletin pump prices and ECB EUR/USD rates are synchronized by
the Worker cron. Refined-product
benchmarks currently come from free U.S. EIA finished-product series and are explicitly treated
as lower-confidence geographic proxies. Official Finnish tax levels are seeded as dated,
source-linked records; authenticated ingestion remains available for corrections and future rates.

Supported routes:

```txt
GET /api/v1/fuel/95e10
GET /api/v1/fuel/diesel
GET /api/v1/fuel/95e10/history
GET /api/v1/backtests/95e10
```

Interactive Swagger UI is available at `GET /docs`; the OpenAPI 3.1 document is available at
`GET /openapi.json`.

## Model (v2.1.0)

```txt
estimate = anchor
         + (W̄_today − W*_anchor)                                  weekly pump prices
         + β × (1 + VAT) × (B̄_today − B̄_latest week)              market since that week
         + tax change since the latest week

W*_anchor = anchor − mean(official − weekly monthly mean) over the last 6 official months
```

- `W̄_today` is the mean of the two latest Finnish weekly pump prices (EU Weekly Oil Bulletin,
  prices in force on Mondays, VAT and duties included) whose bulletin was out by `today`
  (published on Thursdays, so a week counts from Monday + 3 days). Two weeks halve the noise of
  single Monday readings.
- The bulletin's level differs from Statistics Finland's (different survey), and the gap jumps by
  a few cents from month to month, so only its change is used, against the gap averaged over six
  months.
- `B̄_t` is the mean of one benchmark series over a 21-day window ending 5 days before `t`
  (pump prices lag wholesale prices). It only covers the days after the latest weekly price.
- β is fitted per fuel by least squares on consecutive Statistics Finland months (2016 onwards).
  Months before the stored tax records that usually carry tax changes (January, July, August) are
  excluded.
- Without weekly prices for the anchor month the model falls back to v2.0.0:
  `anchor + β × (1 + VAT) × (B̄_today − B̄_anchor month) + tax adjustment`.
- The 80% range and confidence come from out-of-sample errors (each month predicted only from
  earlier months), widened by √(months since the anchor month).
- `GET /api/v1/backtests/{fuel}` reports those errors next to a no-change baseline. On data through
  2026-09 (82 months), MAE is 2.4 c/L for 95E10 and 2.4 c/L for diesel, against 3.5 and 4.1 c/L
  for v2.0.0 and 5.0 and 6.4 c/L for no change.
- The daily history assumes official months are public 5 days after month-end (Statistics
  Finland's 11xx table had September 2026 on 2026-09-28).

The first sync backfills from 2016 (a few batched D1 queries per source); later syncs refresh the
last 45 days. The model preserves full-precision inputs internally and rounds only the public
response.
Run it with:

```txt
pnpm install
pnpm dev
pnpm test
pnpm typecheck
```

Create the D1 database, set its `database_id` in `wrangler.jsonc` (keep the binding named `DB`), apply the
migrations with `wrangler d1 migrations apply fuel` (add `--local` for development), and set `INGEST_API_KEY` as a Worker secret. Ingestion routes use
`Authorization: Bearer <key>`:

```txt
POST /internal/sync/official
POST /internal/sync/fx
POST /internal/sync/market
POST /internal/sync/weekly
POST /internal/observations/weekly
POST /internal/observations/market
POST /internal/observations/tax
POST /internal/calculate
```

`pnpm sync` (local) and `pnpm sync:remote` run the three syncs and a calculation in order; see
the [root README](../../README.md) for setup and deployment.

The automatic market sync uses EIA's `DEMO_KEY` by default, which is heavily rate limited; set
a free `EIA_API_KEY` Worker secret. Rate-limited or failing EIA requests are retried twice with
backoff.

Manually supplied market observations require `fuel`, `observedAt` (ISO date), `price`,
`currency`, `unit`, `benchmark` and `source`. `EUR` prices must be per `litre`; `USD` prices per
`us_gallon`, `barrel` or `metric_tonne`. Metric-tonne observations also require
`densityKgPerLitre`; petrol and diesel density is never inferred. `benchmarkQuality` defaults to
`proxy`; send `"preferred"` only for a benchmark that genuinely represents the Finnish market.
Tax observations take EUR/L amounts (not c/L) and `vatRate` as a fraction such as `0.255`.
Invalid bodies get a 400 with a `message` explaining the problem. Public estimates remain
unavailable until the full real-data chain exists for the anchor and current period.

Each calculation (cron or `POST /internal/calculate`) also stores that fuel's reconstructed
history and backtest in `history_cache`, so `/history` and `/backtests` read one row. After
manual ingestion, run `POST /internal/calculate` to refresh them. Public `GET /api/*` responses
carry `Cache-Control: public, max-age=300, stale-while-revalidate=3600`.

The API is public at `https://api.fuel.eeru.net` (docs at `/docs`). `GET /api/*` is rate limited
per IP (60 requests/minute). Approved clients send `x-api-key: <key>` and get 1000
requests/minute per key; keys are the comma-separated `API_CLIENT_KEYS` Worker secret, and an
unknown key gets a 401. The web app calls the `TrustedApi` entrypoint through a service binding,
which is not reachable from the internet and skips the limits.

```txt
pnpm run deploy
```

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```txt
npm run cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiating `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>();
```

# fuel

Estimated Finnish national-average fuel prices, as a pnpm/Turborepo monorepo on Cloudflare Workers.

| Path              | What                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `apps/api`        | `fuel-api` Worker (Hono + D1): data sync, model, public API. [README](apps/api/README.md) |
| `apps/web`        | `fuel-web` Worker (SvelteKit): the site. [README](apps/web/README.md)                     |
| `packages/shared` | Shared TypeScript                                                                         |

The web app reads everything from the API, and the API only has data after the sync endpoints
have run. On a fresh database, run the [initial sync](#initial-data-sync) before expecting
estimates.

## Local development

Requirements: Node 22.18+, pnpm 10 (`corepack enable`).

```sh
pnpm install

# API secrets for wrangler dev (gitignored)
cat > apps/api/.dev.vars <<EOF
INGEST_API_KEY=$(openssl rand -hex 32)
# Optional; without it EIA's heavily rate-limited DEMO_KEY is used.
# Free key: https://www.eia.gov/opendata/register.php
EIA_API_KEY=
EOF

# Create the local D1 database (under apps/api/.wrangler) and apply migrations
pnpm --filter api db:migrate

# Start both apps: API on http://127.0.0.1:8787, web on http://localhost:5173
pnpm dev
```

In another terminal, fill the database (see [Initial data sync](#initial-data-sync)):

```sh
pnpm --filter api sync
```

Useful while developing:

- API docs: <http://127.0.0.1:8787/docs>.
- Cron does not fire in `wrangler dev`. `curl http://127.0.0.1:8787/cdn-cgi/local/scheduled`
  runs the scheduled handler once (all syncs plus the calculation).
- To work on the site against production data, skip the local API:
  `API_BASE_URL=https://api.fuel.eeru.net pnpm --filter web dev`.
- New migration: add `apps/api/migrations/000N_name.sql`, then `pnpm --filter api db:migrate`
  (and `db:migrate:remote` when deploying).
- To start over locally, delete `apps/api/.wrangler/state` and migrate again.

> **TLS roots:** locally, workerd trusts only the OpenSSL CA bundle (`/etc/ssl/cert.pem` on
> macOS), not the system keychain. macOS's bundle lacks the root ECB's API chains to, which made
> the FX sync fail with `internal error; reference = …`. The API's `pnpm dev`
> (`apps/api/scripts/dev.mjs`) adds Node's Mozilla roots and sets `SSL_CERT_FILE`, so start the
> API through it rather than plain `wrangler dev`. Deployed Workers are unaffected.

## Production deployment

Both Workers deploy to one Cloudflare account. The API serves `api.fuel.eeru.net` and the
web app `fuel.eeru.net`, both as custom domains, so the `eeru.net` zone must be in that account.
If you deploy elsewhere, change `routes` in both `wrangler.jsonc` files.

### First time

```sh
cd apps/api
npx wrangler login

# D1: skip if the database_id in wrangler.jsonc already exists in your account.
# Otherwise create it and paste the printed database_id into wrangler.jsonc (binding stays DB).
npx wrangler d1 create fuel
pnpm db:migrate:remote

# Secrets
openssl rand -hex 32 | npx wrangler secret put INGEST_API_KEY   # keep a copy for syncing
npx wrangler secret put EIA_API_KEY                              # recommended
npx wrangler secret put API_CLIENT_KEYS                          # optional: comma-separated x-api-key values

# API first: the web app's service binding points at the fuel-api Worker.
pnpm run deploy
cd ../web && pnpm run deploy
```

Then run the initial sync against production:

```sh
INGEST_API_KEY=<the key> pnpm --filter api sync:remote
```

The rate-limit `namespace_id`s in `apps/api/wrangler.jsonc` must be unique within the account.

### Updates

Use `pnpm run deploy`, not `pnpm deploy`: `deploy` is a built-in pnpm command, so the bare form
ignores the package script.

```sh
pnpm --filter api db:migrate:remote   # only if there are new migrations
pnpm --filter api run deploy
pnpm --filter web run deploy          # if the web app changed
```

`pnpm run deploy` at the root deploys both through Turborepo but doesn't wait for the API before
the web app. That's fine for routine updates. On a first deploy, or when the binding contract
changes, deploy the API first.

After deploying, the API cron (`15 16 * * 1-5`, 16:15 UTC on weekdays) syncs all sources and
recalculates, so no manual step is needed day to day. Logs are in the Cloudflare dashboard
(Workers → fuel-api → Observability) or through `npx wrangler tail` in `apps/api`.

## Initial data sync

`apps/api/scripts/sync.mjs` calls the authenticated ingestion routes in the cron's order:

1. `POST /internal/sync/official`: Statistics Finland monthly prices
2. `POST /internal/sync/fx`: ECB EUR/USD
3. `POST /internal/sync/market`: EIA refined-product benchmarks
4. `weekly-history`: the script downloads the EU Weekly Oil Bulletin's full price history (about
   4 MB), parses Finland's weekly pump prices locally and posts them to
   `POST /internal/observations/weekly`. Parsing it takes ~200 ms of CPU, too much for a Worker on
   the free plan, so the Worker never does it.
5. `POST /internal/sync/weekly`: the bulletin's latest week (a small file; the cron runs this too)
6. `POST /internal/calculate`: estimates, history cache and backtests for both fuels

The first run backfills from 2016 and takes a few seconds. `weekly-history` needs Node 22.18 or
newer, which runs the TypeScript xlsx reader directly. Rerun it if the cron missed a whole week of
bulletins (it only ever fetches the latest one). Later runs refresh the last 45 days,
so it is safe to rerun at any time. Tax rates come from the migrations, not from a sync.

```sh
pnpm --filter api sync                                   # local, key from apps/api/.dev.vars
INGEST_API_KEY=… pnpm --filter api sync:remote           # https://api.fuel.eeru.net
INGEST_API_KEY=… pnpm --filter api sync --url <base>     # any other deployment
pnpm --filter api sync --only market,calculate           # a subset of steps
```

A step that fails doesn't stop the later steps, matching the cron. The script prints each
response and exits non-zero if any request failed or `calculate` skipped a fuel. A skipped fuel
comes with an `inputs` summary that shows which data is missing.

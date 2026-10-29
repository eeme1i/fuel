#!/usr/bin/env node
/**
 * Runs the data syncs and a calculation against a running API, like the cron does.
 * Use it to fill a fresh database (the first sync backfills from 2016) or to refresh on demand.
 *
 *   node scripts/sync.mjs                 # local `wrangler dev` on 127.0.0.1:8787, key from .dev.vars
 *   node scripts/sync.mjs --remote        # https://api.fuel.eeru.net, key from $INGEST_API_KEY
 *   node scripts/sync.mjs --url <base>    # any other deployment
 *   node scripts/sync.mjs --only fx,calculate
 *
 * `weekly-history` downloads the EU Weekly Oil Bulletin's full history (about 4 MB) and parses it
 * here, because that takes too much CPU for a Worker on the free plan; it posts Finland's rows
 * from 2016 on. The Worker's own `weekly` step only fetches the latest week. Needs Node 22.18+
 * (it imports the TypeScript xlsx reader directly).
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { excelDate, readSheet } from "../src/xlsx.ts";

const LOCAL_URL = "http://127.0.0.1:8787";
const REMOTE_URL = "https://api.fuel.eeru.net";
const STEPS = {
  official: "/internal/sync/official",
  fx: "/internal/sync/fx",
  market: "/internal/sync/market",
  "weekly-history": "/internal/observations/weekly",
  weekly: "/internal/sync/weekly",
  calculate: "/internal/calculate",
};

const { values } = parseArgs({
  // pnpm forwards a literal `--` (`pnpm sync -- --remote`); drop it.
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    remote: { type: "boolean", default: false },
    url: { type: "string" },
    only: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(
    `Usage: node scripts/sync.mjs [--remote | --url <base>] [--only ${Object.keys(STEPS).join(",")}]`,
  );
  process.exit(0);
}

const baseUrl = (
  values.url ?? (values.remote ? REMOTE_URL : LOCAL_URL)
).replace(/\/$/, "");
const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(
  new URL(baseUrl).hostname,
);

/** Reads a key from .dev.vars (next to wrangler.jsonc), which `wrangler dev` also uses. */
function devVar(name) {
  try {
    const file = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
    const line = file.split("\n").find((l) => l.startsWith(`${name}=`));
    return line
      ?.slice(name.length + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1");
  } catch {
    return undefined;
  }
}

const key =
  process.env.INGEST_API_KEY ??
  (isLocal ? devVar("INGEST_API_KEY") : undefined);
if (!key) {
  console.error(
    isLocal
      ? "INGEST_API_KEY not found in the environment or apps/api/.dev.vars."
      : "Set INGEST_API_KEY to the Worker's secret, e.g. INGEST_API_KEY=... pnpm sync:remote",
  );
  process.exit(1);
}

const steps = values.only
  ? values.only.split(",").map((s) => s.trim())
  : Object.keys(STEPS);
const unknown = steps.filter((s) => !(s in STEPS));
if (unknown.length) {
  console.error(`Unknown step(s): ${unknown.join(", ")}`);
  process.exit(1);
}

const OIL_BULLETIN_HISTORY_URL =
  "https://energy.ec.europa.eu/document/download/906e60ca-8b6a-44e7-8589-652854d2fd3f_en";
const HISTORY_START = "2016-01-01";
const WEEKLY_COLUMNS = {
  "95E10": "FI_price_with_tax_euro95",
  DIESEL: "FI_price_with_tax_diesel",
};

/** Finland's weekly prices from the bulletin history, as the weekly observations route takes them. */
async function weeklyHistory() {
  const response = await fetch(OIL_BULLETIN_HISTORY_URL);
  if (!response.ok)
    throw new Error(`Weekly Oil Bulletin returned ${response.status}`);
  const sheet = await readSheet(
    new Uint8Array(await response.arrayBuffer()),
    "Prices with taxes",
  );
  const header = sheet[0] ?? {};
  const observations = [];
  for (const [fuel, name] of Object.entries(WEEKLY_COLUMNS)) {
    const column = Object.keys(header).find((key) => header[key] === name);
    if (!column)
      throw new Error(`Weekly Oil Bulletin column ${name} not found`);
    for (const row of sheet.slice(1)) {
      const serial = Number(row.A),
        priceEurL = Number(row[column]) / 1000;
      // Header rows and weeks Finland did not report have no number here.
      if (!row.A || !Number.isFinite(serial) || !(priceEurL > 0)) continue;
      const date = excelDate(serial);
      if (date >= HISTORY_START) observations.push({ fuel, date, priceEurL });
    }
  }
  return JSON.stringify({ observations });
}
const BODIES = { "weekly-history": weeklyHistory };

console.log(`Syncing ${baseUrl}`);
let failed = false;
// Sequential on purpose: the first run backfills years of data, and a failed source should not
// stop the others (the calculation uses whatever is already stored).
for (const step of steps) {
  const started = Date.now();
  process.stdout.write(`→ ${step} … `);
  try {
    const payload = await BODIES[step]?.();
    const response = await fetch(`${baseUrl}${STEPS[step]}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        ...(payload && { "content-type": "application/json" }),
      },
      body: payload,
    });
    const text = await response.text();
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    let body = text;
    let skipped = [];
    try {
      const json = JSON.parse(text);
      body = JSON.stringify(json, null, 2);
      // /internal/calculate answers 200 even when a fuel lacks inputs; it reports `error` per fuel.
      if (step === "calculate")
        skipped = Object.keys(json).filter((fuel) => json[fuel]?.error);
    } catch {
      // not JSON; print as is
    }
    if (!response.ok || skipped.length) failed = true;
    const status = !response.ok
      ? `HTTP ${response.status}`
      : skipped.length
        ? `skipped ${skipped.join(", ")}`
        : "ok";
    console.log(`${status} (${seconds}s)`);
    console.log(body.replace(/^/gm, "  "));
  } catch (error) {
    failed = true;
    console.log("failed");
    console.error(
      `  ${error.message}${isLocal ? " — is `pnpm dev` running in apps/api?" : ""}`,
    );
  }
}

process.exit(failed ? 1 : 0);

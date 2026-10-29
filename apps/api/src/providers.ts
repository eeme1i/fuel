import type { D1Database } from "./db";
import { log } from "./log";
import type { FuelType } from "./model/types";
import { excelDate, readSheet } from "./xlsx";

const STATFIN_URL =
  "https://pxweb2.stat.fi/PxWeb/api/v1/en/StatFin/khi/11xx.px";
/**
 * The EU Weekly Oil Bulletin's latest prices with taxes (about 16 KB). The document is replaced
 * every week under the same URL; its filename keeps an old date. The full history (about 4 MB)
 * takes ~200 ms of CPU to parse, too much for a Worker on the free plan, so it is backfilled
 * from scripts/sync.mjs instead.
 */
export const OIL_BULLETIN_HISTORY_URL =
  "https://energy.ec.europa.eu/document/download/906e60ca-8b6a-44e7-8589-652854d2fd3f_en";
export const OIL_BULLETIN_URL =
  "https://energy.ec.europa.eu/document/download/264c2d0f-f161-4ea3-a777-78faae59bea0_en";
const ECB_URL =
  "https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A";
/** First sync backfills from here so β can be calibrated on several years of months. */
const HISTORY_START = "2016-01-01";
/** Later syncs re-fetch this many days to pick up revisions. */
const REFRESH_DAYS = 45;
/** Earliest stored date at or before this counts as backfilled (allows for holidays). */
const BACKFILLED_BY = "2016-01-15";
/** Rows per statement; each chunk is one JSON parameter, well below D1's size limits. */
const CHUNK = 500;

const STATFIN_FUELS: Record<string, "95E10" | "DIESEL"> = {
  "0700100": "DIESEL",
  "0700200": "95E10",
};

/**
 * Upserts rows with one statement per chunk via `json_each`, keeping a full backfill to a
 * handful of D1 queries.
 */
async function upsertJson(db: D1Database, sql: string, rows: unknown[]) {
  for (let index = 0; index < rows.length; index += CHUNK)
    await db
      .prepare(sql)
      .bind(
        JSON.stringify(rows.slice(index, index + CHUNK)),
        new Date().toISOString(),
      )
      .run();
  return rows.length;
}

/** Backfills from HISTORY_START until the table reaches it, then refreshes recent days. */
async function syncStart(db: D1Database, sql: string, ...params: unknown[]) {
  // D1 rejects an empty bind() call, so bind only when there are parameters.
  const statement = params.length
    ? db.prepare(sql).bind(...params)
    : db.prepare(sql);
  const range = await statement.first<{
    earliest: string | null;
    latest: string | null;
  }>();
  if (
    !range?.earliest ||
    !range.latest ||
    range.earliest.slice(0, 10) > BACKFILLED_BY
  )
    return HISTORY_START;
  return new Date(
    Date.parse(`${range.latest.slice(0, 10)}T00:00:00Z`) -
      REFRESH_DAYS * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
}

interface JsonStatDimension {
  category: { index: Record<string, number>; label?: Record<string, string> };
}
interface JsonStat {
  id: string[];
  size: number[];
  value: Array<number | null>;
  dimension: Record<string, JsonStatDimension>;
}

export async function syncOfficialPrices(
  db: D1Database,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(STATFIN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: [
        { code: "timeperiod_m", selection: { filter: "top", values: ["130"] } },
        {
          code: "coicop_13_20160512",
          selection: { filter: "item", values: Object.keys(STATFIN_FUELS) },
        },
        {
          code: "contentscode",
          selection: { filter: "item", values: ["khi-keskihinta"] },
        },
      ],
      response: { format: "json-stat2" },
    }),
  });
  if (!response.ok)
    throw new Error(`Statistics Finland returned ${response.status}`);
  const data = (await response.json()) as JsonStat;
  const monthKey = data.id.find((id) => id.startsWith("timeperiod"));
  const commodityKey = data.id.find((id) => id.startsWith("coicop"));
  if (!monthKey || !commodityKey)
    throw new Error(`unexpected Statistics Finland dimensions: ${data.id}`);
  for (const [code, fuel] of Object.entries(STATFIN_FUELS)) {
    const label = data.dimension[commodityKey].category.label?.[code] ?? "";
    const expected = fuel === "DIESEL" ? /diesel/i : /95/;
    if (!expected.test(label))
      throw new Error(
        `Statistics Finland code ${code} is "${label}", expected ${fuel}`,
      );
  }
  // json-stat2 values are row-major in `id` order; every other dimension has size 1.
  const stride = (key: string) =>
    data.size.slice(data.id.indexOf(key) + 1).reduce((a, b) => a * b, 1);
  const monthStride = stride(monthKey),
    commodityStride = stride(commodityKey);
  const rows: unknown[] = [];
  for (const [month, monthIndex] of Object.entries(
    data.dimension[monthKey].category.index,
  )) {
    const match = /^(\d{4})M(\d{2})$/.exec(month);
    if (!match) continue;
    for (const [code, commodityIndex] of Object.entries(
      data.dimension[commodityKey].category.index,
    )) {
      const fuel = STATFIN_FUELS[code];
      const value =
        data.value[monthIndex * monthStride + commodityIndex * commodityStride];
      if (!fuel || value == null) continue;
      const end = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0))
        .toISOString()
        .slice(0, 10);
      rows.push({
        fuel,
        start: `${match[1]}-${match[2]}-01`,
        end,
        price: value,
      });
    }
  }
  return upsertJson(
    db,
    `INSERT INTO official_prices (fuel,observation_date,period_start,period_end,price_eur_l,source,source_ref,ingested_at)
     SELECT json_extract(value,'$.fuel'), json_extract(value,'$.end'), json_extract(value,'$.start'), json_extract(value,'$.end'), json_extract(value,'$.price'), 'statistics_finland', '${STATFIN_URL}', ?2
     FROM json_each(?1) WHERE true
     ON CONFLICT(fuel,observation_date,source) DO UPDATE SET price_eur_l=excluded.price_eur_l,period_start=excluded.period_start,period_end=excluded.period_end,ingested_at=excluded.ingested_at`,
    rows,
  );
}

export async function syncEcbFx(db: D1Database, fetcher: typeof fetch = fetch) {
  const start = await syncStart(
    db,
    "SELECT min(observed_on) earliest, max(observed_on) latest FROM fx_observations",
  );
  const response = await fetcher(
    `${ECB_URL}?format=csvdata&detail=dataonly&startPeriod=${start}`,
  );
  if (!response.ok) throw new Error(`ECB returned ${response.status}`);
  const lines = (await response.text()).trim().split(/\r?\n/);
  const headers = lines.shift()!.split(",");
  const dateIndex = headers.indexOf("TIME_PERIOD"),
    valueIndex = headers.indexOf("OBS_VALUE");
  if (dateIndex < 0 || valueIndex < 0)
    throw new Error("unexpected ECB CSV schema");
  const rows: unknown[] = [];
  for (const line of lines) {
    const columns = line.split(",");
    const rate = Number(columns[valueIndex]);
    if (!columns[dateIndex] || !Number.isFinite(rate) || rate <= 0) continue;
    rows.push({ date: columns[dateIndex], rate });
  }
  return upsertJson(
    db,
    `INSERT INTO fx_observations (observed_on,pair,rate,source,ingested_at)
     SELECT json_extract(value,'$.date'), 'EURUSD', json_extract(value,'$.rate'), 'ECB', ?2 FROM json_each(?1) WHERE true
     ON CONFLICT(observed_on) DO UPDATE SET rate=excluded.rate,ingested_at=excluded.ingested_at`,
    rows,
  );
}

interface EiaResponse {
  response?: { data?: Array<{ period: string; value: string }> };
}
const EIA_SERIES = {
  "95E10": {
    id: "EER_EPMRU_PF4_Y35NY_DPG",
    name: "EIA New York Harbor conventional gasoline",
  },
  DIESEL: {
    id: "EER_EPD2DXL0_PF4_Y35NY_DPG",
    name: "EIA New York Harbor ultra-low-sulfur diesel",
  },
} as const;

const EIA_RETRY_DELAYS_MS = [2_000, 10_000];

/** Retries rate-limit and server errors with backoff; other failures surface immediately. */
async function fetchWithRetry(
  fetcher: typeof fetch,
  url: string,
  delays = EIA_RETRY_DELAYS_MS,
) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetcher(url);
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= delays.length) return response;
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 30_000)
        : delays[attempt];
    log("warn", "eia.retry", {
      status: response.status,
      attempt: attempt + 1,
      delayMs: delay,
    });
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

/**
 * Free finished-product proxy. After the first backfill each run asks only for the last
 * REFRESH_DAYS, i.e. two small requests a day. DEMO_KEY is shared and heavily rate limited;
 * set EIA_API_KEY (free registration).
 */
export async function syncEiaMarket(
  db: D1Database,
  apiKey = "DEMO_KEY",
  fetcher: typeof fetch = fetch,
  retryDelays = EIA_RETRY_DELAYS_MS,
) {
  if (apiKey === "DEMO_KEY")
    log("warn", "eia.demo_key", {
      message:
        "EIA_API_KEY is not set; DEMO_KEY requests are likely to be rate limited",
    });
  let count = 0;
  for (const [fuel, series] of Object.entries(EIA_SERIES)) {
    const start = await syncStart(
      db,
      "SELECT min(observed_at) earliest, max(observed_at) latest FROM market_observations WHERE fuel=? AND benchmark=?",
      fuel,
      series.name,
    );
    const params = new URLSearchParams({
      api_key: apiKey,
      frequency: "daily",
      start,
      "data[0]": "value",
      "facets[series][]": series.id,
      "sort[0][column]": "period",
      "sort[0][direction]": "asc",
      offset: "0",
      length: "5000",
    });
    const response = await fetchWithRetry(
      fetcher,
      `https://api.eia.gov/v2/petroleum/pri/spt/data/?${params}`,
      retryDelays,
    );
    if (!response.ok)
      throw new Error(
        response.status === 429
          ? "EIA rate limit reached; set the EIA_API_KEY secret"
          : `EIA returned ${response.status}`,
      );
    const data = (await response.json()) as EiaResponse;
    const rows = (data.response?.data ?? [])
      .map((row) => ({
        observedAt: `${row.period}T00:00:00Z`,
        price: Number(row.value),
      }))
      .filter((row) => Number.isFinite(row.price) && row.price > 0);
    count += await upsertJson(
      db,
      `INSERT INTO market_observations (fuel,observed_at,price,currency,unit,density_kg_l,benchmark,benchmark_quality,source,source_ref,ingested_at)
       SELECT '${fuel}', json_extract(value,'$.observedAt'), json_extract(value,'$.price'), 'USD', 'us_gallon', NULL, '${series.name}', 'proxy', 'U.S. EIA', 'https://www.eia.gov/dnav/pet/pet_pri_spt_s1_d.htm', ?2
       FROM json_each(?1) WHERE true
       ON CONFLICT(fuel,observed_at,benchmark,source) DO UPDATE SET price=excluded.price,ingested_at=excluded.ingested_at`,
      rows,
    );
  }
  return count;
}

export interface WeeklyObservation {
  fuel: FuelType;
  /** Monday the prices were in force. */
  date: string;
  priceEurL: number;
}

/** Upserts weekly pump prices; the bulletin revises recent weeks, so existing rows update. */
export async function upsertWeekly(
  db: D1Database,
  observations: WeeklyObservation[],
  sourceRef: string = OIL_BULLETIN_URL,
) {
  return upsertJson(
    db,
    `INSERT INTO weekly_prices (fuel,observed_on,price_eur_l,source,source_ref,ingested_at)
     SELECT json_extract(value,'$.fuel'), json_extract(value,'$.date'), json_extract(value,'$.priceEurL'), 'eu_oil_bulletin', json_extract(value,'$.sourceRef'), ?2
     FROM json_each(?1) WHERE true
     ON CONFLICT(fuel,observed_on,source) DO UPDATE SET price_eur_l=excluded.price_eur_l,source_ref=excluded.source_ref,ingested_at=excluded.ingested_at`,
    observations.map((observation) => ({ ...observation, sourceRef })),
  );
}

/**
 * Finnish pump prices from the bulletin's latest-week sheet: a date row, then one row per
 * country with EUR per 1000 L for Euro-super 95 (column B) and automotive diesel (column C).
 * A week missed here (the cron runs every weekday) is filled by the history backfill.
 */
export async function parseLatestOilBulletin(xlsx: Uint8Array<ArrayBuffer>) {
  const rows = await readSheet(xlsx);
  const header = rows.find((row) => row.A === "in EUR");
  if (
    !/Euro-super 95/.test(header?.B ?? "") ||
    !/Gas oil automobile/.test(header?.C ?? "")
  )
    throw new Error("unexpected Weekly Oil Bulletin layout");
  const serial = Number(rows[rows.indexOf(header!) + 1]?.A);
  const finland = rows.find((row) => row.A === "Finland");
  if (!Number.isFinite(serial) || !finland)
    throw new Error("Weekly Oil Bulletin date or Finland row missing");
  const date = excelDate(serial);
  const observations: WeeklyObservation[] = [];
  for (const [fuel, column] of [
    ["95E10", "B"],
    ["DIESEL", "C"],
  ] as const) {
    const priceEurL = Number(finland[column]) / 1000;
    if (priceEurL > 0) observations.push({ fuel, date, priceEurL });
  }
  return observations;
}

/** Fetches the bulletin's latest week for Finland; parsing takes a couple of ms of CPU. */
export async function syncOilBulletin(
  db: D1Database,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(OIL_BULLETIN_URL);
  if (!response.ok)
    throw new Error(`Weekly Oil Bulletin returned ${response.status}`);
  return upsertWeekly(
    db,
    await parseLatestOilBulletin(new Uint8Array(await response.arrayBuffer())),
  );
}

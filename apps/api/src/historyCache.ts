import type { D1Database } from "./db";
import { MODEL_VERSION } from "./model/load";
import { reconstructHistory } from "./model/reconstruction";
import type { FuelType } from "./model/types";

type Reconstruction = Awaited<ReturnType<typeof reconstructHistory>>;
export type CachedHistory = Pick<
  Reconstruction,
  "monthly" | "daily" | "backtest"
> & {
  computedAt: string;
};

/** Re-runs the reconstruction and backtest for one fuel and stores the result. */
export async function refreshHistory(db: D1Database, fuel: FuelType) {
  const { monthly, daily, backtest } = await reconstructHistory(db, fuel);
  const history: CachedHistory = {
    monthly,
    daily,
    backtest,
    computedAt: new Date().toISOString(),
  };
  await db
    .prepare(
      `INSERT INTO history_cache (fuel,computed_at,model_version,payload) VALUES (?,?,?,?)
       ON CONFLICT(fuel) DO UPDATE SET computed_at=excluded.computed_at,model_version=excluded.model_version,payload=excluded.payload`,
    )
    .bind(fuel, history.computedAt, MODEL_VERSION, JSON.stringify(history))
    .run();
  return history;
}

/**
 * Reads the stored reconstruction, computing it on a miss or after a model-version change.
 * It is refreshed after every calculation, so it is at most one calculation behind.
 */
export async function cachedHistory(db: D1Database, fuel: FuelType) {
  const row = await db
    .prepare("SELECT payload, model_version FROM history_cache WHERE fuel=?")
    .bind(fuel)
    .first<{ payload: string; model_version: string }>();
  if (row?.model_version === MODEL_VERSION)
    return JSON.parse(row.payload) as CachedHistory;
  return refreshHistory(db, fuel);
}

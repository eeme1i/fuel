import type { D1Database } from "./db";
import { cachedHistory } from "./historyCache";
import type { FuelType } from "./model/types";

/**
 * Out-of-sample monthly backtest: each official month is predicted from the previous
 * month's official price with β fitted only on earlier months. The naive baseline assumes
 * no change since the previous month.
 */
export async function backtest(db: D1Database, fuel: FuelType) {
  const { backtest } = await cachedHistory(db, fuel);
  if (!backtest)
    throw new Error("not enough official and benchmark history to backtest");
  return backtest;
}

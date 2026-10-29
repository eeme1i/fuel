import type { D1Database } from "../db";
import { modelInputs } from "../repository";
import {
  BenchmarkSeries,
  selectBenchmark,
  toBenchmarkPoints,
} from "./benchmark";
import { calibrate } from "./calibration";
import type { FuelType } from "./types";
import { WeeklySeries } from "./weekly";

export const MODEL_VERSION = "2.1.0";

/** Loads one fuel's inputs as known on `today`, picks a single benchmark and calibrates β. */
export async function loadModel(db: D1Database, fuel: FuelType, today: string) {
  const { official, markets, fx, taxes, weekly } = await modelInputs(
    db,
    fuel,
    today,
  );
  const benchmark = selectBenchmark(markets);
  if (!benchmark || !official.length) return null;
  const rows = markets.filter((row) => row.benchmark === benchmark);
  const series = new BenchmarkSeries(toBenchmarkPoints(rows, fx));
  const weeklySeries = new WeeklySeries(weekly);
  return {
    benchmark,
    rows,
    fx,
    official,
    taxes,
    series,
    weekly: weeklySeries,
    calibration: calibrate(fuel, official, series, taxes, weeklySeries),
  };
}

-- Reconstructed history and backtest per fuel, recomputed after each calculation so public
-- history requests read one row instead of re-running the model.
CREATE TABLE history_cache (
  fuel TEXT PRIMARY KEY CHECK (fuel IN ('95E10','DIESEL')),
  computed_at TEXT NOT NULL,
  model_version TEXT NOT NULL,
  payload TEXT NOT NULL
);

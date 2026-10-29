CREATE TABLE official_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fuel TEXT NOT NULL CHECK (fuel IN ('95E10','DIESEL')),
  observation_date TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  price_eur_l REAL NOT NULL CHECK (price_eur_l > 0),
  source TEXT NOT NULL,
  source_ref TEXT,
  ingested_at TEXT NOT NULL,
  UNIQUE(fuel, observation_date, source)
);

CREATE TABLE market_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fuel TEXT NOT NULL CHECK (fuel IN ('95E10','DIESEL')),
  observed_at TEXT NOT NULL,
  price REAL NOT NULL CHECK (price > 0),
  currency TEXT NOT NULL CHECK (currency IN ('EUR','USD')),
  unit TEXT NOT NULL CHECK (unit IN ('litre','us_gallon','barrel','metric_tonne')),
  density_kg_l REAL,
  benchmark TEXT NOT NULL,
  benchmark_quality TEXT NOT NULL CHECK (benchmark_quality IN ('preferred','proxy')),
  source TEXT NOT NULL,
  source_ref TEXT,
  ingested_at TEXT NOT NULL,
  UNIQUE(fuel, observed_at, benchmark, source)
);

CREATE TABLE fx_observations (
  observed_on TEXT PRIMARY KEY,
  pair TEXT NOT NULL CHECK (pair = 'EURUSD'),
  rate REAL NOT NULL CHECK (rate > 0),
  source TEXT NOT NULL,
  ingested_at TEXT NOT NULL
);

CREATE TABLE tax_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fuel TEXT NOT NULL CHECK (fuel IN ('95E10','DIESEL')),
  effective_from TEXT NOT NULL,
  energy_tax_eur_l REAL NOT NULL DEFAULT 0,
  co2_tax_eur_l REAL NOT NULL DEFAULT 0,
  strategic_stock_fee_eur_l REAL NOT NULL DEFAULT 0,
  other_tax_eur_l REAL NOT NULL DEFAULT 0,
  vat_rate REAL NOT NULL,
  source TEXT NOT NULL,
  source_ref TEXT,
  ingested_at TEXT NOT NULL,
  UNIQUE(fuel, effective_from)
);

CREATE TABLE estimate_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fuel TEXT NOT NULL CHECK (fuel IN ('95E10','DIESEL')),
  calculated_at TEXT NOT NULL,
  model_version TEXT NOT NULL,
  estimated_price_eur_l REAL NOT NULL,
  change_eur_l REAL NOT NULL,
  market_effect_eur_l REAL NOT NULL,
  product_effect_eur_l REAL,
  currency_effect_eur_l REAL,
  tax_effect_eur_l REAL NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  anchor_id INTEGER NOT NULL REFERENCES official_prices(id),
  input_snapshot TEXT NOT NULL,
  UNIQUE(fuel, calculated_at, model_version)
);

CREATE INDEX idx_official_fuel_date ON official_prices(fuel, observation_date DESC);
CREATE INDEX idx_market_fuel_date ON market_observations(fuel, observed_at DESC);
CREATE INDEX idx_tax_fuel_date ON tax_observations(fuel, effective_from DESC);
CREATE INDEX idx_estimate_fuel_date ON estimate_snapshots(fuel, calculated_at DESC);

CREATE TABLE model_versions (
  version TEXT PRIMARY KEY,
  effective_from TEXT NOT NULL,
  description TEXT NOT NULL,
  configuration TEXT NOT NULL
);
INSERT INTO model_versions VALUES ('1.0.0','2026-09-21','Official anchor; refined benchmark; EUR conversion; 14-day rolling mean; beta 1.0; dated tax adjustment','{"smoothingDays":14,"beta":1.0}');

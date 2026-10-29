-- Weekly national pump prices (EU Weekly Oil Bulletin): prices in force on each Monday,
-- VAT and duties included. The model carries the official monthly anchor forward with them.
CREATE TABLE weekly_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fuel TEXT NOT NULL CHECK (fuel IN ('95E10','DIESEL')),
  observed_on TEXT NOT NULL,
  price_eur_l REAL NOT NULL CHECK (price_eur_l > 0),
  source TEXT NOT NULL,
  source_ref TEXT,
  ingested_at TEXT NOT NULL,
  UNIQUE(fuel, observed_on, source)
);
CREATE INDEX idx_weekly_fuel_date ON weekly_prices(fuel, observed_on DESC);

INSERT INTO model_versions (version,effective_from,description,configuration) VALUES (
  '2.1.0',
  '2026-10-02',
  'Official anchor carried forward by the change in Finnish weekly pump prices (EU Weekly Oil Bulletin, published Thursdays for Monday; mean of the latest two weeks) relative to the anchor minus the official-minus-weekly gap averaged over six months; benchmark pass-through only after the latest published week; reconstruction assumes official months are public five days after month-end; falls back to 2.0.0 without weekly data',
  '{"lagDays":5,"windowDays":21,"beta":"fitted","weeklySource":"eu_oil_bulletin","weeklyPublicationLagDays":3,"weeklyWindow":2,"gapMonths":6,"officialPublicationLagDays":5,"weeklyGamma":1}'
);

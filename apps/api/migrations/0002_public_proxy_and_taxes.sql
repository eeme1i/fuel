ALTER TABLE estimate_snapshots ADD COLUMN anchor_age_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE estimate_snapshots ADD COLUMN market_data_age_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE estimate_snapshots ADD COLUMN benchmark TEXT;
ALTER TABLE estimate_snapshots ADD COLUMN benchmark_quality TEXT CHECK (benchmark_quality IN ('preferred','proxy'));

UPDATE model_versions SET description='Official anchor; EIA finished-product proxy; EUR conversion; 14-day rolling mean; beta 1.0; dated tax adjustment', configuration='{"smoothingDays":14,"beta":1.0,"benchmarkQuality":"proxy"}' WHERE version='1.0.0';

-- Official Finnish Tax Administration representative/refund levels, converted from c/L to EUR/L.
-- These are deliberately dated; only changes after an anchor affect an estimate.
INSERT INTO tax_observations (fuel,effective_from,energy_tax_eur_l,co2_tax_eur_l,strategic_stock_fee_eur_l,other_tax_eur_l,vat_rate,source,source_ref,ingested_at) VALUES
('95E10','2023-01-01',0.5202,0.1956,0.0068,0,0.24,'Finnish Tax Administration','https://vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-liquid-fuels/Refund-levels-for-gasoline/','2026-09-21T00:00:00Z'),
('95E10','2024-01-01',0.5199,0.1589,0.0068,0,0.24,'Finnish Tax Administration','https://vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-liquid-fuels/Refund-levels-for-gasoline/','2026-09-21T00:00:00Z'),
('95E10','2024-07-01',0.5199,0.1592,0.0068,0,0.24,'Finnish Tax Administration','https://vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-liquid-fuels/Refund-levels-for-gasoline/','2026-09-21T00:00:00Z'),
('95E10','2024-09-01',0.5199,0.1592,0.0068,0,0.255,'Finnish Tax Administration','https://vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-liquid-fuels/Refund-levels-for-gasoline/','2026-09-21T00:00:00Z'),
('95E10','2025-01-01',0.5199,0.1591,0.0068,0,0.255,'Finnish Tax Administration','https://vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-liquid-fuels/Refund-levels-for-gasoline/','2026-09-21T00:00:00Z'),
('95E10','2025-07-01',0.5200,0.1602,0.0068,0,0.255,'Finnish Tax Administration','https://vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-liquid-fuels/Refund-levels-for-gasoline/','2026-09-21T00:00:00Z'),
('95E10','2026-01-01',0.5199,0.1445,0.0060,0,0.255,'Finnish Tax Administration','https://vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-liquid-fuels/Refund-levels-for-gasoline/','2026-09-21T00:00:00Z'),
('DIESEL','2023-01-01',0.3324,0.1902,0.0035,0,0.24,'Finnish Tax Administration','https://vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-liquid-fuels/Refund-levels-for-gasoline/','2026-09-21T00:00:00Z'),
('DIESEL','2024-01-01',0.3325,0.1651,0.0035,0,0.24,'Finnish Tax Administration','https://vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-liquid-fuels/Refund-levels-for-gasoline/','2026-09-21T00:00:00Z'),
('DIESEL','2024-07-01',0.3319,0.1659,0.0035,0,0.24,'Finnish Tax Administration','https://vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-liquid-fuels/Refund-levels-for-gasoline/','2026-09-21T00:00:00Z'),
('DIESEL','2024-09-01',0.3319,0.1659,0.0035,0,0.255,'Finnish Tax Administration','https://vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-liquid-fuels/Refund-levels-for-gasoline/','2026-09-21T00:00:00Z'),
('DIESEL','2025-01-01',0.3313,0.1609,0.0035,0,0.255,'Finnish Tax Administration','https://vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-liquid-fuels/Refund-levels-for-gasoline/','2026-09-21T00:00:00Z'),
('DIESEL','2025-07-01',0.3329,0.1495,0.0035,0,0.255,'Finnish Tax Administration','https://vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-liquid-fuels/Refund-levels-for-gasoline/','2026-09-21T00:00:00Z'),
('DIESEL','2026-01-01',0.3344,0.1358,0.0047,0,0.255,'Finnish Tax Administration','https://vero.fi/en/businesses-and-corporations/taxes-and-charges/excise-taxation/excise-duty-on-liquid-fuels/Refund-levels-for-gasoline/','2026-09-21T00:00:00Z');

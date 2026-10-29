INSERT INTO model_versions (version,effective_from,description,configuration) VALUES (
  '1.0.1',
  '2026-09-21',
  'Proxy benchmark caps confidence at medium instead of applying an additional penalty; EIA publication freshness window increased from 3 to 7 calendar days',
  '{"smoothingDays":14,"beta":1.0,"benchmarkQuality":"proxy","proxyConfidenceCap":"medium","marketFreshnessDays":7}'
);

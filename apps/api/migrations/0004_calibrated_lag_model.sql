INSERT INTO model_versions (version,effective_from,description,configuration) VALUES (
  '2.0.0',
  '2026-09-22',
  'Single benchmark series lagged 5 days and smoothed over 21 days; beta fitted per fuel on all complete official months; 80% range and confidence from out-of-sample monthly errors',
  '{"lagDays":5,"windowDays":21,"beta":"fitted","betaBounds":[0,1.5],"minTrainMonths":24,"rangeCoverage":0.8}'
);

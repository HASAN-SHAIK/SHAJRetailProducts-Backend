WITH feature_keys AS (
  SELECT DISTINCT jsonb_object_keys(features) AS key
  FROM plans
  UNION
  SELECT DISTINCT jsonb_object_keys(config) AS key
  FROM shop_types
),
feature_catalog AS (
  SELECT COALESCE(jsonb_object_agg(key, false), '{}'::jsonb) AS defaults
  FROM feature_keys
)
UPDATE plans
SET features = feature_catalog.defaults || features
FROM feature_catalog;

WITH feature_keys AS (
  SELECT DISTINCT jsonb_object_keys(features) AS key
  FROM plans
  UNION
  SELECT DISTINCT jsonb_object_keys(config) AS key
  FROM shop_types
),
feature_catalog AS (
  SELECT COALESCE(jsonb_object_agg(key, false), '{}'::jsonb) AS defaults
  FROM feature_keys
)
UPDATE shop_types
SET config = feature_catalog.defaults || config
FROM feature_catalog;

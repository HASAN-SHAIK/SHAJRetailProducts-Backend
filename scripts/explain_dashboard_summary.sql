-- Usage (psql):
-- \set start '2026-01-01'
-- \set end '2026-12-31'
-- \set location NULL

EXPLAIN (ANALYZE, BUFFERS)
SELECT
  COALESCE(SUM(total_revenue), 0)::numeric AS total_revenue,
  COALESCE(SUM(total_profit), 0)::numeric AS total_profit,
  COALESCE(SUM(total_orders), 0)::int AS total_orders
FROM tenant_dashboard_metrics
WHERE day BETWEEN :'start' AND :'end'
  AND (:'location'::text IS NULL OR location = :'location');

EXPLAIN (ANALYZE, BUFFERS)
SELECT day AS date,
       COALESCE(SUM(total_revenue), 0)::numeric AS revenue
FROM tenant_dashboard_metrics
WHERE day BETWEEN :'start' AND :'end'
  AND (:'location'::text IS NULL OR location = :'location')
GROUP BY day
ORDER BY day ASC;

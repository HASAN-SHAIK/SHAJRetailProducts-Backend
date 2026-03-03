-- Usage (psql):
-- \set start '2026-01-01'
-- \set end '2026-12-31'
-- \set limit 20
-- \set offset 0
-- \set search NULL
-- \set sort created_at
-- \set order DESC
--
-- EXPLAIN (ANALYZE, BUFFERS) below matches the optimized order listing query.

EXPLAIN (ANALYZE, BUFFERS)
WITH base AS (
  SELECT o.id,
         o.total_price AS total_amount,
         o.created_at,
         o.order_status,
         o.payment_mode,
         o.customer_id,
         COALESCE(o.product_count, 0)::int AS product_count,
         COALESCE(o.product_summary, '') AS product_names,
         COALESCE(o.total_paid, 0)::numeric AS total_paid
  FROM orders o
  LEFT JOIN customers c ON c.id = o.customer_id
  WHERE o.created_at BETWEEN :'start' AND :'end'
    AND (
      :'search'::text IS NULL
      OR o.id::text ILIKE ('%' || :'search' || '%')
      OR c.name ILIKE ('%' || :'search' || '%')
      OR o.product_summary ILIKE ('%' || :'search' || '%')
    )
  ORDER BY
    CASE WHEN :'sort' = 'created_at' THEN o.created_at END :'order',
    CASE WHEN :'sort' = 'total_amount' THEN o.total_price END :'order',
    CASE WHEN :'sort' = 'total_paid' THEN COALESCE(o.total_paid, 0)::numeric END :'order',
    CASE WHEN :'sort' = 'balance' THEN (o.total_price - COALESCE(o.total_paid, 0)::numeric) END :'order',
    o.created_at DESC
  LIMIT :'limit' OFFSET :'offset'
)
SELECT b.id,
       b.total_amount,
       b.created_at,
       b.order_status,
       b.payment_mode,
       c.name AS customer_name,
       b.product_count,
       b.product_names,
       b.total_paid
FROM base b
LEFT JOIN customers c ON c.id = b.customer_id
ORDER BY
  CASE WHEN :'sort' = 'created_at' THEN b.created_at END :'order',
  CASE WHEN :'sort' = 'total_amount' THEN b.total_amount END :'order',
  CASE WHEN :'sort' = 'total_paid' THEN COALESCE(b.total_paid, 0)::numeric END :'order',
  CASE WHEN :'sort' = 'balance' THEN (b.total_amount - COALESCE(b.total_paid, 0)::numeric) END :'order',
  b.created_at DESC;

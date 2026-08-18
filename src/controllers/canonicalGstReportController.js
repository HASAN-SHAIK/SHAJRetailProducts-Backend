const pool = require('../db');
const { jsonError } = require('../utils/responses');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_GST_REPORT_RANGE_DAYS = 366;
const MAX_GST_REPORT_DAYS = 366;

const getRequestPool = (req) => req.tenantPool || pool;

const parseUtcDate = (value) => {
  if (!DATE_RE.test(String(value || ''))) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
};

const resolveRange = (req, res) => {
  const query = req.query || {};
  const hasFrom = query.from !== undefined && query.from !== null && query.from !== '';
  const hasTo = query.to !== undefined && query.to !== null && query.to !== '';

  if (!hasFrom && !hasTo) return { from: null, toExclusive: null };
  if (!hasFrom || !hasTo) {
    jsonError(res, 400, 'GST_REPORT_DATE_RANGE_REQUIRED', 'from and to must be supplied together as YYYY-MM-DD.');
    return null;
  }

  const from = parseUtcDate(query.from);
  const to = parseUtcDate(query.to);
  if (!from || !to || to < from) {
    jsonError(res, 400, 'GST_REPORT_DATE_RANGE_INVALID', 'GST report dates must be valid ordered YYYY-MM-DD values.');
    return null;
  }

  const rangeDays = Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1;
  if (rangeDays > MAX_GST_REPORT_RANGE_DAYS) {
    jsonError(
      res,
      400,
      'GST_REPORT_DATE_RANGE_TOO_LARGE',
      `GST report date range cannot exceed ${MAX_GST_REPORT_RANGE_DAYS} days.`
    );
    return null;
  }

  return { from, toExclusive: new Date(to.getTime() + DAY_MS) };
};

const CANONICAL_GST_REPORT_SQL = `
WITH original_lines AS (
  SELECT o.id AS order_id,
         o.branch_id,
         o.completed_at,
         o.source_returned_at,
         oi.source_item_id,
         oi.quantity_milli,
         COALESCE(oi.taxable_minor, 0)::bigint AS taxable_minor,
         COALESCE(oi.tax_minor, 0)::bigint AS tax_minor
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
   WHERE o.source_channel = 'pos'
     AND o.completed_at IS NOT NULL
     AND oi.quantity_milli IS NOT NULL
     AND oi.quantity_milli > 0
     AND ($1::uuid IS NULL OR o.branch_id = $1)
),
order_totals AS (
  SELECT order_id,
         branch_id,
         completed_at,
         source_returned_at,
         SUM(taxable_minor)::bigint AS taxable_minor,
         SUM(tax_minor)::bigint AS tax_minor
    FROM original_lines
   GROUP BY order_id, branch_id, completed_at, source_returned_at
),
partial_line_windows AS (
  SELECT pr.return_id,
         pr.order_id,
         COALESCE(pr.source_returned_at, pr.created_at) AS event_at,
         pr.source_version,
         pri.source_item_id,
         pri.quantity_milli AS returned_quantity_milli,
         ol.quantity_milli AS sold_quantity_milli,
         ol.taxable_minor AS original_taxable_minor,
         ol.tax_minor AS original_tax_minor,
         COALESCE(
           SUM(pri.quantity_milli) OVER (
             PARTITION BY pr.order_id, pri.source_item_id
             ORDER BY pr.source_version, COALESCE(pr.source_returned_at, pr.created_at), pr.return_id
             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
           ),
           0
         )::bigint AS prior_returned_quantity_milli
    FROM pos_partial_returns pr
    JOIN pos_partial_return_items pri ON pri.return_id = pr.return_id
    JOIN original_lines ol
      ON ol.order_id = pr.order_id
     AND ol.source_item_id = pri.source_item_id
),
partial_credits AS (
  SELECT return_id,
         order_id,
         event_at,
         SUM(
           ROUND(
             original_taxable_minor::numeric *
             LEAST(sold_quantity_milli, prior_returned_quantity_milli + returned_quantity_milli)::numeric /
             NULLIF(sold_quantity_milli, 0)
           ) -
           ROUND(
             original_taxable_minor::numeric *
             prior_returned_quantity_milli::numeric /
             NULLIF(sold_quantity_milli, 0)
           )
         )::bigint AS taxable_credit_minor,
         SUM(
           ROUND(
             original_tax_minor::numeric *
             LEAST(sold_quantity_milli, prior_returned_quantity_milli + returned_quantity_milli)::numeric /
             NULLIF(sold_quantity_milli, 0)
           ) -
           ROUND(
             original_tax_minor::numeric *
             prior_returned_quantity_milli::numeric /
             NULLIF(sold_quantity_milli, 0)
           )
         )::bigint AS tax_credit_minor
    FROM partial_line_windows
   GROUP BY return_id, order_id, event_at
),
partial_totals AS (
  SELECT order_id,
         COALESCE(SUM(taxable_credit_minor), 0)::bigint AS taxable_credit_minor,
         COALESCE(SUM(tax_credit_minor), 0)::bigint AS tax_credit_minor
    FROM partial_credits
   GROUP BY order_id
),
events AS (
  SELECT completed_at AS event_at,
         taxable_minor,
         tax_minor
    FROM order_totals
  UNION ALL
  SELECT event_at,
         -taxable_credit_minor,
         -tax_credit_minor
    FROM partial_credits
  UNION ALL
  SELECT ot.source_returned_at AS event_at,
         -GREATEST(0::bigint, ot.taxable_minor - COALESCE(pt.taxable_credit_minor, 0)) AS taxable_minor,
         -GREATEST(0::bigint, ot.tax_minor - COALESCE(pt.tax_credit_minor, 0)) AS tax_minor
    FROM order_totals ot
    LEFT JOIN partial_totals pt ON pt.order_id = ot.order_id
   WHERE ot.source_returned_at IS NOT NULL
)
SELECT TO_CHAR((event_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS date,
       (SUM(taxable_minor)::numeric / 100.0) AS taxable_amount,
       (SUM(tax_minor)::numeric / 100.0) AS total_gst
  FROM events
 WHERE event_at IS NOT NULL
   AND ($2::timestamptz IS NULL OR event_at >= $2)
   AND ($3::timestamptz IS NULL OR event_at < $3)
 GROUP BY (event_at AT TIME ZONE 'UTC')::date
 ORDER BY (event_at AT TIME ZONE 'UTC')::date DESC
 LIMIT ${MAX_GST_REPORT_DAYS}`;

const getCanonicalGstReports = async (req, res) => {
  const range = resolveRange(req, res);
  if (!range) return undefined;

  try {
    const requestPool = getRequestPool(req);
    const branchId = req.reportBranchId || null;
    const result = await requestPool.query(CANONICAL_GST_REPORT_SQL, [branchId, range.from, range.toExclusive]);
    return res.status(200).json({
      success: true,
      authority: 'canonical_pos_tax_snapshots',
      component_breakdown_available: false,
      reports: result.rows.map((row) => ({
        date: row.date,
        taxable_amount: Number(row.taxable_amount || 0),
        total_gst: Number(row.total_gst || 0),
      })),
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

module.exports = {
  CANONICAL_GST_REPORT_SQL,
  MAX_GST_REPORT_RANGE_DAYS,
  getCanonicalGstReports,
  parseUtcDate,
};

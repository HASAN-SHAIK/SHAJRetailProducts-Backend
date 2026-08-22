const { jsonError, jsonOk } = require('../../utils/responses');
const { getDateRange } = require('../../utils/dateRange');
const { normalizeBranchId } = require('../../utils/branch');

const formatLabel = (date, groupBy) => {
  if (groupBy === 'hour') {
    return date.toISOString().slice(0, 13) + ':00';
  }
  return date.toISOString().slice(0, 10);
};

const buildBuckets = (start, end, groupBy) => {
  const buckets = [];
  const cursor = new Date(start);
  const stepHours = groupBy === 'hour' ? 1 : 24;
  while (cursor <= end) {
    buckets.push(new Date(cursor));
    cursor.setUTCHours(cursor.getUTCHours() + stepHours);
  }
  return buckets;
};

const getSalesTrend = async (req, res) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Missing tenant_id');
    }

    const {
      range,
      start_date: startDateRaw,
      end_date: endDateRaw,
      location,
      branch_id: branchIdRaw,
      group_by: groupByRaw
    } = req.query || {};
    const { start, end, range: resolvedRange } = getDateRange(range, startDateRaw, endDateRaw);
    const branchId = normalizeBranchId(branchIdRaw);
    const groupBy = resolvedRange === 'today' ? 'hour' : 'day';

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid date range');
    }

    const period = groupBy === 'hour' ? 'hour' : 'day';

    if (groupByRaw === 'location') {
      const result = await req.tenantPool.query(
        `SELECT o.location AS location,
                DATE_TRUNC($3, o.created_at) AS period,
                COALESCE(SUM(o.total_price - COALESCE(o.returned_amount, 0)), 0)::numeric AS revenue,
                COUNT(*)::int AS order_count
         FROM orders o
         WHERE o.created_at BETWEEN $1 AND $2
           AND o.location IS NOT NULL
           AND o.transaction_type = 'sale'
           AND o.order_status IN ('completed', 'partially_returned', 'fully_returned')
           AND ($4::text IS NULL OR o.location = $4)
           AND ($5::uuid IS NULL OR o.branch_id = $5)
         GROUP BY o.location, period
         ORDER BY o.location ASC, period ASC`,
        [start, end, period, location || null, branchId]
      );

      const buckets = buildBuckets(start, end, groupBy);
      const byLocation = new Map();
      for (const row of result.rows) {
        const label = formatLabel(new Date(row.period), groupBy);
        if (!byLocation.has(row.location)) {
          byLocation.set(row.location, new Map());
        }
        byLocation.get(row.location).set(label, {
          revenue: Number(row.revenue || 0),
          order_count: Number(row.order_count || 0)
        });
      }

      const groupedTrends = Array.from(byLocation.entries()).map(([loc, revenueMap]) => ({
        location: loc,
        data: buckets.map((bucket) => {
          const label = formatLabel(bucket, groupBy);
          const point = revenueMap.get(label) || {};
          return { label, revenue: point.revenue || 0, order_count: point.order_count || 0 };
        })
      }));

      return jsonOk(res, {
        range: resolvedRange,
        group_by: 'location',
        series: groupedTrends
      });
    }

    const result = location
      ? await req.tenantPool.query(
          `SELECT DATE_TRUNC($3, o.created_at) AS period,
                  COALESCE(SUM(o.total_price - COALESCE(o.returned_amount, 0)), 0)::numeric AS revenue,
                  COUNT(*)::int AS order_count
           FROM orders o
           WHERE o.created_at BETWEEN $1 AND $2
             AND o.transaction_type = 'sale'
             AND o.order_status IN ('completed', 'partially_returned', 'fully_returned')
             AND o.location = $4
             AND ($5::uuid IS NULL OR o.branch_id = $5)
           GROUP BY period
           ORDER BY period ASC`,
          [start, end, period, location, branchId]
        )
      : await req.tenantPool.query(
          `SELECT DATE_TRUNC($3, created_at) AS period,
                  COALESCE(SUM(total_price - COALESCE(returned_amount, 0)), 0)::numeric AS revenue,
                  COUNT(*)::int AS order_count
           FROM orders
           WHERE created_at BETWEEN $1 AND $2
             AND transaction_type = 'sale'
             AND order_status IN ('completed', 'partially_returned', 'fully_returned')
             AND ($4::uuid IS NULL OR branch_id = $4)
           GROUP BY period
           ORDER BY period ASC`,
          [start, end, period, branchId]
        );

    const revenueMap = new Map();
    for (const row of result.rows) {
      const label = formatLabel(new Date(row.period), groupBy);
      revenueMap.set(label, {
        revenue: Number(row.revenue || 0),
        order_count: Number(row.order_count || 0)
      });
    }

    const buckets = buildBuckets(start, end, groupBy);
    const data = buckets.map((bucket) => {
      const label = formatLabel(bucket, groupBy);
      return {
        label,
        revenue: revenueMap.get(label)?.revenue ?? 0,
        order_count: revenueMap.get(label)?.order_count ?? 0
      };
    });

    return jsonOk(res, {
      range: resolvedRange,
      group_by: groupBy,
      data
    });
  } catch (error) {
    if (error.message === 'INVALID_DATE_RANGE') {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid date range');
    }
    return jsonError(res, 500, 'SALES_TREND_FAILED', 'Failed to load sales trend');
  }
};

module.exports = { getSalesTrend };

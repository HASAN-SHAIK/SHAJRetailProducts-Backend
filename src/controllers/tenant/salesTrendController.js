const { jsonError, jsonOk } = require('../../utils/responses');
const { getDateRange } = require('../../utils/dateRange');

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
      group_by: groupByRaw
    } = req.query || {};
    const { start, end, range: resolvedRange } = getDateRange(range, startDateRaw, endDateRaw);
    const groupBy = resolvedRange === 'today' ? 'hour' : 'day';

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid date range');
    }

    const period = groupBy === 'hour' ? 'hour' : 'day';

    if (groupByRaw === 'location') {
      const result = await req.tenantPool.query(
        `SELECT o.location AS location,
                DATE_TRUNC($3, t.created_at) AS period,
                COALESCE(SUM(t.total_price), 0)::numeric AS revenue
         FROM transactions t
         JOIN orders o ON o.id = t.order_id
         WHERE t.created_at BETWEEN $1 AND $2
           AND o.location IS NOT NULL
           AND o.transaction_type = 'sale'
           AND ($4::text IS NULL OR o.location = $4)
         GROUP BY o.location, period
         ORDER BY o.location ASC, period ASC`,
        [start, end, period, location || null]
      );

      const buckets = buildBuckets(start, end, groupBy);
      const byLocation = new Map();
      for (const row of result.rows) {
        const label = formatLabel(new Date(row.period), groupBy);
        if (!byLocation.has(row.location)) {
          byLocation.set(row.location, new Map());
        }
        byLocation.get(row.location).set(label, Number(row.revenue || 0));
      }

      const groupedTrends = Array.from(byLocation.entries()).map(([loc, revenueMap]) => ({
        location: loc,
        data: buckets.map((bucket) => {
          const label = formatLabel(bucket, groupBy);
          return { label, revenue: revenueMap.get(label) ?? 0 };
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
          `SELECT DATE_TRUNC($3, t.created_at) AS period,
                  COALESCE(SUM(t.total_price), 0)::numeric AS revenue
           FROM transactions t
           JOIN orders o ON o.id = t.order_id
           WHERE t.created_at BETWEEN $1 AND $2
             AND o.transaction_type = 'sale'
             AND o.location = $4
           GROUP BY period
           ORDER BY period ASC`,
          [start, end, period, location]
        )
      : await req.tenantPool.query(
          `SELECT DATE_TRUNC($3, created_at) AS period,
                  COALESCE(SUM(total_price), 0)::numeric AS revenue
           FROM transactions
           WHERE created_at BETWEEN $1 AND $2
           GROUP BY period
           ORDER BY period ASC`,
          [start, end, period]
        );

    const revenueMap = new Map();
    for (const row of result.rows) {
      const label = formatLabel(new Date(row.period), groupBy);
      revenueMap.set(label, Number(row.revenue || 0));
    }

    const buckets = buildBuckets(start, end, groupBy);
    const data = buckets.map((bucket) => {
      const label = formatLabel(bucket, groupBy);
      return {
        label,
        revenue: revenueMap.get(label) ?? 0
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

const { jsonError, jsonOk } = require('../../utils/responses');
const { getGrowthComparison: getGrowthComparisonService } = require('../../services/dashboardMetrics');

const getGrowthComparison = async (req, res) => {
  try {
    const { range, start_date: startDateRaw, end_date: endDateRaw, location, group_by } = req.query || {};
    const data = await getGrowthComparisonService(
      req.tenantPool,
      range,
      startDateRaw,
      endDateRaw,
      location,
      group_by
    );
    if (group_by === 'location') {
      return jsonOk(res, { grouped: data.grouped || [] });
    }
    if (data?.growth && data.growth.order_growth_percent !== undefined) {
      data.growth.orders_growth_percent = data.growth.order_growth_percent;
    }
    return jsonOk(res, {
      current_period: {
        start_date: data.current_period.start_date.toISOString(),
        end_date: data.current_period.end_date.toISOString(),
        revenue: data.current_period.revenue,
        profit: data.current_period.profit,
        orders: data.current_period.orders
      },
      previous_period: {
        start_date: data.previous_period.start_date.toISOString(),
        end_date: data.previous_period.end_date.toISOString(),
        revenue: data.previous_period.revenue,
        profit: data.previous_period.profit,
        orders: data.previous_period.orders
      },
      growth: data.growth
    });
  } catch (error) {
    if (error.message === 'INVALID_DATE_RANGE') {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid date range');
    }
    return jsonError(res, 500, 'GROWTH_COMPARISON_FAILED', 'Failed to load growth comparison');
  }
};

module.exports = { getGrowthComparison };

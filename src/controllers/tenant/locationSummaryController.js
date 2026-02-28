const { jsonError, jsonOk } = require('../../utils/responses');
const { getLocationSummary } = require('../../services/dashboardMetrics');

const getLocationSummaryController = async (req, res) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Missing tenant_id');
    }

    const { range, start_date: startDateRaw, end_date: endDateRaw, location } = req.query || {};
    const locations = await getLocationSummary(
      req.tenantPool,
      range,
      startDateRaw,
      endDateRaw,
      location
    );

    const mapped = (locations || []).map((row) => ({
      city: row.location,
      revenue: row.total_revenue,
      orders: row.total_orders,
      growth_percent: row.growth_percentage,
      location: row.location,
      total_revenue: row.total_revenue,
      total_profit: row.total_profit,
      total_orders: row.total_orders,
      growth_percentage: row.growth_percentage
    }));

    return jsonOk(res, { locations: mapped, data: mapped });
  } catch (error) {
    if (error.message === 'INVALID_DATE_RANGE') {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid date range');
    }
    return jsonError(res, 500, 'LOCATION_SUMMARY_FAILED', 'Failed to load location summary');
  }
};

module.exports = { getLocationSummaryController };

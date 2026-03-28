const { jsonError, jsonOk } = require('../../utils/responses');
const { getRevenueOverview: getRevenueOverviewService } = require('../../services/dashboardMetrics');

const getRevenueOverview = async (req, res) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Missing tenant_id');
    }

    const { range, start_date: startDateRaw, end_date: endDateRaw, location, branch_id } = req.query || {};
    const data = await getRevenueOverviewService(
      req.tenantPool,
      range,
      startDateRaw,
      endDateRaw,
      location,
      branch_id
    );
    return jsonOk(res, {
      range: data.range,
      date_range: {
        start_date: data.start.toISOString(),
        end_date: data.end.toISOString()
      },
      revenue_overview: data.revenue_overview
    });
  } catch (error) {
    if (error.message === 'INVALID_DATE_RANGE') {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid date range');
    }
    return jsonError(res, 500, 'REVENUE_OVERVIEW_FAILED', 'Failed to load revenue overview');
  }
};

module.exports = { getRevenueOverview };

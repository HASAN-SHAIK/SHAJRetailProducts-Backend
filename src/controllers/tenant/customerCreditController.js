const { jsonError, jsonOk } = require('../../utils/responses');
const { getCustomerCredit: getCustomerCreditService } = require('../../services/dashboardMetrics');

const getCustomerCredit = async (req, res) => {
  try {
    const { range, start_date: startDateRaw, end_date: endDateRaw, location, group_by } = req.query || {};
    const data = await getCustomerCreditService(
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
    return jsonOk(res, data);
  } catch (error) {
    if (error.message === 'INVALID_DATE_RANGE') {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid date range');
    }
    return jsonError(res, 500, 'CUSTOMER_CREDIT_FAILED', 'Failed to load customer credit');
  }
};

module.exports = { getCustomerCredit };

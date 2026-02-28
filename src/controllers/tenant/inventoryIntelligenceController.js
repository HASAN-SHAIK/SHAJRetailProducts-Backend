const { jsonError, jsonOk } = require('../../utils/responses');
const { getInventoryIntelligence: getInventoryIntelligenceService } = require('../../services/dashboardMetrics');

const getInventoryIntelligence = async (req, res) => {
  try {
    const {
      range,
      start_date: startDateRaw,
      end_date: endDateRaw,
      dead_stock_days: deadStockDaysRaw,
      location,
      group_by
    } = req.query || {};
    const data = await getInventoryIntelligenceService(
      req.tenantPool,
      range,
      startDateRaw,
      endDateRaw,
      deadStockDaysRaw,
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
    return jsonError(res, 500, 'INVENTORY_INTELLIGENCE_FAILED', 'Failed to load inventory intelligence');
  }
};

module.exports = { getInventoryIntelligence };

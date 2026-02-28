const { jsonError, jsonOk } = require('../../utils/responses');
const {
  getRevenueOverview,
  getGrowthComparison,
  getInventoryIntelligence,
  getCustomerCredit,
  getLocationSummary
} = require('../../services/dashboardMetrics');

const formatCurrency = (value) => {
  const amount = Math.round(Number(value || 0));
  return `₹${amount.toLocaleString('en-IN')}`;
};

const getSmartInsights = async (req, res) => {
  try {
    const {
      range,
      start_date: startDateRaw,
      end_date: endDateRaw,
      dead_stock_days: deadStockDaysRaw,
      location,
      group_by
    } = req.query || {};
    const tenantPool = req.tenantPool;

    if (group_by === 'location') {
      const [growthData, inventoryData, creditData, locationSummary] = await Promise.all([
        getGrowthComparison(tenantPool, range, startDateRaw, endDateRaw, location, 'location'),
        getInventoryIntelligence(tenantPool, range, startDateRaw, endDateRaw, deadStockDaysRaw, location, 'location'),
        getCustomerCredit(tenantPool, range, startDateRaw, endDateRaw, location, 'location'),
        getLocationSummary(tenantPool, range, startDateRaw, endDateRaw, location)
      ]);

      const inventoryMap = new Map(
        (inventoryData.grouped || []).map((row) => [row.location, row])
      );
      const creditMap = new Map(
        (creditData.grouped || []).map((row) => [row.location, row])
      );
      const growthMap = new Map(
        (growthData.grouped || []).map((row) => [row.location, row])
      );
      const summaryMap = new Map(
        (locationSummary || []).map((row) => [row.location, row])
      );

      const locations = new Set([
        ...Array.from(inventoryMap.keys()),
        ...Array.from(creditMap.keys()),
        ...Array.from(growthMap.keys()),
        ...Array.from(summaryMap.keys())
      ]);

      const groupedInsights = Array.from(locations).map((loc) => {
        const growth = growthMap.get(loc);
        const inventory = inventoryMap.get(loc);
        const credit = creditMap.get(loc);
        const summary = summaryMap.get(loc);

        const insights = [];

        const revenueGrowth = growth?.growth?.revenue_growth_percent ?? 0;
        if (revenueGrowth > 10) {
          insights.push({
            type: 'growth',
            severity: 'positive',
            message: `Revenue increased by ${revenueGrowth}% compared to the previous period.`
          });
        } else if (revenueGrowth < -10) {
          insights.push({
            type: 'growth',
            severity: 'warning',
            message: `Revenue decreased by ${Math.abs(revenueGrowth)}% compared to the previous period.`
          });
        }

        const deadStockValue = inventory?.inventory_summary?.dead_stock_value || 0;
        if (deadStockValue > 0) {
          insights.push({
            type: 'dead_stock',
            severity: 'warning',
            message: `${formatCurrency(deadStockValue)} is locked in dead stock.`
          });
        }

        const overdueAmount = credit?.credit_summary?.overdue_amount || 0;
        if (overdueAmount > 0) {
          insights.push({
            type: 'credit',
            severity: 'danger',
            message: `${formatCurrency(overdueAmount)} overdue credit needs attention.`
          });
        }

        const fastMovingTop = inventory?.fast_moving?.[0];
        if (fastMovingTop?.product_name) {
          insights.push({
            type: 'fast_moving',
            severity: 'info',
            message: `${fastMovingTop.product_name} is your fastest selling product.`
          });
        }

        const totalProfit = summary?.total_profit || 0;
        if (totalProfit > 0) {
          insights.push({
            type: 'profit',
            severity: 'positive',
            message: `You earned ${formatCurrency(totalProfit)} profit in this period.`
          });
        }

        if (insights.length === 0) {
          insights.push({
            type: 'info',
            severity: 'info',
            message: 'No significant insights for this period yet.'
          });
        }

        return { location: loc, insights: insights.slice(0, 8) };
      });

      return jsonOk(res, { grouped_insights: groupedInsights });
    }

    const [revenueData, growthData, inventoryData, creditData] = await Promise.all([
      getRevenueOverview(tenantPool, range, startDateRaw, endDateRaw, location),
      getGrowthComparison(tenantPool, range, startDateRaw, endDateRaw, location),
      getInventoryIntelligence(tenantPool, range, startDateRaw, endDateRaw, deadStockDaysRaw, location),
      getCustomerCredit(tenantPool, range, startDateRaw, endDateRaw, location)
    ]);

    const insights = [];

    const revenueGrowth = growthData.growth.revenue_growth_percent;
    if (revenueGrowth > 10) {
      insights.push({
        type: 'growth',
        severity: 'positive',
        message: `Revenue increased by ${revenueGrowth}% compared to the previous period.`
      });
    } else if (revenueGrowth < -10) {
      insights.push({
        type: 'growth',
        severity: 'warning',
        message: `Revenue decreased by ${Math.abs(revenueGrowth)}% compared to the previous period.`
      });
    }

    const deadStockValue = inventoryData.inventory_summary.dead_stock_value || 0;
    if (deadStockValue > 0) {
      insights.push({
        type: 'dead_stock',
        severity: 'warning',
        message: `${formatCurrency(deadStockValue)} is locked in dead stock.`
      });
    }

    const overdueAmount = creditData.credit_summary.overdue_amount || 0;
    if (overdueAmount > 0) {
      insights.push({
        type: 'credit',
        severity: 'danger',
        message: `${formatCurrency(overdueAmount)} overdue credit needs attention.`
      });
    }

    const fastMovingTop = inventoryData.fast_moving?.[0];
    if (fastMovingTop?.product_name) {
      insights.push({
        type: 'fast_moving',
        severity: 'info',
        message: `${fastMovingTop.product_name} is your fastest selling product.`
      });
    }

    const totalProfit = revenueData.revenue_overview.total_profit || 0;
    if (totalProfit > 0) {
      insights.push({
        type: 'profit',
        severity: 'positive',
        message: `You earned ${formatCurrency(totalProfit)} profit in this period.`
      });
    }

    if (insights.length === 0) {
      insights.push({
        type: 'info',
        severity: 'info',
        message: 'No significant insights for this period yet.'
      });
    }

    return jsonOk(res, { insights: insights.slice(0, 8) });
  } catch (error) {
    if (error.message === 'INVALID_DATE_RANGE') {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid date range');
    }
    return jsonError(res, 500, 'SMART_INSIGHTS_FAILED', 'Failed to load smart insights');
  }
};

module.exports = { getSmartInsights };

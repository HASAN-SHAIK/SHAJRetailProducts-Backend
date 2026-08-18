const enforceDashboardReportScope = (req, res, next) => {
  const branchId = req.reportBranchId || null;

  // requireReportScope has already resolved caller input against Central user authority.
  // Rewrite the legacy dashboard query input so the controller cannot widen the scope.
  req.query = { ...(req.query || {}) };
  if (branchId) {
    req.query.branch_id = branchId;
  } else {
    delete req.query.branch_id;
  }

  // The dashboard's low/dead-stock widgets still read the legacy product stock
  // projection. Until Reporting owns certified branch inventory semantics, keep
  // those fields unavailable rather than presenting them as branch truth.
  if (branchId && typeof res.json === 'function') {
    const sendJson = res.json.bind(res);
    res.json = (body) => {
      if (!body?.success || !body?.data?.inventory_intelligence) {
        return sendJson(body);
      }

      const data = body.data;
      const inventory = data.inventory_intelligence;
      return sendJson({
        ...body,
        data: {
          ...data,
          inventory_intelligence: {
            ...inventory,
            low_stock: null,
            dead_stock: null,
            inventory_scope: 'branch_inventory_unavailable',
          },
          smart_insights: Array.isArray(data.smart_insights)
            ? data.smart_insights.filter((item) => item?.type !== 'inventory')
            : data.smart_insights,
        },
      });
    };
  }

  return next();
};

module.exports = { enforceDashboardReportScope };

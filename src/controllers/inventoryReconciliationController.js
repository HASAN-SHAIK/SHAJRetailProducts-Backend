const { resolveTenantContext } = require('../config/tenantDbResolver');
const { listInventoryReconciliation } = require('../services/inventoryReconciliationService');
const { jsonError, jsonOk } = require('../utils/responses');

const getInventoryReconciliationAdmin = async (req, res) => {
  const tenantId = Number.parseInt(req.query?.tenant_id, 10);
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
    return jsonError(res, 400, 'VALIDATION_ERROR', 'tenant_id is required');
  }

  try {
    const context = await resolveTenantContext(tenantId);
    if (!context?.tenantPool) {
      return jsonError(res, 404, 'NOT_FOUND', 'Tenant not found');
    }

    const rows = await listInventoryReconciliation(context.tenantPool, {
      movementId: req.query?.movement_id,
      branchId: req.query?.branch_id,
      productId: req.query?.product_id,
      limit: req.query?.limit,
    });

    return jsonOk(res, {
      tenant_id: tenantId,
      reconciliation: rows,
      read_only: true,
    });
  } catch (error) {
    if (error?.code === '22P02') {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid branch_id');
    }
    return jsonError(res, 500, 'INVENTORY_RECONCILIATION_FETCH_FAILED', error.message);
  }
};

module.exports = { getInventoryReconciliationAdmin };

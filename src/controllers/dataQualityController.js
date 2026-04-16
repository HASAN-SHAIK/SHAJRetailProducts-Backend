const { jsonError, jsonOk } = require('../utils/responses');
const {
  listStockAuditLogs,
  getCustomerDuplicateSuggestions,
  getProductDuplicateSuggestions,
  mergeCustomers,
  mergeProducts,
  exportFullBackup,
  verifyBackupPayload
} = require('../services/dataQualityService');
const {
  runConsistencyCheckForRequest,
  getLatestConsistencyRun
} = require('../services/stockConsistencyService');

const getRequestPool = (req) => req.tenantPool;

const getStockAuditTrail = async (req, res) => {
  try {
    const logs = await listStockAuditLogs(getRequestPool(req), req.query || {});
    return jsonOk(res, { logs });
  } catch (error) {
    return jsonError(res, 500, 'STOCK_AUDIT_FETCH_FAILED', error.message || 'Failed to load stock audit logs');
  }
};

const runStockConsistency = async (req, res) => {
  try {
    const autoHeal = req.body?.auto_heal !== false;
    const result = await runConsistencyCheckForRequest(req, {
      autoHeal,
      source: 'manual',
      runBy: req?.user?.id ? String(req.user.id) : null
    });
    return jsonOk(res, result, 'Stock consistency run completed');
  } catch (error) {
    return jsonError(res, 500, 'STOCK_CONSISTENCY_FAILED', error.message || 'Failed to run stock consistency');
  }
};

const getLatestStockConsistency = async (req, res) => {
  try {
    const run = await getLatestConsistencyRun(req);
    return jsonOk(res, { run });
  } catch (error) {
    return jsonError(res, 500, 'STOCK_CONSISTENCY_FETCH_FAILED', error.message || 'Failed to load consistency report');
  }
};

const getDuplicateSuggestions = async (req, res) => {
  try {
    const entity = String(req.query?.entity || '').toLowerCase();
    const limit = Number(req.query?.limit || 50);
    if (entity === 'customer') {
      const suggestions = await getCustomerDuplicateSuggestions(getRequestPool(req), limit);
      return jsonOk(res, { entity, suggestions });
    }
    if (entity === 'product') {
      const suggestions = await getProductDuplicateSuggestions(getRequestPool(req), limit);
      return jsonOk(res, { entity, suggestions });
    }
    return jsonError(res, 400, 'VALIDATION_ERROR', 'entity must be customer or product');
  } catch (error) {
    return jsonError(res, 500, 'DEDUPE_SUGGESTIONS_FAILED', error.message || 'Failed to fetch suggestions');
  }
};

const mergeDuplicate = async (req, res) => {
  try {
    const entity = String(req.body?.entity || '').toLowerCase();
    const actor = { user_id: req?.user?.id || null, role: req?.user?.role || null };
    if (entity === 'customer') {
      const result = await mergeCustomers(getRequestPool(req), req.body || {}, actor);
      return jsonOk(res, { entity, result }, 'Customer records merged');
    }
    if (entity === 'product') {
      const result = await mergeProducts(getRequestPool(req), req.body || {}, actor);
      return jsonOk(res, { entity, result }, 'Product records merged');
    }
    return jsonError(res, 400, 'VALIDATION_ERROR', 'entity must be customer or product');
  } catch (error) {
    const status = error.status || 500;
    return jsonError(res, status, 'DEDUPE_MERGE_FAILED', error.message || 'Merge failed');
  }
};

const exportBackup = async (req, res) => {
  try {
    const backup = await exportFullBackup(getRequestPool(req));
    return jsonOk(res, { backup });
  } catch (error) {
    return jsonError(res, 500, 'BACKUP_EXPORT_FAILED', error.message || 'Failed to export backup');
  }
};

const verifyBackup = async (req, res) => {
  try {
    const payload = req.body?.backup || req.body || {};
    const verification = verifyBackupPayload(payload);
    return jsonOk(res, { verification });
  } catch (error) {
    return jsonError(res, 500, 'BACKUP_VERIFY_FAILED', error.message || 'Failed to verify backup');
  }
};

module.exports = {
  getStockAuditTrail,
  runStockConsistency,
  getLatestStockConsistency,
  getDuplicateSuggestions,
  mergeDuplicate,
  exportBackup,
  verifyBackup
};

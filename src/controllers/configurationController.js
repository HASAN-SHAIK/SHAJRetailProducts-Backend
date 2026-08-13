const configurationService = require('../configuration/service');
const { jsonError, jsonOk } = require('../utils/responses');

const sendError = (res, error) => jsonError(
  res,
  error?.status || 500,
  error?.code || 'CONFIGURATION_FAILED',
  error?.message || 'Configuration request failed'
);

const getCatalog = async (_req, res) => {
  try {
    return jsonOk(res, configurationService.getCatalog());
  } catch (error) {
    return sendError(res, error);
  }
};

const getEffective = async (req, res) => {
  try {
    const result = await configurationService.resolveEffectiveConfiguration(req, {
      branchId: req.query?.branch_id,
      deviceId: req.query?.device_id,
    });
    res.set('ETag', `"${result.etag}"`);
    const candidate = String(req.get('If-None-Match') || '').replace(/^W\//, '').replaceAll('"', '');
    if (candidate && candidate === result.etag) return res.status(304).end();
    return jsonOk(res, result);
  } catch (error) {
    return sendError(res, error);
  }
};

const getScope = async (req, res) => {
  try {
    return jsonOk(
      res,
      await configurationService.readScopeConfiguration(req, req.params.scopeType, req.params.scopeId)
    );
  } catch (error) {
    return sendError(res, error);
  }
};

const updateScope = async (req, res) => {
  try {
    return jsonOk(
      res,
      await configurationService.updateScopeConfiguration(
        req,
        req.params.scopeType,
        req.params.scopeId,
        req.body?.values || req.body || {}
      ),
      'Configuration updated'
    );
  } catch (error) {
    return sendError(res, error);
  }
};

const resetScopeValue = async (req, res) => {
  try {
    return jsonOk(
      res,
      await configurationService.resetScopeValue(
        req,
        req.params.scopeType,
        req.params.scopeId,
        req.params.settingKey
      ),
      'Configuration override reset'
    );
  } catch (error) {
    return sendError(res, error);
  }
};

const getAudit = async (req, res) => {
  try {
    return jsonOk(
      res,
      await configurationService.getAuditHistory(
        req,
        req.params.scopeType,
        req.params.scopeId,
        req.query?.limit
      )
    );
  } catch (error) {
    return sendError(res, error);
  }
};

module.exports = { getCatalog, getEffective, getScope, updateScope, resetScopeValue, getAudit };

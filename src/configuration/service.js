const crypto = require('crypto');
const masterPool = require('../db/masterPool');
const { CATALOG, CATALOG_BY_KEY, publicCatalog } = require('./catalog');
const { ensureConfigurationSchema } = require('./schema');
const { buildNestedConfig, mergeLayers, validateSettingValue, errorWithStatus } = require('./validation');
const { readLegacyTenantValues, readScopeLayer, readAudit } = require('./readRepository');
const { upsertLegacySetting, writeGenericOverride, removeGenericOverride } = require('./writeRepository');
const { getRequestPool, getTenantScopeId, resolveBranch, resolveDevice, resolveTarget } = require('./targets');

const actorId = (req) => String(req?.user?.user_id || req?.user?.id || req?.posDeviceId || 'system');
const stableHash = (payload) => crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

const resolveEffectiveConfiguration = async (req, options = {}) => {
  const requestPool = getRequestPool(req);
  await ensureConfigurationSchema(requestPool);
  const tenantId = getTenantScopeId(req);

  let branchId = options.branchId ? await resolveBranch(requestPool, options.branchId) : null;
  let device = null;
  if (options.deviceId) {
    device = await resolveDevice(requestPool, options.deviceId, {
      requireActive: options.requireRegisteredDevice === true,
    });
    if (!device && options.requireRegisteredDevice === true) {
      throw errorWithStatus(403, 'POS_DEVICE_NOT_REGISTERED', 'POS device is not actively registered');
    }
    if (device) {
      if (branchId && device.branchId && branchId !== device.branchId) {
        throw errorWithStatus(400, 'DEVICE_BRANCH_MISMATCH', 'Device does not belong to the requested branch');
      }
      branchId = branchId || device.branchId;
    }
  }

  const systemValues = Object.fromEntries(CATALOG.map((entry) => [entry.key, entry.default]));
  const systemRevisions = Object.fromEntries(CATALOG.map((entry) => [entry.key, 0]));
  const legacyValues = await readLegacyTenantValues(req, requestPool);
  const tenantOverrides = await readScopeLayer(requestPool, 'tenant', tenantId);
  const branchOverrides = await readScopeLayer(requestPool, 'branch', branchId);
  const deviceOverrides = await readScopeLayer(requestPool, 'device', device?.deviceId || null);

  const { values, sources } = mergeLayers([
    { scopeType: 'system', scopeId: 'default', values: systemValues, revisions: systemRevisions },
    { scopeType: 'tenant', scopeId: tenantId, values: legacyValues, revisions: {} },
    tenantOverrides,
    branchOverrides,
    deviceOverrides,
  ]);

  const etag = stableHash({
    tenantId,
    branchId,
    deviceId: device?.deviceId || options.deviceId || null,
    values,
  });

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    etag,
    scope: {
      tenant_id: tenantId,
      branch_id: branchId,
      device_id: device?.deviceId || options.deviceId || null,
      device_registered: device ? device.active : null,
    },
    values,
    config: buildNestedConfig(values),
    sources,
  };
};

const getCatalog = () => ({ schema_version: 1, settings: publicCatalog() });

const readScopeConfiguration = async (req, scopeTypeInput, scopeIdInput) => {
  const requestPool = getRequestPool(req);
  await ensureConfigurationSchema(requestPool);
  const target = await resolveTarget(req, scopeTypeInput, scopeIdInput);
  const layer = await readScopeLayer(requestPool, target.scopeType, target.scopeId);
  const effective = await resolveEffectiveConfiguration(req, {
    branchId: target.branchId,
    deviceId: target.deviceId,
  });
  return {
    scope: target,
    overrides: layer.values,
    revisions: layer.revisions,
    effective,
  };
};

const updateTenantGstMode = async (req, value) => {
  const tenantId = req?.tenant?.id || req?.tenant_id;
  if (!tenantId) throw errorWithStatus(500, 'TENANT_ID_MISSING', 'Tenant id is unavailable');
  try {
    await masterPool.query(`UPDATE tenants SET gst_mode = $2 WHERE id = $1`, [tenantId, value]);
    if (req.tenant) req.tenant.gst_mode = value;
  } catch (error) {
    if (error?.code === '42703') return;
    throw error;
  }
};

const updateScopeConfiguration = async (req, scopeTypeInput, scopeIdInput, rawValues = {}) => {
  const requestPool = getRequestPool(req);
  await ensureConfigurationSchema(requestPool);
  const target = await resolveTarget(req, scopeTypeInput, scopeIdInput);
  if (!rawValues || typeof rawValues !== 'object' || Array.isArray(rawValues)) {
    throw errorWithStatus(400, 'INVALID_CONFIG_PAYLOAD', 'values must be an object');
  }

  const changedBy = actorId(req);
  const revisions = {};
  for (const [key, rawValue] of Object.entries(rawValues)) {
    const meta = CATALOG_BY_KEY.get(key);
    if (!meta) throw errorWithStatus(400, 'UNKNOWN_CONFIG_KEY', `Unknown configuration key: ${key}`);
    if (!meta.scopes.includes(target.scopeType)) {
      throw errorWithStatus(400, 'CONFIG_SCOPE_NOT_ALLOWED', `${key} cannot be configured at ${target.scopeType} scope`);
    }
    const value = validateSettingValue(key, rawValue);

    if (target.scopeType === 'tenant' && meta.legacy) {
      await upsertLegacySetting(requestPool, meta, value);
      revisions[key] = 'legacy';
      continue;
    }
    if (target.scopeType === 'tenant' && key === 'tax.gst_mode') {
      await updateTenantGstMode(req, value);
      revisions[key] = 'legacy';
      continue;
    }
    revisions[key] = await writeGenericOverride(requestPool, target, key, value, changedBy);
  }

  return {
    ...(await readScopeConfiguration(req, target.scopeType, target.scopeId)),
    updated_revisions: revisions,
  };
};

const resetScopeValue = async (req, scopeTypeInput, scopeIdInput, key) => {
  const requestPool = getRequestPool(req);
  await ensureConfigurationSchema(requestPool);
  const target = await resolveTarget(req, scopeTypeInput, scopeIdInput);
  const meta = CATALOG_BY_KEY.get(key);
  if (!meta) throw errorWithStatus(404, 'UNKNOWN_CONFIG_KEY', `Unknown configuration key: ${key}`);
  if (target.scopeType === 'tenant' && (meta.legacy || key === 'tax.gst_mode')) {
    throw errorWithStatus(
      409,
      'LEGACY_CONFIG_RESET_UNSUPPORTED',
      'Legacy-backed tenant values must be changed explicitly rather than reset'
    );
  }
  await removeGenericOverride(requestPool, target, key, actorId(req));
  return readScopeConfiguration(req, target.scopeType, target.scopeId);
};

const getAuditHistory = async (req, scopeTypeInput, scopeIdInput, limitInput) => {
  const requestPool = getRequestPool(req);
  await ensureConfigurationSchema(requestPool);
  const target = await resolveTarget(req, scopeTypeInput, scopeIdInput);
  return { scope: target, audit: await readAudit(requestPool, target, limitInput) };
};

module.exports = {
  getCatalog,
  resolveEffectiveConfiguration,
  readScopeConfiguration,
  updateScopeConfiguration,
  resetScopeValue,
  getAuditHistory,
};

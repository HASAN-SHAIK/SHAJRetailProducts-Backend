const { CATALOG, CATALOG_BY_KEY } = require('./catalog');
const { validateSettingValue } = require('./validation');

const readLegacyTenantValues = async (req, requestPool) => {
  const result = await requestPool.query(
    `SELECT setting_key, value_json
     FROM app_settings
     WHERE setting_key = ANY($1::text[])`,
    [['store_settings', 'tax_settings', 'printer_settings', 'theme_settings']]
  );
  const groups = Object.fromEntries(result.rows.map((row) => [row.setting_key, row.value_json || {}]));
  const values = {};

  for (const meta of CATALOG) {
    if (meta.key === 'tax.gst_mode') {
      values[meta.key] = String(req?.tenant?.gst_mode || meta.default).toUpperCase();
      continue;
    }
    if (!meta.legacy) continue;
    const raw = groups[meta.legacy.group]?.[meta.legacy.field];
    if (raw === undefined || raw === null || raw === '') continue;
    try {
      values[meta.key] = validateSettingValue(meta.key, raw);
    } catch {
      values[meta.key] = meta.default;
    }
  }
  return values;
};

const readScopeLayer = async (requestPool, scopeType, scopeId) => {
  if (!scopeId) return { scopeType, scopeId: null, values: {}, revisions: {} };
  const result = await requestPool.query(
    `SELECT setting_key, value_json, revision
     FROM effective_config_values
     WHERE scope_type = $1 AND scope_id = $2`,
    [scopeType, String(scopeId)]
  );
  const values = {};
  const revisions = {};
  for (const row of result.rows) {
    if (!CATALOG_BY_KEY.has(row.setting_key)) continue;
    values[row.setting_key] = row.value_json;
    revisions[row.setting_key] = Number(row.revision);
  }
  return { scopeType, scopeId: String(scopeId), values, revisions };
};

const readAudit = async (requestPool, target, limitInput = 100) => {
  const limit = Math.min(Math.max(Number(limitInput) || 100, 1), 500);
  const result = await requestPool.query(
    `SELECT id, scope_type, scope_id, setting_key, old_value_json, new_value_json,
            revision, changed_by, changed_at
     FROM effective_config_audit
     WHERE scope_type = $1 AND scope_id = $2
     ORDER BY changed_at DESC, id DESC
     LIMIT $3`,
    [target.scopeType, target.scopeId, limit]
  );
  return result.rows;
};

module.exports = { readLegacyTenantValues, readScopeLayer, readAudit };

const upsertLegacySetting = async (requestPool, meta, value) => {
  const existing = await requestPool.query(
    `SELECT value_json FROM app_settings WHERE setting_key = $1 LIMIT 1`,
    [meta.legacy.group]
  );
  const current = existing.rows[0]?.value_json && typeof existing.rows[0].value_json === 'object'
    ? existing.rows[0].value_json
    : {};
  const merged = { ...current, [meta.legacy.field]: value };
  await requestPool.query(
    `INSERT INTO app_settings(setting_key, value_json, updated_at)
     VALUES($1, $2::jsonb, NOW())
     ON CONFLICT(setting_key) DO UPDATE
     SET value_json = EXCLUDED.value_json, updated_at = NOW()`,
    [meta.legacy.group, JSON.stringify(merged)]
  );
};

const writeGenericOverride = async (requestPool, target, key, value, changedBy) => {
  const previous = await requestPool.query(
    `SELECT value_json, revision FROM effective_config_values
     WHERE scope_type = $1 AND scope_id = $2 AND setting_key = $3`,
    [target.scopeType, target.scopeId, key]
  );
  const oldValue = previous.rows[0]?.value_json;
  const result = await requestPool.query(
    `INSERT INTO effective_config_values(scope_type, scope_id, setting_key, value_json, revision, updated_by)
     VALUES($1, $2, $3, $4::jsonb, 1, $5)
     ON CONFLICT(scope_type, scope_id, setting_key) DO UPDATE
     SET value_json = EXCLUDED.value_json,
         revision = effective_config_values.revision + 1,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
     RETURNING revision`,
    [target.scopeType, target.scopeId, key, JSON.stringify(value), changedBy]
  );
  const revision = Number(result.rows[0]?.revision || 1);
  await requestPool.query(
    `INSERT INTO effective_config_audit(
       scope_type, scope_id, setting_key, old_value_json, new_value_json, revision, changed_by
     ) VALUES($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
    [target.scopeType, target.scopeId, key, oldValue === undefined ? null : JSON.stringify(oldValue), JSON.stringify(value), revision, changedBy]
  );
  return revision;
};

const removeGenericOverride = async (requestPool, target, key, changedBy) => {
  const previous = await requestPool.query(
    `DELETE FROM effective_config_values
     WHERE scope_type = $1 AND scope_id = $2 AND setting_key = $3
     RETURNING value_json, revision`,
    [target.scopeType, target.scopeId, key]
  );
  if (!previous.rowCount) return false;
  await requestPool.query(
    `INSERT INTO effective_config_audit(
       scope_type, scope_id, setting_key, old_value_json, new_value_json, revision, changed_by
     ) VALUES($1, $2, $3, $4::jsonb, NULL, $5, $6)`,
    [target.scopeType, target.scopeId, key, JSON.stringify(previous.rows[0].value_json), Number(previous.rows[0].revision) + 1, changedBy]
  );
  return true;
};

module.exports = { upsertLegacySetting, writeGenericOverride, removeGenericOverride };

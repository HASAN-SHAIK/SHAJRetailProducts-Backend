const ensureConfigurationSchema = async (requestPool) => {
  await requestPool.query(`CREATE TABLE IF NOT EXISTS effective_config_values (
    id BIGSERIAL PRIMARY KEY,
    scope_type VARCHAR(16) NOT NULL CHECK (scope_type IN ('tenant','branch','device')),
    scope_id TEXT NOT NULL,
    setting_key VARCHAR(160) NOT NULL,
    value_json JSONB NOT NULL,
    revision BIGINT NOT NULL DEFAULT 1,
    updated_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(scope_type, scope_id, setting_key)
  )`);

  await requestPool.query(`CREATE INDEX IF NOT EXISTS idx_effective_config_scope
    ON effective_config_values(scope_type, scope_id)`);

  await requestPool.query(`CREATE TABLE IF NOT EXISTS effective_config_audit (
    id BIGSERIAL PRIMARY KEY,
    scope_type VARCHAR(16) NOT NULL,
    scope_id TEXT NOT NULL,
    setting_key VARCHAR(160) NOT NULL,
    old_value_json JSONB,
    new_value_json JSONB,
    revision BIGINT NOT NULL,
    changed_by TEXT,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  await requestPool.query(`CREATE INDEX IF NOT EXISTS idx_effective_config_audit_scope
    ON effective_config_audit(scope_type, scope_id, changed_at DESC)`);

  await requestPool.query(`CREATE TABLE IF NOT EXISTS app_settings (
    id SERIAL PRIMARY KEY,
    setting_key VARCHAR(100) NOT NULL UNIQUE,
    value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC')
  )`);
};

module.exports = { ensureConfigurationSchema };

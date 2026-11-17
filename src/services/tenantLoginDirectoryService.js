const masterPool = require('../db/masterPool');
const { getTenantByDomain, getTenantById } = require('./tenantService');

let directorySchemaReadyPromise = null;

const ensureTenantLoginDirectorySchema = async () => {
  if (!directorySchemaReadyPromise) {
    directorySchemaReadyPromise = (async () => {
      await masterPool.query(`
        CREATE TABLE IF NOT EXISTS tenant_login_directory (
          id SERIAL PRIMARY KEY,
          tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          email VARCHAR(255) NOT NULL,
          mobile VARCHAR(20),
          company_code VARCHAR(255) NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'UTC'),
          UNIQUE (tenant_id, email)
        )
      `);
      await masterPool.query(
        `CREATE INDEX IF NOT EXISTS idx_tenant_login_directory_email
         ON tenant_login_directory (LOWER(email))`
      );
      await masterPool.query(
        `CREATE INDEX IF NOT EXISTS idx_tenant_login_directory_company_code
         ON tenant_login_directory (LOWER(company_code))`
      );
    })().catch((error) => {
      directorySchemaReadyPromise = null;
      throw error;
    });
  }
  return directorySchemaReadyPromise;
};

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizeCompanyCode = (value) => String(value || '').trim().toLowerCase();

const registerTenantLoginEntry = async ({
  tenantId,
  email,
  mobile = null,
  companyCode,
  queryable = masterPool,
}) => {
  const normalizedEmail = normalizeEmail(email);
  const normalizedCode = normalizeCompanyCode(companyCode);
  if (!tenantId || !normalizedEmail || !normalizedCode) return null;

  if (queryable === masterPool) {
    await ensureTenantLoginDirectorySchema();
  }

  const res = await queryable.query(
    `INSERT INTO tenant_login_directory (tenant_id, email, mobile, company_code, is_active)
     VALUES ($1, $2, $3, $4, TRUE)
     ON CONFLICT (tenant_id, email)
     DO UPDATE SET
       mobile = COALESCE(EXCLUDED.mobile, tenant_login_directory.mobile),
       company_code = EXCLUDED.company_code,
       is_active = TRUE
     RETURNING id, tenant_id, email, company_code`,
    [tenantId, normalizedEmail, mobile ? String(mobile).trim() : null, normalizedCode]
  );
  return res.rows[0] || null;
};

const mapCandidateRow = (row) => ({
  id: row.id,
  shop_name: row.shop_name,
  owner_name: row.owner_name,
  email: row.email,
  mobile: row.mobile,
  domain: row.domain,
  company_code: row.domain,
  database_name: row.database_name,
  plan_type: row.plan_type,
  is_active: row.is_active,
  addons: row.addons,
  gst_mode: row.gst_mode,
});

const resolveTenantsForLogin = async ({ email, companyCode = null, tenantId = null } = {}) => {
  if (tenantId) {
    const tenant = await getTenantById(tenantId);
    return {
      tenant,
      ambiguous: false,
      candidates: tenant ? [tenant] : [],
    };
  }

  const normalizedCode = normalizeCompanyCode(companyCode);
  if (normalizedCode) {
    const tenant = await getTenantByDomain(normalizedCode);
    return {
      tenant,
      ambiguous: false,
      candidates: tenant ? [tenant] : [],
    };
  }

  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail) {
    try {
      await ensureTenantLoginDirectorySchema();
      const result = await masterPool.query(
        `SELECT t.id, t.shop_name, t.owner_name, t.email, t.mobile, t.domain, t.database_name,
                t.plan_type, t.is_active, t.addons, t.gst_mode
         FROM tenant_login_directory d
         INNER JOIN tenants t ON t.id = d.tenant_id
         WHERE LOWER(d.email) = LOWER($1)
           AND d.is_active = TRUE
         ORDER BY t.id ASC`,
        [normalizedEmail]
      );
      if (result.rowCount === 1) {
        const tenant = mapCandidateRow(result.rows[0]);
        return { tenant, ambiguous: false, candidates: [tenant] };
      }
      if (result.rowCount > 1) {
        const candidates = result.rows.map(mapCandidateRow);
        return { tenant: null, ambiguous: true, candidates };
      }
    } catch (error) {
      // Fall back to domain-based resolution when directory lookup is unavailable.
      console.warn('Tenant login directory lookup skipped:', error.message || error);
    }

    if (normalizedEmail.includes('@')) {
      const domain = normalizedEmail.split('@')[1].trim().toLowerCase();
      const cleanDomain = domain.replace(/\.com$/, '');
      if (cleanDomain) {
        const tenant = await getTenantByDomain(cleanDomain);
        return {
          tenant,
          ambiguous: false,
          candidates: tenant ? [tenant] : [],
        };
      }
    }
  }

  return { tenant: null, ambiguous: false, candidates: [] };
};

const resetDirectorySchemaCacheForTests = () => {
  directorySchemaReadyPromise = null;
};

module.exports = {
  ensureTenantLoginDirectorySchema,
  registerTenantLoginEntry,
  resolveTenantsForLogin,
  resetDirectorySchemaCacheForTests,
};

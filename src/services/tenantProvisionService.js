const fs = require('fs');
const path = require('path');
const masterPool = require('../db/masterPool');
const adminPool = require('../db/adminPool');
const { getTenantPool, closeTenantPool } = require('../db/tenantPool');

const quoteIdentifier = (value) => {
  const escaped = String(value).replace(/"/g, '""');
  return `"${escaped}"`;
};

// tenant_schema.sql is the canonical bootstrap baseline. These later V1
// migrations add certified structures that are intentionally not duplicated
// in that large baseline file. Keep this list explicit: replaying the entire
// historical migrations directory over a fresh schema would risk executing
// old, non-idempotent data migrations that the baseline has already absorbed.
const FRESH_TENANT_V1_OVERLAY_MIGRATIONS = Object.freeze([
  '2026-08-16-v1-auth-tenant-roles.sql',
  '2026-08-13-pos-inventory-canonical-application.sql',
  '2026-08-14-pos-inventory-batch-allocations.sql',
  '2026-08-14-pos-inventory-reconciliation-provenance.sql',
  '2026-08-15-pos-customer-canonical-mapping.sql',
  '2026-08-15-customer-outstanding-projection.sql',
  '2026-08-18-pos-sale-category-snapshots.sql',
]);

const runSqlFile = async (pool, filePath) => {
  const sql = fs.readFileSync(filePath, 'utf8');
  const client = await pool.connect();
  try {
    await client.query('SET search_path TO public');
    await client.query(sql);
  } finally {
    client.release();
  }
};

const getFreshTenantOverlayPaths = () =>
  FRESH_TENANT_V1_OVERLAY_MIGRATIONS.map((fileName) =>
    path.join(__dirname, '..', '..', 'Db', 'migrations', fileName)
  );

const provisionTenant = async (payload) => {
  const {
    shop_name,
    domain,
    plan_type,
    owner_name,
    email,
    mobile,
    gst_number,
    address_line,
    city,
    state,
    pincode,
    subscription_status = 'paid',
    subscription_end_date,
    subscription_amount = 0,
    gst_mode
  } = payload;

  const dbName = `shaj_tenant_${Date.now()}`;
  const dbIdentifier = quoteIdentifier(dbName);
  const tenantSchemaPath = path.join(__dirname, '..', '..', 'Db', 'tenant_schema.sql');
  const tenantOverlayPaths = getFreshTenantOverlayPaths();

  let tenantPool = null;
  let masterClient = null;
  let tenantId = null;
  let dbCreated = false;

  try {
    await adminPool.query(`CREATE DATABASE ${dbIdentifier}`);
    dbCreated = true;

    tenantPool = getTenantPool(dbName);
    await runSqlFile(tenantPool, tenantSchemaPath);
    for (const migrationPath of tenantOverlayPaths) {
      await runSqlFile(tenantPool, migrationPath);
    }

    masterClient = await masterPool.connect();
    await masterClient.query('BEGIN');

    const normalizedDomain = domain?.toString().trim().toLowerCase();
    const tenantRes = await masterClient.query(
      `INSERT INTO tenants (shop_name, owner_name, email, mobile, domain, database_name, plan_type, gst_mode, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
       RETURNING id, database_name`,
      [shop_name, owner_name, email, mobile, normalizedDomain, dbName, plan_type, gst_mode || 'INCLUSIVE']
    );
    tenantId = tenantRes.rows[0].id;

    const endDate =
      subscription_end_date ||
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await masterClient.query(
      `INSERT INTO subscriptions (tenant_id, start_date, end_date, amount, payment_status)
       VALUES ($1, CURRENT_DATE, $2, $3, $4)`,
      [tenantId, endDate, subscription_amount, subscription_status]
    );

    await tenantPool.query(
      `INSERT INTO shop_details (shop_name, owner_name, mobile_number, gst_number, address_line, city, state, pincode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        shop_name || null,
        owner_name || null,
        mobile || null,
        gst_number || null,
        address_line || null,
        city || null,
        state || null,
        pincode || null
      ]
    );

    await masterClient.query('COMMIT');
    return { tenant_id: tenantId, database_name: dbName };
  } catch (error) {
    if (masterClient) {
      try {
        await masterClient.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Tenant provision rollback failed:', rollbackError);
      }
    }
    if (dbCreated) {
      try {
        await closeTenantPool(dbName);
      } catch (closeError) {
        console.error('Failed to close tenant pool during rollback:', closeError);
      }
      try {
        await adminPool.query(`DROP DATABASE IF EXISTS ${dbIdentifier}`);
      } catch (dropError) {
        console.error('Failed to drop tenant database during rollback:', dropError);
      }
    }
    throw error;
  } finally {
    if (masterClient) {
      masterClient.release();
    }
  }
};

module.exports = {
  provisionTenant,
  FRESH_TENANT_V1_OVERLAY_MIGRATIONS,
  getFreshTenantOverlayPaths,
};

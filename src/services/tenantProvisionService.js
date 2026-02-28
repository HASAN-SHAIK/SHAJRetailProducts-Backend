const fs = require('fs');
const path = require('path');
const masterPool = require('../db/masterPool');
const adminPool = require('../db/adminPool');
const { getTenantPool } = require('../db/tenantPool');

const quoteIdentifier = (value) => {
  const escaped = String(value).replace(/"/g, '""');
  return `"${escaped}"`;
};

const runSqlFile = async (pool, filePath) => {
  const sql = fs.readFileSync(filePath, 'utf8');
  const statements = sql
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await pool.query(statement);
  }
};

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
    subscription_amount = 0
  } = payload;

  const dbName = `shaj_tenant_${Date.now()}`;
  const dbIdentifier = quoteIdentifier(dbName);
  await adminPool.query(`CREATE DATABASE ${dbIdentifier}`);

  const tenantPool = getTenantPool(dbName);
  const tenantSchemaPath = path.join(__dirname, '..', '..', 'Db', 'tenant_schema.sql');
  await runSqlFile(tenantPool, tenantSchemaPath);

  const client = await masterPool.connect();
  let tenantId = null;
  try {
    await client.query('BEGIN');
    const normalizedDomain = domain?.toString().trim().toLowerCase();
    const tenantRes = await client.query(
      `INSERT INTO tenants (shop_name, owner_name, email, mobile, domain, database_name, plan_type, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
       RETURNING id, database_name`,
      [shop_name, owner_name, email, mobile, normalizedDomain, dbName, plan_type]
    );
    tenantId = tenantRes.rows[0].id;

    const endDate =
      subscription_end_date ||
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await client.query(
      `INSERT INTO subscriptions (tenant_id, start_date, end_date, amount, payment_status)
       VALUES ($1, CURRENT_DATE, $2, $3, $4)`,
      [tenantId, endDate, subscription_amount, subscription_status]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

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

  return { tenant_id: tenantId, database_name: dbName };
};

module.exports = { provisionTenant };

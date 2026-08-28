require('dotenv').config();

const { Pool } = require('pg');

const DEFAULT_BRANCH_ID = '11111111-1111-4111-8111-111111111111';
const DEFAULT_DEVICE_ID = 'SINGLE-POS-DTN-01';

const storeNumber = String(process.env.STORE_NUMBER || process.argv[2] || 'STORE-001').trim().toUpperCase();
const posNo = String(process.env.POS_NO || process.env.POS_TERMINAL_ID || process.argv[3] || 'POS-01').trim().toUpperCase();
const touchpointId = String(process.env.TOUCHPOINT_ID || process.argv[4] || 'TP-01').trim().toUpperCase();
const branchId = String(process.env.STORE_BRANCH_ID || process.env.POS_STORE_ID || DEFAULT_BRANCH_ID).trim();
const deviceId = String(process.env.STORE_DEVICE_ID || process.env.POS_DEVICE_ID || DEFAULT_DEVICE_ID).trim();

const requireEnv = (name) => {
  if (!process.env[name]) throw new Error(`${name} is required.`);
  return process.env[name];
};

const main = async () => {
  if (!storeNumber || !posNo || !touchpointId || !branchId || !deviceId) {
    throw new Error('STORE_NUMBER, POS_NO, TOUCHPOINT_ID, STORE_BRANCH_ID and STORE_DEVICE_ID are required.');
  }

  const masterPool = new Pool({ connectionString: requireEnv('MASTER_DATABASE_URL') });
  let tenantDatabase;
  try {
    const tenantRes = await masterPool.query(
      `SELECT database_name
       FROM tenants
       WHERE database_name IS NOT NULL
       ORDER BY id ASC
       LIMIT 1`
    );
    tenantDatabase = tenantRes.rows[0]?.database_name;
  } finally {
    await masterPool.end();
  }

  if (!tenantDatabase) throw new Error('No tenant database found in Central.');

  const tenantUrl = requireEnv('TENANT_DATABASE_URL_TEMPLATE').replace('{db}', tenantDatabase);
  const tenantPool = new Pool({
    connectionString: tenantUrl,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  try {
    await tenantPool.query('BEGIN');
    await tenantPool.query(
      `UPDATE branches
       SET store_number = $1
       WHERE id::text = $2
         AND (store_number IS NULL OR BTRIM(store_number) = '')`,
      [storeNumber, branchId]
    );
    await tenantPool.query(
      `UPDATE branch_devices
       SET store_number = $1,
           pos_no = $2,
           touchpoint_id = $3
       WHERE branch_id::text = $4
         AND device_id = $5
         AND (
           store_number IS NULL OR BTRIM(store_number) = ''
           OR pos_no IS NULL OR BTRIM(pos_no) = ''
           OR touchpoint_id IS NULL OR BTRIM(touchpoint_id) = ''
         )`,
      [storeNumber, posNo, touchpointId, branchId, deviceId]
    );
    await tenantPool.query(
      `UPDATE pos_registration_requests
       SET store_number = $1,
           pos_no = $2,
           touchpoint_id = $3,
           terminal_id = $2
       WHERE branch_id = $4
         AND device_id = $5
         AND (
           store_number IS NULL OR BTRIM(store_number) = ''
           OR pos_no IS NULL OR BTRIM(pos_no) = ''
           OR touchpoint_id IS NULL OR BTRIM(touchpoint_id) = ''
         )`,
      [storeNumber, posNo, touchpointId, branchId, deviceId]
    );
    await tenantPool.query('COMMIT');
    console.log(`Backfilled ${tenantDatabase}: ${storeNumber} / ${posNo} / ${touchpointId}`);
  } catch (error) {
    try { await tenantPool.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    await tenantPool.end();
  }
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

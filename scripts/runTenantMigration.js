require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const usage = () => {
  console.log('Usage: node scripts/runTenantMigration.js <sql_file_path> [--tenant=<db_name>]');
  process.exit(1);
};

const sqlFilePath = process.argv[2];
if (!sqlFilePath) {
  usage();
}

const tenantArg = process.argv.find((arg) => arg.startsWith('--tenant='));
const tenantFilter = tenantArg ? tenantArg.split('=')[1] : null;

const masterUrl = process.env.MASTER_DATABASE_URL;
const template = process.env.TENANT_DATABASE_URL_TEMPLATE;

if (!masterUrl || !template) {
  console.error('MASTER_DATABASE_URL and TENANT_DATABASE_URL_TEMPLATE are required.');
  process.exit(1);
}

const resolvedPath = path.isAbsolute(sqlFilePath)
  ? sqlFilePath
  : path.join(process.cwd(), sqlFilePath);

if (!fs.existsSync(resolvedPath)) {
  console.error(`SQL file not found: ${resolvedPath}`);
  process.exit(1);
}

const sql = fs.readFileSync(resolvedPath, 'utf8');

const runStatements = async (pool, label) => {
  const client = await pool.connect();
  try {
    await client.query('SET search_path TO public');
    await client.query(sql);
    console.log(`✔ Migration applied to ${label}`);
  } finally {
    client.release();
  }
};

const run = async () => {
  const masterPool = new Pool({ connectionString: masterUrl });
  try {
    const tenantRes = await masterPool.query(
      `SELECT database_name
       FROM tenants
       WHERE database_name IS NOT NULL
       ORDER BY id ASC`
    );

    const tenants = tenantRes.rows
      .map((row) => row.database_name)
      .filter(Boolean)
      .filter((db) => (tenantFilter ? db === tenantFilter : true));

    if (tenants.length === 0) {
      console.log('No tenant databases found for migration.');
      return;
    }

    for (const dbName of tenants) {
      const connectionString = template.replace('{db}', dbName);
      const pool = new Pool({
        connectionString,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
      });
      try {
        await runStatements(pool, dbName);
      } catch (error) {
        console.error(`✖ Failed for ${dbName}:`, error.message);
      } finally {
        await pool.end();
      }
    }
  } finally {
    await masterPool.end();
  }
};

run().catch((err) => {
  console.error('Migration runner failed:', err);
  process.exit(1);
});

require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const usage = () => 'Usage: node scripts/runTenantMigration.js <sql_file_path> [--tenant=<db_name>]';

const runStatements = async (pool, label, sql, { migrationKey, migrationChecksum }) => {
  const client = await pool.connect();
  let began = false;
  try {
    await client.query('BEGIN');
    began = true;
    await client.query('SET LOCAL search_path TO public');
    await client.query(`CREATE TABLE IF NOT EXISTS tenant_schema_migrations (
      migration_key TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

    const existing = await client.query(
      'SELECT checksum FROM tenant_schema_migrations WHERE migration_key = $1',
      [migrationKey]
    );
    if (existing.rows.length > 0) {
      if (existing.rows[0].checksum !== migrationChecksum) {
        const error = new Error(`migration ${migrationKey} checksum mismatch`);
        error.code = 'TENANT_MIGRATION_CHECKSUM_MISMATCH';
        throw error;
      }
      await client.query('COMMIT');
      began = false;
      return { tenant: label, status: 'skipped' };
    }

    await client.query(sql);
    await client.query(
      'INSERT INTO tenant_schema_migrations(migration_key, checksum) VALUES($1, $2)',
      [migrationKey, migrationChecksum]
    );
    await client.query('COMMIT');
    began = false;
    return { tenant: label, status: 'applied' };
  } catch (error) {
    if (began) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
    }
    throw error;
  } finally {
    client.release();
  }
};

const runFleetMigration = async ({
  masterUrl,
  template,
  tenantFilter = null,
  sql,
  migrationKey = 'manual.sql',
  migrationChecksum = crypto.createHash('sha256').update(String(sql || '')).digest('hex'),
  dbSsl = false,
  PoolImpl = Pool,
  logger = console,
}) => {
  if (!masterUrl || !template) {
    throw new Error('MASTER_DATABASE_URL and TENANT_DATABASE_URL_TEMPLATE are required.');
  }
  if (!sql || !String(sql).trim()) {
    throw new Error('Migration SQL is required.');
  }
  if (!migrationKey || !String(migrationKey).trim()) {
    throw new Error('Migration key is required.');
  }

  const masterPool = new PoolImpl({ connectionString: masterUrl });
  const failures = [];
  const applied = [];
  const skipped = [];
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
      logger.log('No tenant databases found for migration.');
      return { applied, skipped, failures };
    }

    for (const dbName of tenants) {
      const connectionString = template.replace('{db}', dbName);
      const pool = new PoolImpl({
        connectionString,
        ssl: dbSsl ? { rejectUnauthorized: false } : false,
      });
      try {
        const result = await runStatements(pool, dbName, sql, { migrationKey, migrationChecksum });
        if (result.status === 'skipped') {
          skipped.push(dbName);
          logger.log(`↷ Migration already applied to ${dbName}`);
        } else {
          applied.push(dbName);
          logger.log(`✔ Migration applied to ${dbName}`);
        }
      } catch (error) {
        const failure = {
          tenant: dbName,
          error: error.message,
          code: error.code || null,
          rollback_error: error.rollbackError?.message || null,
        };
        failures.push(failure);
        logger.error(`✖ Failed for ${dbName}: ${failure.error}`);
      } finally {
        await pool.end();
      }
    }
  } finally {
    await masterPool.end();
  }

  if (failures.length > 0) {
    const failedTenants = failures.map((failure) => failure.tenant).join(', ');
    const error = new Error(
      `Tenant migration failed for ${failures.length} tenant(s): ${failedTenants}`
    );
    error.code = 'TENANT_MIGRATION_PARTIAL_FAILURE';
    error.failures = failures;
    error.applied = applied;
    error.skipped = skipped;
    throw error;
  }

  return { applied, skipped, failures };
};

const main = async (argv = process.argv.slice(2), env = process.env) => {
  const sqlFilePath = argv[0];
  if (!sqlFilePath) {
    throw new Error(usage());
  }

  const tenantArg = argv.find((arg) => arg.startsWith('--tenant='));
  const tenantFilter = tenantArg ? tenantArg.split('=')[1] : null;
  const resolvedPath = path.isAbsolute(sqlFilePath)
    ? sqlFilePath
    : path.join(process.cwd(), sqlFilePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`SQL file not found: ${resolvedPath}`);
  }

  const sql = fs.readFileSync(resolvedPath, 'utf8');
  const migrationKey = path.basename(resolvedPath);
  const migrationChecksum = crypto.createHash('sha256').update(sql).digest('hex');
  return runFleetMigration({
    masterUrl: env.MASTER_DATABASE_URL,
    template: env.TENANT_DATABASE_URL_TEMPLATE,
    tenantFilter,
    sql,
    migrationKey,
    migrationChecksum,
    dbSsl: env.DB_SSL === 'true',
  });
};

if (require.main === module) {
  main().catch((error) => {
    console.error('Migration runner failed:', error.message);
    if (Array.isArray(error.failures)) {
      for (const failure of error.failures) {
        console.error(` - ${failure.tenant}: ${failure.error}`);
      }
    }
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  runFleetMigration,
  runStatements,
};

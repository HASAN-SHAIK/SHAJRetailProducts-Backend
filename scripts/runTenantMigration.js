require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const usage = () => 'Usage: node scripts/runTenantMigration.js <sql_file_path> [--tenant=<db_name>]';

const runStatements = async (pool, label, sql) => {
  const client = await pool.connect();
  let began = false;
  try {
    await client.query('BEGIN');
    began = true;
    await client.query('SET LOCAL search_path TO public');
    await client.query(sql);
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

  const masterPool = new PoolImpl({ connectionString: masterUrl });
  const failures = [];
  const applied = [];
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
      return { applied, failures };
    }

    for (const dbName of tenants) {
      const connectionString = template.replace('{db}', dbName);
      const pool = new PoolImpl({
        connectionString,
        ssl: dbSsl ? { rejectUnauthorized: false } : false,
      });
      try {
        await runStatements(pool, dbName, sql);
        applied.push(dbName);
        logger.log(`✔ Migration applied to ${dbName}`);
      } catch (error) {
        const failure = {
          tenant: dbName,
          error: error.message,
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
    throw error;
  }

  return { applied, failures };
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
  return runFleetMigration({
    masterUrl: env.MASTER_DATABASE_URL,
    template: env.TENANT_DATABASE_URL_TEMPLATE,
    tenantFilter,
    sql,
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

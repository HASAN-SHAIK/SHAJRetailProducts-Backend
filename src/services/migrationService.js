const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const masterPool = require('../db/masterPool');
const { getTenantPool } = require('../db/tenantPool');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'Db', 'migrations');
const TENANT_SCHEMA_PATH = path.join(__dirname, '..', '..', 'Db', 'tenant_schema.sql');

const MASTER_MIGRATIONS = new Set([
  '2026-02-22-backfill-feature-catalog.sql',
  '2026-03-03-add-tenant-addons.sql',
]);

// Migrations created prior to canonical schema consolidation, already absorbed into tenant_schema.sql
const BASELINE_MIGRATIONS = new Set([
  '2026-02-10-add-weight-based.sql',
  '2026-02-18-add-orders-user-id.sql',
  '2026-03-02-add-performance-indexes.sql',
  '2026-03-03-add-barcode-location-indexes.sql',
  '2026-03-03-add-dashboard-summary.sql',
  '2026-03-03-add-order-cached-fields.sql',
  '2026-03-03-denorm-analytics.sql',
  '2026-03-03-fix-dashboard-metrics-location.sql',
  '2026-03-03-optimize-product-search.sql',
  '2026-03-03-optimize-tenant-indexes.sql',
  '2026-03-11-add-global-products.sql',
  '2026-03-26-add-expenses.sql',
  '2026-03-26-add-order-customer-phone.sql',
  '2026-03-26-add-order-gst-flag.sql',
  '2026-03-28-add-order-item-snapshots.sql',
  '2026-03-28-add-order-returns.sql',
  '2026-03-29-add-branch-device-licensing.sql',
  '2026-03-29-add-pos-indexes.sql',
  '2026-04-02-add-customer-module.sql',
  '2026-04-02-remove-customer-address-duplicates.sql',
  '2026-04-08-add-accounting-transactions.sql',
  '2026-04-09-returns-corrections-gst.sql',
  '2026-04-09-staff-expenses.sql',
  '2026-04-15-add-batch-mrp.sql',
  '2026-04-15-data-quality-guards.sql',
  '2026-04-26-add-user-branch-access.sql',
  '2026-05-01-add-double-entry-ledger.sql',
  '2026-05-01-allow-bank-payment-mode.sql',
  '2026-05-01-backfill-missing-supplier-payment-ledger.sql',
  '2026-05-01-fix-ledger-ap-mispostings.sql',
  '2026-05-01-fix-sales-return-double-entry.sql',
  '2026-05-01-ledger-idempotency-client-txn.sql',
  '2026-05-01-ledger-reconciliation-checks.sql',
  '2026-05-01-ledger-skip-manual-receipt-payment.sql',
  '2026-05-01-unify-app-ledger-posting.sql',
  '2026-05-02-opening-setup-and-import-lock.sql',
  '2026-07-12-app-settings.sql',
  '2026-07-12-performance-optimization.sql',
  '2026-07-12-sync-conflict-resolution.sql',
  '2026-07-12-sync-operations-prep.sql',
  '2026-07-12-sync-operations-rabbitmq.sql',
  '2026-07-12-user-refresh-tokens.sql',
  '2026-08-07-pos-customer-changed.sql',
  '2026-08-07-pos-inventory-movement-recorded.sql',
  '2026-08-07-pos-payment-recorded.sql',
  '2026-08-07-pos-receipt-issued.sql',
  '2026-08-07-pos-sale-projections.sql',
  '2026-08-07-pos-sync-events.sql',
  '2026-08-08-canonical-pos-orders.sql',
  '2026-08-08-pos-cashier-audit.sql',
  '2026-08-08-pos-sale-payment-fields.sql',
  '2026-08-09-pos-partial-returned.sql',
  '2026-08-09-pos-sale-returned.sql',
  '2026-08-13-pos-inventory-canonical-application.sql',
  '2026-08-14-pos-inventory-batch-allocations.sql',
  '2026-08-14-pos-inventory-reconciliation-provenance.sql',
  '2026-08-15-customer-outstanding-projection.sql',
  '2026-08-15-pos-customer-canonical-mapping.sql',
  '2026-08-16-branch-lifecycle.sql',
  '2026-08-16-v1-auth-tenant-roles.sql',
  '2026-08-18-branch-is-active-compat.sql',
  '2026-08-18-pos-sale-category-snapshots.sql',
  '2026-08-18-pos-sale-tax-snapshots.sql',
  '2026-08-22-pos-refund-actor-identity.sql',
  '2026-08-27-add-pos-business-identity.sql',
  '2026-11-08-cashier-shifts.sql',
  '2026-11-08-customer-reminders.sql',
  '2026-11-08-unreferenced-returns.sql',
  '2026-11-17-customer-active-phone-unique.sql',
  '20260325_add_billing_orders.sql',
  '20260325_add_gst_hsn_product_fields.sql',
]);

const calculateChecksum = (content) => {
  return crypto.createHash('sha256').update(String(content || '')).digest('hex');
};

const ensureMigrationTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS tenant_schema_migrations (
      migration_key TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
};

const runTenantSchemaBase = async (client) => {
  if (!fs.existsSync(TENANT_SCHEMA_PATH)) return;
  const sql = fs.readFileSync(TENANT_SCHEMA_PATH, 'utf8');
  await client.query('SET search_path TO public');
  await client.query(sql);
};

const getAppliedMigrations = async (client) => {
  await ensureMigrationTable(client);
  const res = await client.query('SELECT migration_key, checksum FROM tenant_schema_migrations');
  const map = new Map();
  for (const row of res.rows) {
    map.set(row.migration_key, row.checksum);
  }
  return map;
};

const runPendingMigrationsForTenant = async (dbName, options = {}) => {
  if (!dbName) throw new Error('Database name is required for tenant migration');
  const logger = options.logger || console;
  const tenantPool = getTenantPool(dbName);
  const client = await tenantPool.connect();

  let appliedCount = 0;
  let skippedCount = 0;

  try {
    await client.query('SET search_path TO public');
    const appliedMap = await getAppliedMigrations(client);

    // 1. Ensure canonical base schema is present
    const baseChecksum = calculateChecksum(fs.existsSync(TENANT_SCHEMA_PATH) ? fs.readFileSync(TENANT_SCHEMA_PATH, 'utf8') : '');
    const canonicalKey = 'canonical_tenant_schema.sql';

    if (!appliedMap.has(canonicalKey) || appliedMap.get(canonicalKey) !== baseChecksum) {
      try {
        await client.query('BEGIN');
        await runTenantSchemaBase(client);
        await client.query(
          `INSERT INTO tenant_schema_migrations (migration_key, checksum, applied_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (migration_key) DO UPDATE
           SET checksum = EXCLUDED.checksum, applied_at = NOW()`,
          [canonicalKey, baseChecksum]
        );
        await client.query('COMMIT');
        logger.log(`[AutoMigration] Base schema synced for tenant: ${dbName}`);
      } catch (baseError) {
        await client.query('ROLLBACK').catch(() => {});
        logger.warn(`[AutoMigration] Base schema sync warning for ${dbName}: ${baseError.message}`);
      }
    }

    // 2. Discover and run incremental migration files
    if (fs.existsSync(MIGRATIONS_DIR)) {
      const files = fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort();

      for (const file of files) {
        if (MASTER_MIGRATIONS.has(file)) {
          // Master DB migration, skip for tenant databases
          continue;
        }

        const filePath = path.join(MIGRATIONS_DIR, file);
        const sql = fs.readFileSync(filePath, 'utf8');
        const checksum = calculateChecksum(sql);

        if (appliedMap.has(file)) {
          skippedCount += 1;
          continue;
        }

        // If this migration was already absorbed into tenant_schema.sql baseline, mark it as absorbed
        if (BASELINE_MIGRATIONS.has(file)) {
          await client.query(
            `INSERT INTO tenant_schema_migrations (migration_key, checksum, applied_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (migration_key) DO NOTHING`,
            [file, checksum]
          ).catch(() => {});
          skippedCount += 1;
          continue;
        }

        let inTransaction = false;
        try {
          await client.query('BEGIN');
          inTransaction = true;
          await client.query('SET search_path TO public');
          await client.query(sql);
          await client.query(
            `INSERT INTO tenant_schema_migrations (migration_key, checksum, applied_at)
             VALUES ($1, $2, NOW())`,
            [file, checksum]
          );
          await client.query('COMMIT');
          inTransaction = false;
          appliedCount += 1;
          logger.log(`[AutoMigration] Applied ${file} to tenant: ${dbName}`);
        } catch (migrationError) {
          if (inTransaction) {
            await client.query('ROLLBACK').catch(() => {});
          }
          // If error is just duplicate column, table, index, or constraint, mark as absorbed to allow subsequent migrations
          const isBenignDuplicate =
            migrationError.code === '42701' || // duplicate column
            migrationError.code === '42P07' || // relation already exists
            migrationError.code === '42710' || // duplicate object
            migrationError.code === '42723' || // duplicate function
            /already exists/i.test(migrationError.message);

          if (isBenignDuplicate) {
            await client.query(
              `INSERT INTO tenant_schema_migrations (migration_key, checksum, applied_at)
               VALUES ($1, $2, NOW())
               ON CONFLICT (migration_key) DO NOTHING`,
              [file, checksum]
            ).catch(() => {});
            skippedCount += 1;
            logger.log(`[AutoMigration] Migration ${file} absorbed (already exists) in tenant: ${dbName}`);
          } else {
            logger.error(`[AutoMigration] Error applying ${file} to ${dbName}:`, migrationError.message);
            throw migrationError;
          }
        }
      }
    }

    return { database: dbName, applied: appliedCount, skipped: skippedCount };
  } finally {
    client.release();
  }
};

const runAllTenantMigrations = async (options = {}) => {
  const logger = options.logger || console;
  let client;
  try {
    client = await masterPool.connect();
    const res = await client.query(`
      SELECT id, shop_name, database_name 
      FROM tenants 
      WHERE database_name IS NOT NULL AND is_active = TRUE 
      ORDER BY id ASC
    `);

    const tenants = res.rows;
    logger.log(`[AutoMigration] Scanning ${tenants.length} tenant databases for pending migrations...`);

    const results = [];
    const failures = [];

    for (const tenant of tenants) {
      try {
        const result = await runPendingMigrationsForTenant(tenant.database_name, { logger });
        results.push(result);
      } catch (err) {
        failures.push({ tenant: tenant.database_name, error: err.message });
      }
    }

    logger.log(
      `[AutoMigration] Migration complete. ${results.length}/${tenants.length} tenants up to date.` +
        (failures.length > 0 ? ` (${failures.length} failed)` : '')
    );

    return { total: tenants.length, success: results.length, failures, results };
  } catch (err) {
    logger.error('[AutoMigration] Failed to query tenants from master DB:', err.message);
    throw err;
  } finally {
    if (client) client.release();
  }
};

const runPendingMasterMigrations = async (options = {}) => {
  const logger = options.logger || console;
  let client;
  try {
    client = await masterPool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS master_schema_migrations (
        migration_key TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const res = await client.query('SELECT migration_key, checksum FROM master_schema_migrations');
    const appliedMap = new Map();
    for (const row of res.rows) {
      appliedMap.set(row.migration_key, row.checksum);
    }

    for (const file of MASTER_MIGRATIONS) {
      const filePath = path.join(MIGRATIONS_DIR, file);
      if (!fs.existsSync(filePath)) continue;
      const sql = fs.readFileSync(filePath, 'utf8');
      const checksum = calculateChecksum(sql);
      if (appliedMap.has(file)) continue;

      let inTransaction = false;
      try {
        await client.query('BEGIN');
        inTransaction = true;
        await client.query('SET search_path TO public');
        await client.query(sql);
        await client.query(
          `INSERT INTO master_schema_migrations (migration_key, checksum, applied_at)
           VALUES ($1, $2, NOW())`,
          [file, checksum]
        );
        await client.query('COMMIT');
        inTransaction = false;
        logger.log(`[AutoMigration] Applied master migration ${file}`);
      } catch (err) {
        if (inTransaction) {
          await client.query('ROLLBACK').catch(() => {});
        }
        logger.warn(`[AutoMigration] Master migration warning for ${file}: ${err.message}`);
      }
    }
  } finally {
    if (client) client.release();
  }
};

const bootstrapMigrationsOnStartup = async (options = {}) => {
  try {
    await runPendingMasterMigrations(options);
    return await runAllTenantMigrations(options);
  } catch (err) {
    console.error('[AutoMigration] Startup fleet migration failed:', err.message);
    return null;
  }
};

module.exports = {
  calculateChecksum,
  ensureMigrationTable,
  runPendingMasterMigrations,
  runPendingMigrationsForTenant,
  runAllTenantMigrations,
  bootstrapMigrationsOnStartup,
};

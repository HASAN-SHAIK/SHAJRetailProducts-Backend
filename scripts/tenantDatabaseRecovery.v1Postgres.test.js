const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');

const {
  backupTenantDatabase,
  verifyTenantBackup,
  restoreTenantDatabase,
} = require('./tenantDatabaseRecovery');

const connectionString = process.env.TEST_TENANT_DATABASE_URL;
const describeIfPostgres = connectionString ? describe : describe.skip;

describeIfPostgres('V1 Central tenant native backup and restore', () => {
  let pool;
  let tempDir;
  let backupPath;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v1-tenant-recovery-'));
    backupPath = path.join(tempDir, 'tenant.dump');

    await pool.query('DROP TABLE IF EXISTS orders CASCADE');
    await pool.query('DROP TABLE IF EXISTS customers CASCADE');
    await pool.query('DROP TABLE IF EXISTS products CASCADE');
    await pool.query('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
    await pool.query('CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
    await pool.query('CREATE TABLE orders (id INTEGER PRIMARY KEY, total_price NUMERIC NOT NULL)');
    await pool.query("INSERT INTO products(id, name) VALUES (101, 'Backup Product')");
    await pool.query("INSERT INTO customers(id, name) VALUES (201, 'Backup Customer')");
    await pool.query('INSERT INTO orders(id, total_price) VALUES (301, 125.50)');
  });

  afterAll(async () => {
    if (pool) await pool.end();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('backs up, verifies, restores the same tenant and preserves canonical facts', async () => {
    const backup = backupTenantDatabase({ connectionString, backupPath });
    expect(backup.tenant_database).toBe('tenant_v1');
    expect(fs.statSync(backupPath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(backup.manifest_path).mode & 0o777).toBe(0o600);

    const verification = verifyTenantBackup({ backupPath, manifestPath: backup.manifest_path });
    expect(verification.valid).toBe(true);
    expect(verification.tenant_database).toBe('tenant_v1');

    await pool.query('DELETE FROM products');
    await pool.query('DELETE FROM customers');
    await pool.query('DELETE FROM orders');

    const restored = await restoreTenantDatabase({
      connectionString,
      backupPath,
      manifestPath: backup.manifest_path,
      confirmTenant: 'tenant_v1',
    });
    expect(restored.restored).toBe(true);
    expect(restored.smoke.ok).toBe(true);

    const product = await pool.query('SELECT name FROM products WHERE id = 101');
    const customer = await pool.query('SELECT name FROM customers WHERE id = 201');
    const order = await pool.query('SELECT total_price::text AS total_price FROM orders WHERE id = 301');
    expect(product.rows[0].name).toBe('Backup Product');
    expect(customer.rows[0].name).toBe('Backup Customer');
    expect(order.rows[0].total_price).toBe('125.50');
  });

  test('rejects tampered archives before restore', () => {
    const tampered = path.join(tempDir, 'tampered.dump');
    const manifest = `${tampered}.manifest.json`;
    fs.copyFileSync(backupPath, tampered);
    fs.copyFileSync(`${backupPath}.manifest.json`, manifest);
    fs.appendFileSync(tampered, 'tampered');

    let error;
    try {
      verifyTenantBackup({ backupPath: tampered, manifestPath: manifest });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: 'TENANT_BACKUP_CHECKSUM_MISMATCH' });
  });

  test('rejects cross-tenant restore and requires explicit tenant confirmation', async () => {
    const manifestPath = `${backupPath}.manifest.json`;
    const otherTenantUrl = connectionString.replace('/tenant_v1', '/tenant_other');

    await expect(
      restoreTenantDatabase({
        connectionString: otherTenantUrl,
        backupPath,
        manifestPath,
        confirmTenant: 'tenant_other',
      })
    ).rejects.toMatchObject({ code: 'TENANT_RESTORE_TARGET_MISMATCH' });

    await expect(
      restoreTenantDatabase({
        connectionString,
        backupPath,
        manifestPath,
        confirmTenant: 'wrong-tenant',
      })
    ).rejects.toMatchObject({ code: 'TENANT_RESTORE_CONFIRMATION_REQUIRED' });
  });
});

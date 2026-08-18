require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Pool } = require('pg');

const BACKUP_FORMAT = 'postgres-custom-v1';
const CORE_TABLES = ['products', 'orders', 'customers'];

const recoveryError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const parseConnectionString = (connectionString) => {
  if (!connectionString) {
    throw recoveryError('TENANT_DATABASE_URL_REQUIRED', 'Tenant database connection string is required');
  }

  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch (_error) {
    throw recoveryError('TENANT_DATABASE_URL_INVALID', 'Tenant database connection string is invalid');
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw recoveryError('TENANT_DATABASE_URL_INVALID', 'Tenant database connection string must use postgres');
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database) {
    throw recoveryError('TENANT_DATABASE_NAME_REQUIRED', 'Tenant database name is required');
  }

  return {
    host: parsed.hostname,
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username || ''),
    password: decodeURIComponent(parsed.password || ''),
    database,
    sslmode: parsed.searchParams.get('sslmode') || null,
  };
};

const buildPgEnv = (connectionString, baseEnv = process.env) => {
  const target = parseConnectionString(connectionString);
  const env = {
    ...baseEnv,
    PGHOST: target.host,
    PGPORT: target.port,
    PGDATABASE: target.database,
  };
  if (target.user) env.PGUSER = target.user;
  if (target.password) env.PGPASSWORD = target.password;
  if (target.sslmode) env.PGSSLMODE = target.sslmode;
  return env;
};

const sha256File = (filePath) => {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
};

const runPgTool = (command, args, { connectionString = null, spawnSyncImpl = spawnSync } = {}) => {
  const env = connectionString ? buildPgEnv(connectionString) : { ...process.env };
  const result = spawnSyncImpl(command, args, {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.error?.message || '').trim();
    throw recoveryError(
      'TENANT_DATABASE_RECOVERY_TOOL_FAILED',
      `${command} failed${detail ? `: ${detail}` : ''}`
    );
  }
  return result;
};

const defaultManifestPath = (backupPath) => `${backupPath}.manifest.json`;

const readManifest = (manifestPath) => {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (_error) {
    throw recoveryError('TENANT_BACKUP_MANIFEST_INVALID', 'Backup manifest is missing or invalid');
  }

  if (
    manifest?.format !== BACKUP_FORMAT ||
    !manifest?.tenant_database ||
    !manifest?.sha256 ||
    !manifest?.created_at
  ) {
    throw recoveryError('TENANT_BACKUP_MANIFEST_INVALID', 'Backup manifest is incomplete or unsupported');
  }
  return manifest;
};

const verifyTenantBackup = ({ backupPath, manifestPath = defaultManifestPath(backupPath), spawnSyncImpl = spawnSync }) => {
  if (!backupPath || !fs.existsSync(backupPath)) {
    throw recoveryError('TENANT_BACKUP_NOT_FOUND', 'Backup archive was not found');
  }
  const manifest = readManifest(manifestPath);
  const computed = sha256File(backupPath);
  if (computed !== manifest.sha256) {
    throw recoveryError('TENANT_BACKUP_CHECKSUM_MISMATCH', 'Backup archive checksum does not match its manifest');
  }

  runPgTool('pg_restore', ['--list', backupPath], { spawnSyncImpl });
  return {
    valid: true,
    tenant_database: manifest.tenant_database,
    sha256: computed,
    created_at: manifest.created_at,
    manifest_path: manifestPath,
  };
};

const backupTenantDatabase = ({
  connectionString,
  backupPath,
  manifestPath = defaultManifestPath(backupPath),
  spawnSyncImpl = spawnSync,
  now = () => new Date(),
}) => {
  if (!backupPath) {
    throw recoveryError('TENANT_BACKUP_PATH_REQUIRED', 'Backup output path is required');
  }
  const target = parseConnectionString(connectionString);
  fs.mkdirSync(path.dirname(path.resolve(backupPath)), { recursive: true });

  runPgTool(
    'pg_dump',
    ['--format=custom', '--no-owner', '--no-acl', '--file', backupPath],
    { connectionString, spawnSyncImpl }
  );

  if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size === 0) {
    throw recoveryError('TENANT_BACKUP_EMPTY', 'pg_dump did not produce a non-empty backup archive');
  }

  const manifest = {
    format: BACKUP_FORMAT,
    tenant_database: target.database,
    created_at: now().toISOString(),
    sha256: sha256File(backupPath),
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(backupPath, 0o600);
  fs.chmodSync(manifestPath, 0o600);

  verifyTenantBackup({ backupPath, manifestPath, spawnSyncImpl });
  return { backup_path: backupPath, manifest_path: manifestPath, ...manifest };
};

const postRestoreSmoke = async (connectionString, PoolImpl = Pool) => {
  const pool = new PoolImpl({ connectionString });
  try {
    const result = await pool.query(
      `SELECT $1::text AS product_table,
              to_regclass('public.products')::text AS products,
              to_regclass('public.orders')::text AS orders,
              to_regclass('public.customers')::text AS customers`,
      ['products']
    );
    const row = result.rows[0] || {};
    const missing = CORE_TABLES.filter((table) => !row[table]);
    if (missing.length > 0) {
      throw recoveryError(
        'TENANT_RESTORE_SMOKE_FAILED',
        `Restored tenant is missing required table(s): ${missing.join(', ')}`
      );
    }
    return { ok: true, required_tables: [...CORE_TABLES] };
  } finally {
    await pool.end();
  }
};

const restoreTenantDatabase = async ({
  connectionString,
  backupPath,
  manifestPath = defaultManifestPath(backupPath),
  confirmTenant,
  spawnSyncImpl = spawnSync,
  PoolImpl = Pool,
}) => {
  const target = parseConnectionString(connectionString);
  const verification = verifyTenantBackup({ backupPath, manifestPath, spawnSyncImpl });

  if (verification.tenant_database !== target.database) {
    throw recoveryError(
      'TENANT_RESTORE_TARGET_MISMATCH',
      'Backup tenant identity does not match the restore target database'
    );
  }
  if (!confirmTenant || confirmTenant !== target.database) {
    throw recoveryError(
      'TENANT_RESTORE_CONFIRMATION_REQUIRED',
      'Restore requires exact tenant database confirmation'
    );
  }

  runPgTool(
    'pg_restore',
    [
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-acl',
      '--single-transaction',
      '--exit-on-error',
      '--dbname',
      target.database,
      backupPath,
    ],
    { connectionString, spawnSyncImpl }
  );

  const smoke = await postRestoreSmoke(connectionString, PoolImpl);
  return { restored: true, tenant_database: target.database, verification, smoke };
};

const parseArgs = (argv) => {
  const [command, ...rest] = argv;
  const options = {};
  for (const arg of rest) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) options[match[1]] = match[2];
  }
  return { command, options };
};

const main = async (argv = process.argv.slice(2), env = process.env) => {
  const { command, options } = parseArgs(argv);
  const connectionEnv = options['connection-env'] || 'TENANT_DATABASE_URL';
  const connectionString = env[connectionEnv];
  const backupPath = options.backup;
  const manifestPath = options.manifest || (backupPath ? defaultManifestPath(backupPath) : undefined);

  if (command === 'backup') {
    return backupTenantDatabase({ connectionString, backupPath, manifestPath });
  }
  if (command === 'verify') {
    return verifyTenantBackup({ backupPath, manifestPath });
  }
  if (command === 'restore') {
    return restoreTenantDatabase({
      connectionString,
      backupPath,
      manifestPath,
      confirmTenant: options['confirm-tenant'],
    });
  }
  throw recoveryError(
    'TENANT_DATABASE_RECOVERY_USAGE',
    'Usage: node scripts/tenantDatabaseRecovery.js <backup|verify|restore> --backup=<path> [--manifest=<path>] [--connection-env=TENANT_DATABASE_URL] [--confirm-tenant=<db>]'
  );
};

if (require.main === module) {
  main()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(`Tenant database recovery failed [${error.code || 'UNKNOWN'}]: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  BACKUP_FORMAT,
  CORE_TABLES,
  parseConnectionString,
  buildPgEnv,
  sha256File,
  verifyTenantBackup,
  backupTenantDatabase,
  postRestoreSmoke,
  restoreTenantDatabase,
  main,
};

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const masterPool = require('../db/masterPool');

const EXPECTED_TABLES = [
  'shop_types',
  'tenants',
  'tenant_config',
  'subscriptions',
  'platform_admins',
  'plans',
  'subscription_payments',
  'platform_activity_logs',
  'platform_settings',
  'support_cases',
  'support_case_messages',
  'support_case_attachments'
];

const DUPLICATE_OBJECT_CODES = new Set(['42P07', '42710']);

const runSqlFileSafe = async (pool, filePath) => {
  const sql = fs.readFileSync(filePath, 'utf8');
  const statements = sql
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);

  const client = await pool.connect();
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS public');
    await client.query('SET search_path TO public');
    for (const statement of statements) {
      try {
        await client.query(statement);
      } catch (error) {
        if (error.code === '42501') {
          throw new Error(
            'Insufficient privileges to create tables in schema public. Grant CREATE on schema public to the master DB user.'
          );
        }
        if (DUPLICATE_OBJECT_CODES.has(error.code)) {
          continue;
        }
        throw error;
      }
    }
  } finally {
    client.release();
  }
};

const getMissingTables = async () => {
  const result = await masterPool.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])`,
    [EXPECTED_TABLES]
  );
  const existing = new Set(result.rows.map((row) => row.table_name));
  return EXPECTED_TABLES.filter((table) => !existing.has(table));
};

const ensurePlatformSchema = async () => {
  const missing = await getMissingTables();
  if (missing.length === 0) {
    return;
  }

  const schemaPath = path.join(__dirname, '..', '..', 'Db', 'platform_schema.sql');
  await runSqlFileSafe(masterPool, schemaPath);
};

const ensureDefaultPlatformAdmin = async () => {
  const email = (process.env.PLATFORM_BOOTSTRAP_EMAIL || 'hasan@shaj.com').toLowerCase();
  const password = process.env.PLATFORM_BOOTSTRAP_PASSWORD || 'hasan@6255';
  const name = process.env.PLATFORM_BOOTSTRAP_NAME || 'Hasan';
  const role = process.env.PLATFORM_BOOTSTRAP_ROLE || 'platform_admin';

  const existing = await masterPool.query(
    'SELECT id FROM platform_admins WHERE email = $1',
    [email]
  );
  if (existing.rowCount > 0) {
    return;
  }

  const hashed = await bcrypt.hash(password, 10);
  await masterPool.query(
    'INSERT INTO platform_admins (name, email, password, role) VALUES ($1, $2, $3, $4)',
    [name, email, hashed, role]
  );
};

const DEFAULT_PLANS = [
  {
    name: 'basic',
    price: 499, // ₹499/month
    duration_days: 30,
    features: {
      enable_piece_based: true,
      enable_weight_based: true,
      is_order_based: true,
      max_users: 1,
      customer_details_enabled: false,
      GST_invoice_enabled: false,
      advanced_reports: false,
      analytical_reports: false,
      api_access: false,
      multi_branch: false,
      priority_support: false
    }
  },
  {
    name: 'pro',
    price: 799, // ₹799/month
    duration_days: 30,
    features: {
      enable_piece_based: true,
      enable_weight_based: true,
      is_order_based: true,
      max_users: 5,
      customer_details_enabled: true,
      GST_invoice_enabled: true,
      advanced_reports: true,
      analytical_reports: false,
      api_access: false,
      multi_branch: false,
      priority_support: false
    }
  },
  {
    name: 'premium',
    price: 1199, // ₹1199/month
    duration_days: 30,
    features: {
      enable_piece_based: true,
      enable_weight_based: true,
      is_order_based: true,
      max_users: 20,
      customer_details_enabled: true,
      GST_invoice_enabled: true,
      advanced_reports: true,
      analytical_reports: true,
      api_access: true,
      multi_branch: true,
      priority_support: true
    }
  }
];

const ensureDefaultPlans = async () => {
  for (const plan of DEFAULT_PLANS) {
    await masterPool.query(
      `INSERT INTO plans (name, price, duration_days, features, is_active)
       VALUES ($1, $2, $3, $4::jsonb, TRUE)
       ON CONFLICT (name) DO NOTHING`,
      [plan.name, plan.price, plan.duration_days, JSON.stringify(plan.features)]
    );
  }
};

const bootstrapMasterDatabase = async () => {
  await masterPool.query('SELECT 1');
  await ensurePlatformSchema();
  await ensureDefaultPlatformAdmin();
  await ensureDefaultPlans();
  console.log('Master DB bootstrap completed.');
};

module.exports = { bootstrapMasterDatabase };

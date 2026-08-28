require('dotenv').config();

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const masterPool = require('../src/db/masterPool');
const { getTenantPool, closeAllTenantPools } = require('../src/db/tenantPool');

const CONFIRM_FLAG = '--confirm-dev-reset';
const DEFAULT_PASSWORD = 'Password@123';
const DEV_TENANT_DOMAIN = 'demo.test';

const branchIds = {
  downtown: '11111111-1111-4111-8111-111111111111',
  westEnd: '22222222-2222-4222-8222-222222222222',
  metroMall: '33333333-3333-4333-8333-333333333333',
  airport: '44444444-4444-4444-8444-444444444444',
  warehouse: '55555555-5555-4555-8555-555555555555',
};

const singlePosProfile = {
  name: 'POS1',
  frontendPort: 3000,
  apiPort: 4782,
  device_id: 'SINGLE-POS-DTN-01',
  installation_id: 'SINGLE-INSTALL-DTN-01',
  branch_id: branchIds.downtown,
  store_number: 'STORE-001',
  terminal_id: 'POS-01',
  pos_no: 'POS-01',
  touchpoint_id: 'TP-01',
  device_name: 'Single POS Downtown Counter',
  store_name: 'Downtown Hub',
};

const simulatedPosProfiles = [
  singlePosProfile,
];

const staffIds = {
  anita: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  rahul: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  meera: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  imran: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  kavya: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  vikram: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  sana: '12121212-1212-4212-8212-121212121212',
  joseph: '34343434-3434-4434-8434-343434343434',
};

const quoteIdent = (value) => `"${String(value).replace(/"/g, '""')}"`;

const hasConfirmedReset = () => process.argv.includes(CONFIRM_FLAG);

const envName = () =>
  String(
    process.env.APP_ENVIRONMENT ||
      process.env.NODE_ENV ||
      process.env.POS_ENVIRONMENT ||
      process.env.ENVIRONMENT ||
      ''
  ).toLowerCase();

const extractDbTargets = () => [
  process.env.MASTER_DATABASE_URL,
  process.env.TENANT_DATABASE_URL_TEMPLATE,
  process.env.DB_HOST,
  process.env.TENANT_DB_HOST,
  process.env.MASTER_DB_HOST,
].filter(Boolean);

const assertDevOnly = () => {
  if (!hasConfirmedReset()) {
    throw new Error(`Refusing to reset data without ${CONFIRM_FLAG}.`);
  }

  const mode = envName();
  if (['production', 'prod', 'live'].includes(mode)) {
    throw new Error(`Refusing to seed in ${mode} mode.`);
  }

  const targets = extractDbTargets().join(' ');
  const looksLocal =
    /localhost|127\.0\.0\.1|::1/i.test(targets) ||
    ['development', 'dev', 'local', 'test', 'cypress'].includes(mode);

  if (!looksLocal && process.env.ALLOW_NON_LOCAL_DEV_SEED !== 'true') {
    throw new Error(
      'Refusing to reset a non-local database. Set ALLOW_NON_LOCAL_DEV_SEED=true only for an isolated development database.'
    );
  }
};

const tableExists = (schema, table) => Boolean(schema[table]);
const columnExists = (schema, table, column) => Boolean(schema[table]?.[column]);

const normalizeValue = (column, value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (['json', 'jsonb'].includes(column.data_type) && typeof value !== 'string') {
    return JSON.stringify(value);
  }
  return value;
};

const loadSchema = async (client) => {
  const { rows } = await client.query(
    `SELECT table_name, column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY table_name, ordinal_position`
  );
  return rows.reduce((acc, row) => {
    acc[row.table_name] ||= {};
    acc[row.table_name][row.column_name] = row;
    return acc;
  }, {});
};

const loadTables = async (client) => {
  const { rows } = await client.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_type = 'BASE TABLE'
     ORDER BY table_name`
  );
  return rows.map((row) => row.table_name);
};

const truncateTenantData = async (client, tables) => {
  if (!tables.length) return;
  await client.query(`TRUNCATE TABLE ${tables.map(quoteIdent).join(', ')} RESTART IDENTITY CASCADE`);
};

const insertRow = async (client, schema, table, row, returning = 'id') => {
  if (!tableExists(schema, table)) return null;
  const entries = Object.entries(row)
    .filter(([column, value]) => columnExists(schema, table, column) && value !== undefined)
    .map(([column, value]) => [column, normalizeValue(schema[table][column], value)]);

  if (!entries.length) return null;

  const columns = entries.map(([column]) => column);
  const values = entries.map(([, value]) => value);
  const placeholders = values.map((_, index) => `$${index + 1}`);
  const returningSql = returning && columnExists(schema, table, returning) ? ` RETURNING ${quoteIdent(returning)}` : '';
  const result = await client.query(
    `INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(', ')})
     VALUES (${placeholders.join(', ')})${returningSql}`,
    values
  );
  return result.rows[0] || null;
};

const seedSettings = async (client, schema, tenant) => {
  await insertRow(client, schema, 'shop_details', {
    shop_name: tenant.shop_name || 'SHAJ Demo Retail',
    owner_name: tenant.owner_name || 'Demo Owner',
    mobile_number: tenant.mobile || '9876543210',
    upi_id: 'demo-retail@upi',
    gst_number: '29ABCDE1234F1Z5',
    address_line: '12 Market Road',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560001',
  });

  await insertRow(client, schema, 'settings', {
    whatsapp_bill_module: true,
    is_opening_completed: true,
    opening_completed_at: new Date(),
  });

  const appSettings = [
    ['store_settings', { invoice_prefix: 'SHAJ', invoice_footer: 'Thank you for shopping with us.', currency: 'INR', auto_sync: true, notifications_enabled: true }],
    ['tax_settings', { default_tax_percent: '18' }],
    ['printer_settings', { receipt_paper_width_mm: 80 }],
    ['theme_settings', { desktop: 'light', mobile: 'light' }],
  ];

  for (const [setting_key, value_json] of appSettings) {
    await insertRow(client, schema, 'app_settings', { setting_key, value_json, updated_at: new Date() });
  }

  await insertRow(client, schema, 'opening_setup', {
    cash_amount: 25000,
    bank_amount: 175000,
    inventory_value: 420000,
    total_capital: 620000,
  });
};

const ensureDevTenantLoginDomain = async (tenant) => {
  await masterPool.query(
    `UPDATE tenants
        SET domain = $2,
            email = COALESCE(NULLIF(email, ''), $3),
            shop_name = COALESCE(NULLIF(shop_name, ''), $4),
            owner_name = COALESCE(NULLIF(owner_name, ''), $5)
      WHERE id = $1`,
    [tenant.id, DEV_TENANT_DOMAIN, `owner@${DEV_TENANT_DOMAIN}`, 'SHAJ Demo Retail', 'Demo Owner']
  );
  return { ...tenant, domain: DEV_TENANT_DOMAIN };
};

const seedSystemLedgers = async (client, schema) => {
  const ledgers = [
    ['Cash in Hand', 'ASSET'],
    ['Bank Account', 'ASSET'],
    ['Accounts Receivable', 'ASSET'],
    ['Accounts Payable', 'LIABILITY'],
    ['Output CGST', 'LIABILITY'],
    ['Output SGST', 'LIABILITY'],
    ['Output IGST', 'LIABILITY'],
    ['Sales (Retail)', 'INCOME'],
    ['Sales (Wholesale)', 'INCOME'],
    ['Purchase', 'EXPENSE'],
    ['Rent', 'EXPENSE'],
    ['Salaries', 'EXPENSE'],
    ['Misc Expense', 'EXPENSE'],
    ['Input CGST', 'ASSET'],
    ['Input SGST', 'ASSET'],
    ['Input IGST', 'ASSET'],
    ['Inventory', 'ASSET'],
    ['Capital', 'LIABILITY'],
    ['Drawings Account', 'EXPENSE'],
    ['Operating Expenses', 'EXPENSE'],
    ['Sales Revenue', 'INCOME'],
  ];

  for (const [name, type] of ledgers) {
    await insertRow(client, schema, 'ledgers', {
      name,
      type,
      is_system: true,
      branch_id: null,
    });
  }
};

const seedBranches = async (client, schema) => {
  const branches = [
    { id: branchIds.downtown, store_number: 'STORE-001', name: 'Downtown Hub', location: 'MG Road', subscription_plan: 'premium', max_devices_allowed: 8, is_active: true },
  ];

  for (const branch of branches) await insertRow(client, schema, 'branches', branch);

  const devices = simulatedPosProfiles.map((profile) => ({
    branch_id: profile.branch_id,
    user_id: 1,
    device_id: profile.device_id,
    device_name: `${profile.device_name} (localhost:${profile.frontendPort})`,
    browser_info: 'Chrome',
    os_info: 'Windows 11',
    ip_address: '127.0.0.1',
    last_login_at: new Date(),
    is_active: true,
    store_number: profile.store_number,
    pos_no: profile.pos_no || profile.terminal_id,
    touchpoint_id: profile.touchpoint_id,
  }));

  for (const device of devices) await insertRow(client, schema, 'branch_devices', device);

  const requests = [
    ...simulatedPosProfiles.map((profile) => ({
      request_id: `REQ-${profile.device_id}`,
      branch_id: profile.branch_id,
      device_id: profile.device_id,
      installation_id: profile.installation_id,
      device_name: profile.device_name,
      os_info: 'Windows 11',
      terminal_id: profile.terminal_id,
      store_number: profile.store_number,
      pos_no: profile.pos_no || profile.terminal_id,
      touchpoint_id: profile.touchpoint_id,
      status: 'CLAIMED',
      claimed_at: new Date(),
      reviewed_at: new Date(),
      reviewed_by: 'dev-seed',
    })),
  ];

  for (const request of requests) {
    await insertRow(client, schema, 'pos_registration_requests', {
      ...request,
      request_token_hash: crypto.createHash('sha256').update(`dev-registration-token-${request.request_id}`).digest('hex'),
      status: request.status || 'PENDING',
      requested_at: new Date(),
    });
  }
};

const seedUsers = async (client, schema) => {
  const password = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  const email = (name) => `${name}@${DEV_TENANT_DOMAIN}`;
  const users = [
    { name: 'Demo Owner', email: email('owner'), password, role: 'admin', branch_id: null, all_branch_access: true },
    { name: 'Store Manager', email: email('manager'), password, role: 'manager', branch_id: branchIds.downtown, all_branch_access: false },
    { name: 'Cashier One', email: email('cashier'), password, role: 'cashier', branch_id: branchIds.downtown, all_branch_access: false },
    { name: 'Inventory Clerk', email: email('inventory'), password, role: 'staff', branch_id: branchIds.downtown, all_branch_access: false },
    { name: 'Returns Desk', email: email('returns'), password, role: 'staff', branch_id: branchIds.downtown, all_branch_access: false },
    { name: 'Purchase Clerk', email: email('purchase'), password, role: 'staff', branch_id: branchIds.downtown, all_branch_access: false },
    { name: 'Finance Admin', email: email('finance'), password, role: 'admin', branch_id: null, all_branch_access: true },
  ];
  const inserted = [];
  for (const user of users) inserted.push(await insertRow(client, schema, 'users', user));
  return inserted;
};

const seedPeople = async (client, schema) => {
  const customers = [
    { name: 'Priya Stores', mobile: '9876500001', phone: '9876500001', type: 'wholesale', email: 'priya.stores@example.test', location: 'Downtown', address: '14 Bazaar Street', shop_name: 'Priya Stores', gst_number: '29PRIYA1234F1Z2', credit_limit: 75000, current_balance: 18450, notes: 'High-volume monthly buyer', is_active: true },
    { name: 'Arjun Kumar', mobile: '9876500002', phone: '9876500002', type: 'retail', email: 'arjun@example.test', location: 'Downtown', address: '22 Lake View', credit_limit: 15000, current_balance: 2600, notes: 'Prefers UPI payments', is_active: true },
    { name: 'Nisha Textiles', mobile: '9876500003', phone: '9876500003', type: 'wholesale', email: 'accounts@nishatextiles.example.test', location: 'Downtown', address: 'Unit 18, Market Arcade', shop_name: 'Nisha Textiles', gst_number: '29NISHA1234F1Z7', credit_limit: 120000, current_balance: 42000, notes: 'Credit review due this month', is_active: true },
    { name: 'Walk-in Customer', mobile: '9999999999', phone: '9999999999', type: 'retail', location: 'Downtown', credit_limit: 0, current_balance: 0, notes: 'Default POS customer', is_active: true },
    { name: 'Green Basket Cafe', mobile: '9876500004', phone: '9876500004', type: 'wholesale', email: 'ops@greenbasket.example.test', location: 'Downtown', address: 'Food Court Lane', shop_name: 'Green Basket Cafe', gst_number: '29GREEN1234F1Z8', credit_limit: 90000, current_balance: 31500, notes: 'Daily replenishment account', is_active: true },
    { name: 'Ramesh Family', mobile: '9876500005', phone: '9876500005', type: 'retail', email: 'ramesh.family@example.test', location: 'Downtown', address: '7 Residency Cross', credit_limit: 10000, current_balance: 0, notes: 'Loyalty customer', is_active: true },
    { name: 'City Mart Mini', mobile: '9876500006', phone: '9876500006', type: 'wholesale', email: 'purchase@citymartmini.example.test', location: 'Downtown', address: '44 Temple Road', shop_name: 'City Mart Mini', gst_number: '29CITYM1234F1Z9', credit_limit: 65000, current_balance: 12750, notes: 'Weekly grocery supplies', is_active: true },
    { name: 'Office Pantry Services', mobile: '9876500007', phone: '9876500007', type: 'wholesale', email: 'billing@officepantry.example.test', location: 'Downtown', address: 'Embassy Tech Park', shop_name: 'Office Pantry Services', gst_number: '29PANTRY1234F1Z4', credit_limit: 150000, current_balance: 86500, notes: 'Monthly consolidated invoice', is_active: true },
    { name: 'Sneha Rao', mobile: '9876500008', phone: '9876500008', type: 'retail', email: 'sneha.rao@example.test', location: 'Downtown', address: 'Hebbal', credit_limit: 5000, current_balance: 1450, notes: 'Frequent shopper', is_active: true },
    { name: 'Bulk Buyer Co-op', mobile: '9876500009', phone: '9876500009', type: 'wholesale', email: 'accounts@bulkbuyer.example.test', location: 'Downtown', address: 'Peenya 2nd Stage', shop_name: 'Bulk Buyer Co-op', gst_number: '29BULKB1234F1Z6', credit_limit: 250000, current_balance: 112000, notes: 'Bulk pickup customer', is_active: true },
  ];

  const insertedCustomers = [];
  for (const customer of customers) insertedCustomers.push(await insertRow(client, schema, 'customers', customer));

  const staff = [
    { id: staffIds.anita, name: 'Anita Rao', phone: '9000000001', role: 'Store Manager', salary: 42000, join_date: '2024-04-15', status: 'active', branch_id: branchIds.downtown },
    { id: staffIds.rahul, name: 'Rahul Menon', phone: '9000000002', role: 'Cashier', salary: 28000, join_date: '2025-01-08', status: 'active', branch_id: branchIds.downtown },
    { id: staffIds.meera, name: 'Meera Iyer', phone: '9000000003', role: 'Inventory Lead', salary: 36000, join_date: '2023-11-20', status: 'active', branch_id: branchIds.downtown },
    { id: staffIds.imran, name: 'Imran Khan', phone: '9000000004', role: 'Sales Associate', salary: 24000, join_date: '2025-06-01', status: 'inactive', branch_id: branchIds.downtown },
    { id: staffIds.kavya, name: 'Kavya Nair', phone: '9000000005', role: 'Floor Supervisor', salary: 39000, join_date: '2024-08-12', status: 'active', branch_id: branchIds.downtown },
    { id: staffIds.vikram, name: 'Vikram Shetty', phone: '9000000006', role: 'Purchase Clerk', salary: 32000, join_date: '2025-03-19', status: 'active', branch_id: branchIds.downtown },
    { id: staffIds.sana, name: 'Sana Fathima', phone: '9000000007', role: 'Returns Desk', salary: 41000, join_date: '2023-09-05', status: 'active', branch_id: branchIds.downtown },
    { id: staffIds.joseph, name: 'Joseph Mathew', phone: '9000000008', role: 'Dispatch Associate', salary: 26500, join_date: '2025-05-21', status: 'active', branch_id: branchIds.downtown },
  ];

  for (const employee of staff) await insertRow(client, schema, 'staff', employee);

  const month = new Date().toISOString().slice(0, 7);
  const salaries = [
    { id: '10101010-1010-4010-8010-101010101010', staff_id: staffIds.anita, month, base_salary: 42000, bonus: 3000, deductions: 500, net_salary: 44500, paid_amount: 44500, pending_amount: 0, payment_status: 'paid', branch_id: branchIds.downtown },
    { id: '20202020-2020-4020-8020-202020202020', staff_id: staffIds.rahul, month, base_salary: 28000, bonus: 1000, deductions: 0, net_salary: 29000, paid_amount: 15000, pending_amount: 14000, payment_status: 'partial', branch_id: branchIds.downtown },
    { id: '30303030-3030-4030-8030-303030303030', staff_id: staffIds.meera, month, base_salary: 36000, bonus: 1500, deductions: 1000, net_salary: 36500, paid_amount: 0, pending_amount: 36500, payment_status: 'pending', branch_id: branchIds.downtown },
    { id: '40404040-4040-4040-8040-404040404040', staff_id: staffIds.kavya, month, base_salary: 39000, bonus: 2500, deductions: 500, net_salary: 41000, paid_amount: 41000, pending_amount: 0, payment_status: 'paid', branch_id: branchIds.downtown },
    { id: '50505050-5050-4050-8050-505050505050', staff_id: staffIds.vikram, month, base_salary: 32000, bonus: 2000, deductions: 0, net_salary: 34000, paid_amount: 17000, pending_amount: 17000, payment_status: 'partial', branch_id: branchIds.downtown },
    { id: '60606060-6060-4060-8060-606060606060', staff_id: staffIds.sana, month, base_salary: 41000, bonus: 1000, deductions: 0, net_salary: 42000, paid_amount: 42000, pending_amount: 0, payment_status: 'paid', branch_id: branchIds.downtown },
    { id: '70707070-7070-4070-8070-707070707070', staff_id: staffIds.joseph, month, base_salary: 26500, bonus: 500, deductions: 0, net_salary: 27000, paid_amount: 0, pending_amount: 27000, payment_status: 'pending', branch_id: branchIds.downtown },
    { id: '80808080-8080-4080-8080-808080808080', staff_id: staffIds.imran, month, base_salary: 24000, bonus: 0, deductions: 1000, net_salary: 23000, paid_amount: 0, pending_amount: 23000, payment_status: 'pending', branch_id: branchIds.downtown },
  ];

  for (const salary of salaries) await insertRow(client, schema, 'salaries', salary);

  return insertedCustomers;
};

const seedInventory = async (client, schema) => {
  const suppliers = [
    { name: 'FreshMart Distributors', mobile: '9888800001', email: 'freshmart@example.test', address: 'Wholesale Market Yard', gst_number: '29FRESH1234F1Z1', credit_limit: 250000, current_balance: 68000, branch_id: branchIds.downtown, is_active: true, is_deleted: false },
    { name: 'Metro FMCG Supply', mobile: '9888800002', email: 'metro-fmcg@example.test', address: 'Industrial Area Phase 2', gst_number: '29METRO1234F1Z8', credit_limit: 180000, current_balance: 24500, branch_id: branchIds.downtown, is_active: true, is_deleted: false },
    { name: 'BrightLite Electricals', mobile: '9888800003', email: 'orders@brightlite.example.test', address: 'SP Road Bengaluru', gst_number: '29BRITE1234F1Z3', credit_limit: 160000, current_balance: 39000, branch_id: branchIds.downtown, is_active: true, is_deleted: false },
    { name: 'Travel Retail Supply Co', mobile: '9888800004', email: 'airport@travelretail.example.test', address: 'Airport Cargo Road', gst_number: '29TRAVL1234F1Z2', credit_limit: 220000, current_balance: 72500, branch_id: branchIds.downtown, is_active: true, is_deleted: false },
    { name: 'Warehouse Bulk Traders', mobile: '9888800005', email: 'dispatch@bulktraders.example.test', address: 'Peenya Industrial Area', gst_number: '29BULKT1234F1Z5', credit_limit: 500000, current_balance: 158000, branch_id: branchIds.downtown, is_active: true, is_deleted: false },
  ];

  const insertedSuppliers = [];
  for (const supplier of suppliers) insertedSuppliers.push(await insertRow(client, schema, 'suppliers', supplier));

  const products = [
    { name: 'Premium Basmati Rice 5kg', category: 'Grocery', is_weight_based: false, selling_price: 690, mrp: 740, purchase_price: 580, hsn_code: '1001', gst_percentage: 5, stock_quantity: 84, company: 'Shakti Foods', barcode: '890100000001', branch_id: branchIds.downtown, time_for_delivery: 2, expiry_date: '2027-03-31' },
    { name: 'Organic Wheat Atta 10kg', category: 'Grocery', is_weight_based: false, selling_price: 520, mrp: 560, purchase_price: 430, hsn_code: '1001', gst_percentage: 5, stock_quantity: 12, company: 'FarmBest', barcode: '890100000002', branch_id: branchIds.downtown, time_for_delivery: 2, expiry_date: '2027-01-15' },
    { name: 'LED Bulb 12W', category: 'Electrical', is_weight_based: false, selling_price: 160, mrp: 199, purchase_price: 105, hsn_code: '9405', gst_percentage: 12, stock_quantity: 5, company: 'BrightLite', barcode: '890100000003', branch_id: branchIds.downtown, time_for_delivery: 4 },
    { name: 'Smartphone Charger Type-C', category: 'Electronics', is_weight_based: false, selling_price: 499, mrp: 699, purchase_price: 310, hsn_code: '8517', gst_percentage: 18, stock_quantity: 42, company: 'VoltEdge', barcode: '890100000004', branch_id: branchIds.downtown, time_for_delivery: 3 },
    { name: 'Loose Sugar', category: 'Grocery', is_weight_based: true, selling_price: 48, mrp: 52, purchase_price: 40, hsn_code: '2106', gst_percentage: 5, stock_quantity: 250.5, company: 'Local Mill', barcode: '890100000005', branch_id: branchIds.downtown, time_for_delivery: 1 },
    { name: 'Cold Pressed Groundnut Oil 1L', category: 'Grocery', is_weight_based: false, selling_price: 260, mrp: 295, purchase_price: 218, hsn_code: '2106', gst_percentage: 5, stock_quantity: 0, company: 'PurePress', barcode: '890100000006', branch_id: branchIds.downtown, time_for_delivery: 5, expiry_date: '2026-12-20' },
    { name: 'Whole Cashew 500g', category: 'Dry Fruits', is_weight_based: false, selling_price: 620, mrp: 690, purchase_price: 510, hsn_code: '0801', gst_percentage: 5, stock_quantity: 34, company: 'NutriGold', barcode: '890100000007', branch_id: branchIds.downtown, time_for_delivery: 3, expiry_date: '2027-05-10' },
    { name: 'Instant Coffee 200g', category: 'Beverages', is_weight_based: false, selling_price: 340, mrp: 399, purchase_price: 260, hsn_code: '2101', gst_percentage: 18, stock_quantity: 18, company: 'BrewDay', barcode: '890100000008', branch_id: branchIds.downtown, time_for_delivery: 2, expiry_date: '2027-02-28' },
    { name: 'Travel Water Bottle 1L', category: 'Travel Essentials', is_weight_based: false, selling_price: 299, mrp: 399, purchase_price: 180, hsn_code: '3924', gst_percentage: 18, stock_quantity: 66, company: 'HydroMate', barcode: '890100000009', branch_id: branchIds.downtown, time_for_delivery: 2 },
    { name: 'Paper Carry Bag Medium', category: 'Packaging', is_weight_based: false, selling_price: 8, mrp: 10, purchase_price: 4, hsn_code: '4819', gst_percentage: 12, stock_quantity: 2000, company: 'EcoPack', barcode: '890100000010', branch_id: branchIds.downtown, time_for_delivery: 1 },
    { name: 'Barcode Label Roll', category: 'Packaging', is_weight_based: false, selling_price: 180, mrp: 220, purchase_price: 120, hsn_code: '4821', gst_percentage: 12, stock_quantity: 140, company: 'LabelWorks', barcode: '890100000011', branch_id: branchIds.downtown, time_for_delivery: 1 },
    { name: 'Bluetooth Receipt Printer', category: 'Hardware', is_weight_based: false, selling_price: 3950, mrp: 4500, purchase_price: 3100, hsn_code: '8443', gst_percentage: 18, stock_quantity: 3, company: 'PrintPro', barcode: '890100000012', branch_id: branchIds.downtown, time_for_delivery: 7 },
    { name: 'Chocolate Gift Box', category: 'Confectionery', is_weight_based: false, selling_price: 450, mrp: 520, purchase_price: 335, hsn_code: '1806', gst_percentage: 18, stock_quantity: 28, company: 'CocoaCraft', barcode: '890100000013', branch_id: branchIds.downtown, time_for_delivery: 4, expiry_date: '2026-11-30' },
    { name: 'Premium Tea 250g', category: 'Beverages', is_weight_based: false, selling_price: 240, mrp: 280, purchase_price: 175, hsn_code: '0902', gst_percentage: 5, stock_quantity: 51, company: 'Nilgiri Leaf', barcode: '890100000014', branch_id: branchIds.downtown, time_for_delivery: 3, expiry_date: '2027-04-15' },
    { name: 'Handwash Refill 1L', category: 'Household', is_weight_based: false, selling_price: 185, mrp: 225, purchase_price: 132, hsn_code: '3401', gst_percentage: 18, stock_quantity: 7, company: 'CleanCo', barcode: '890100000015', branch_id: branchIds.downtown, time_for_delivery: 4 },
    { name: 'Notebook A5 Pack of 5', category: 'Stationery', is_weight_based: false, selling_price: 210, mrp: 250, purchase_price: 150, hsn_code: '4820', gst_percentage: 12, stock_quantity: 0, company: 'PaperTrail', barcode: '890100000016', branch_id: branchIds.downtown, time_for_delivery: 5 },
  ];

  const insertedProducts = [];
  for (const product of products) insertedProducts.push(await insertRow(client, schema, 'products', product));

  for (const product of insertedProducts.filter(Boolean)) {
    const source = products[insertedProducts.indexOf(product)];
    await insertRow(client, schema, 'batches', {
      product_id: product.id,
      branch_id: source.branch_id,
      batch_number: `BATCH-${product.id}-A`,
      expiry_date: source.expiry_date,
      purchase_price: source.purchase_price,
      selling_price: source.selling_price,
      mrp: source.mrp,
      quantity: source.stock_quantity,
      quantity_remaining: source.stock_quantity,
      sync_version: 1,
      is_deleted: false,
    });
  }

  return {
    suppliers: insertedSuppliers.map((supplier, index) => supplier && { ...suppliers[index], ...supplier }),
    products: insertedProducts.map((product, index) => product && { ...products[index], ...product }),
  };
};

const seedOrders = async (client, schema, customers, products, suppliers) => {
  const daysAgo = (days) => new Date(Date.now() - days * 24 * 3600_000);
  const usableCustomers = customers.filter(Boolean);
  const usableProducts = products.filter(Boolean);
  const usableSuppliers = suppliers.filter(Boolean);

  const orderSpecs = [
    { customer: 0, branch_id: branchIds.downtown, user_id: 1, total_paid: 20000, status: 'completed', payment_mode: 'credit', days: 1, location: 'Downtown Hub', billing_type: 'wholesale', items: [[0, 20], [1, 18], [4, 50]] },
    { customer: 1, branch_id: branchIds.downtown, user_id: 3, status: 'completed', payment_mode: 'online', days: 3, location: 'Downtown Hub', billing_type: 'retail', items: [[2, 6], [13, 4]] },
    { customer: 2, branch_id: branchIds.downtown, user_id: 4, total_paid: 10000, status: 'pending', payment_mode: 'credit', days: 8, location: 'Downtown Hub', billing_type: 'wholesale', items: [[3, 48], [12, 18], [14, 24]] },
    { customer: 3, branch_id: branchIds.downtown, user_id: 2, status: 'completed', payment_mode: 'cash', days: 14, location: 'Downtown Hub', billing_type: 'retail', items: [[0, 1], [4, 10]] },
    { customer: 4, branch_id: branchIds.downtown, user_id: 5, total_paid: 25000, status: 'completed', payment_mode: 'bank', days: 2, location: 'Downtown Hub', billing_type: 'wholesale', items: [[6, 24], [7, 36], [8, 50]] },
    { customer: 5, branch_id: branchIds.downtown, user_id: 2, status: 'completed', payment_mode: 'online', days: 4, location: 'Downtown Hub', billing_type: 'retail', items: [[1, 2], [4, 5], [13, 1]] },
    { customer: 6, branch_id: branchIds.downtown, user_id: 3, total_paid: 5000, status: 'pending', payment_mode: 'credit', days: 6, location: 'Downtown Hub', billing_type: 'wholesale', items: [[0, 8], [13, 20], [15, 12]] },
    { customer: 7, branch_id: branchIds.downtown, user_id: 4, total_paid: 30000, status: 'completed', payment_mode: 'bank', days: 9, location: 'Downtown Hub', billing_type: 'wholesale', items: [[7, 25], [12, 40], [14, 30]] },
    { customer: 8, branch_id: branchIds.downtown, user_id: 5, status: 'completed', payment_mode: 'online', days: 10, location: 'Downtown Hub', billing_type: 'retail', items: [[6, 1], [8, 2], [7, 1]] },
    { customer: 9, branch_id: branchIds.downtown, user_id: 6, total_paid: 65000, status: 'pending', payment_mode: 'credit', days: 12, location: 'Downtown Hub', billing_type: 'wholesale', items: [[9, 500], [10, 60], [11, 2]] },
    { customer: 3, branch_id: branchIds.downtown, user_id: 4, status: 'completed', payment_mode: 'cash', days: 16, location: 'Downtown Hub', billing_type: 'retail', items: [[12, 2], [14, 3]] },
    { customer: 0, branch_id: branchIds.downtown, user_id: 1, total_paid: 18000, status: 'completed', payment_mode: 'online', days: 21, location: 'Downtown Hub', billing_type: 'wholesale', items: [[0, 15], [4, 75], [9, 250]] },
  ];

  for (const spec of orderSpecs) {
    const customer = usableCustomers[spec.customer];
    const orderTotal = Math.round(spec.items.reduce((sum, [productIndex, quantity]) => {
      const product = products[productIndex];
      return sum + Number(product?.selling_price || 0) * Number(quantity || 0);
    }, 0));
    const paidAmount = spec.total_paid ?? orderTotal;
    const order = await insertRow(client, schema, 'orders', {
      user_id: spec.user_id || 1,
      customer_id: customer?.id,
      customer_phone: customer?.mobile,
      branch_id: spec.branch_id,
      total_price: orderTotal,
      total_paid: paidAmount,
      order_status: spec.status,
      transaction_type: 'sale',
      billing_type: spec.billing_type,
      location: spec.location,
      customer_name_snapshot: customer?.name,
      customer_mobile_snapshot: customer?.mobile,
      source_channel: 'dev-seed',
      currency: 'INR',
      subtotal_minor: Math.round(orderTotal * 100),
      discount_minor: 0,
      tax_minor: 0,
      total_minor: Math.round(orderTotal * 100),
      completed_at: spec.status === 'completed' ? specDate(daysAgo(spec.days)) : null,
      created_at: daysAgo(spec.days),
      updated_at: daysAgo(spec.days),
      payment_mode: spec.payment_mode,
      is_gst_enabled: true,
      gst_mode: 'INCLUSIVE',
      notes: 'Development seed order',
    });

    if (!order) continue;
    let totalProfit = 0;
    let lineNo = 1;
    for (const [productIndex, quantity] of spec.items) {
      const product = usableProducts[productIndex];
      if (!product) continue;
      const productRow = products[productIndex];
      const salePrice = productRow?.selling_price || 0;
      const purchasePrice = productRow?.purchase_price || 0;
      const profit = (salePrice - purchasePrice) * quantity;
      totalProfit += profit;
      await insertRow(client, schema, 'order_items', {
        order_id: order.id,
        product_id: product.id,
        quantity,
        selling_price: salePrice,
        purchase_price_snapshot: purchasePrice,
        discount_amount: 0,
        gst_percent: productRow?.gst_percentage || 0,
        line_no: lineNo,
        product_name_snapshot: productRow?.name,
        barcode_snapshot: productRow?.barcode,
        quantity_milli: Math.round(quantity * 1000),
        unit_price_minor: Math.round(salePrice * 100),
        source_discount_minor: 0,
        taxable_minor: Math.round(salePrice * quantity * 100),
        gst_rate_bps: Math.round((productRow?.gst_percentage || 0) * 100),
        tax_minor: 0,
        line_total_minor: Math.round(salePrice * quantity * 100),
        tax_code: productRow?.hsn_code,
        profit,
        margin_percent: salePrice ? ((salePrice - purchasePrice) / salePrice) * 100 : 0,
      });
      lineNo += 1;
    }

    await insertRow(client, schema, 'transactions', {
      order_id: order.id,
      total_price: paidAmount,
      profit: totalProfit,
      payment_mode: spec.payment_mode,
      amount: paidAmount,
      party_type: 'customer',
      party_id: customer?.id,
      direction: 'in',
      txn_type: 'sale_payment',
      notes: 'Payment from development seed',
      branch_id: spec.branch_id,
      created_at: daysAgo(spec.days),
    });
  }

  const purchaseSpecs = [
    { supplier: 0, branch_id: branchIds.downtown, invoice_number: 'PUR-DEV-001', total_paid: 30000, days: 5, payment_mode: 'bank', items: [[0, 100], [1, 60], [4, 400]] },
    { supplier: 1, branch_id: branchIds.downtown, invoice_number: 'PUR-DEV-002', total_paid: 18000, days: 7, payment_mode: 'bank', items: [[2, 80], [13, 120], [15, 90]] },
    { supplier: 2, branch_id: branchIds.downtown, invoice_number: 'PUR-DEV-003', total_paid: 25000, days: 11, payment_mode: 'online', items: [[3, 50], [12, 80], [14, 60]] },
    { supplier: 3, branch_id: branchIds.downtown, invoice_number: 'PUR-DEV-004', total_paid: 42000, days: 4, payment_mode: 'bank', items: [[6, 75], [7, 90], [8, 150]] },
    { supplier: 4, branch_id: branchIds.downtown, invoice_number: 'PUR-DEV-005', total_paid: 90000, days: 13, payment_mode: 'bank', items: [[9, 3000], [10, 250], [11, 8]] },
  ];

  for (const spec of purchaseSpecs) {
    const supplier = usableSuppliers[spec.supplier];
    if (!supplier) continue;
    const purchaseTotal = Math.round(spec.items.reduce((sum, [productIndex, quantity]) => {
      const product = products[productIndex];
      return sum + Number(product?.purchase_price || 0) * Number(quantity || 0);
    }, 0));

    const purchaseOrder = await insertRow(client, schema, 'orders', {
      user_id: 1,
      supplier_id: supplier.id,
      branch_id: spec.branch_id,
      total_price: purchaseTotal,
      total_paid: spec.total_paid,
      order_status: 'completed',
      transaction_type: 'purchase',
      billing_type: 'purchase',
      location: Object.entries(branchIds).find(([, id]) => id === spec.branch_id)?.[0] || 'Branch',
      source_channel: 'dev-seed',
      invoice_number: spec.invoice_number,
      created_at: daysAgo(spec.days),
      updated_at: daysAgo(spec.days),
      payment_mode: spec.payment_mode,
      is_gst_enabled: true,
      gst_mode: 'INCLUSIVE',
      notes: 'Development seed purchase order',
    });

    if (!purchaseOrder) continue;
    let lineNo = 1;
    for (const [productIndex, quantity] of spec.items) {
      const product = usableProducts[productIndex];
      const productRow = products[productIndex];
      if (!product) continue;
      await insertRow(client, schema, 'order_items', {
        order_id: purchaseOrder.id,
        product_id: product.id,
        quantity,
        selling_price: productRow?.selling_price || 0,
        purchase_price_snapshot: productRow?.purchase_price || 0,
        gst_percent: productRow?.gst_percentage || 0,
        line_no: lineNo,
        product_name_snapshot: productRow?.name,
        barcode_snapshot: productRow?.barcode,
        quantity_milli: Math.round(quantity * 1000),
        unit_price_minor: Math.round(Number(productRow?.purchase_price || 0) * 100),
        taxable_minor: Math.round(Number(productRow?.purchase_price || 0) * quantity * 100),
        gst_rate_bps: Math.round(Number(productRow?.gst_percentage || 0) * 100),
        tax_minor: 0,
        line_total_minor: Math.round(Number(productRow?.purchase_price || 0) * quantity * 100),
        tax_code: productRow?.hsn_code,
        profit: 0,
      });
      lineNo += 1;
    }
  }
};

const specDate = (date) => date;

const seedExpensesAndAccounting = async (client, schema) => {
  const expenses = [
    { type: 'operating', name: 'Downtown Store Rent', amount: 45000, description: 'Monthly rent for Downtown branch', category: 'Rent', staff_id: staffIds.anita, payment_method: 'bank', notes: 'Auto debit', date: new Date(), branch_id: branchIds.downtown },
    { type: 'operating', name: 'Electricity Bill', amount: 8200, description: 'Power usage across Downtown counters', category: 'Utilities', staff_id: staffIds.rahul, payment_method: 'online', notes: 'Includes POS counters', date: new Date(Date.now() - 2 * 24 * 3600_000), branch_id: branchIds.downtown },
    { type: 'staff', name: 'Cashier Sales Incentive', amount: 3000, description: 'Weekly sales incentive', category: 'Staff', staff_id: staffIds.meera, payment_method: 'cash', notes: 'Approved by owner', date: new Date(Date.now() - 5 * 24 * 3600_000), branch_id: branchIds.downtown },
    { type: 'staff', name: 'Rahul Counter Incentive', amount: 2500, description: 'POS counter sales incentive', category: 'Incentive', staff_id: staffIds.rahul, payment_method: 'cash', notes: 'Downtown Hub weekly target', date: new Date(Date.now() - 4 * 24 * 3600_000), branch_id: branchIds.downtown },
    { type: 'staff', name: 'Anita Travel Reimbursement', amount: 1800, description: 'Store operations travel claim', category: 'Reimbursement', staff_id: staffIds.anita, payment_method: 'online', notes: 'Branch audit visit', date: new Date(Date.now() - 7 * 24 * 3600_000), branch_id: branchIds.downtown },
    { type: 'procurement', name: 'Downtown Packaging Material', amount: 5600, description: 'Carry bags and labels', category: 'Supplies', payment_method: 'cash', notes: 'Single POS store stock', date: new Date(Date.now() - 9 * 24 * 3600_000), branch_id: branchIds.downtown },
    { type: 'operating', name: 'Downtown License Fee', amount: 36000, description: 'Monthly retail counter operating fee', category: 'Rent', staff_id: staffIds.vikram, payment_method: 'bank', notes: 'Retail operating charge', date: new Date(Date.now() - 1 * 24 * 3600_000), branch_id: branchIds.downtown },
    { type: 'operating', name: 'Loading Labour', amount: 12800, description: 'Temporary loading support for bulk dispatch', category: 'Labour', staff_id: staffIds.sana, payment_method: 'cash', notes: 'Two-day dispatch support', date: new Date(Date.now() - 3 * 24 * 3600_000), branch_id: branchIds.downtown },
    { type: 'marketing', name: 'Weekend Promotion', amount: 18500, description: 'Digital and in-store campaign', category: 'Marketing', staff_id: staffIds.kavya, payment_method: 'online', notes: 'Weekend chocolate bundle campaign', date: new Date(Date.now() - 6 * 24 * 3600_000), branch_id: branchIds.downtown },
    { type: 'operating', name: 'Generator Diesel', amount: 7400, description: 'Backup power fuel', category: 'Utilities', staff_id: staffIds.meera, payment_method: 'cash', notes: 'Monsoon outage buffer', date: new Date(Date.now() - 8 * 24 * 3600_000), branch_id: branchIds.downtown },
    { type: 'procurement', name: 'Barcode Labels', amount: 9200, description: 'Label stock for inbound batches', category: 'Inventory', staff_id: staffIds.joseph, payment_method: 'bank', notes: 'Bulk label roll refill', date: new Date(Date.now() - 11 * 24 * 3600_000), branch_id: branchIds.downtown },
    { type: 'staff', name: 'Late Shift Allowance', amount: 4500, description: 'Late shift allowance', category: 'Staff', staff_id: staffIds.vikram, payment_method: 'cash', notes: 'Holiday weekend shift', date: new Date(Date.now() - 13 * 24 * 3600_000), branch_id: branchIds.downtown },
    { type: 'staff', name: 'Dispatch Meal Allowance', amount: 1200, description: 'Late dispatch meal allowance', category: 'Allowance', staff_id: staffIds.joseph, payment_method: 'cash', notes: 'Bulk dispatch support', date: new Date(Date.now() - 15 * 24 * 3600_000), branch_id: branchIds.downtown },
  ];

  for (const expense of expenses) await insertRow(client, schema, 'expenses', expense);

  if (!tableExists(schema, 'ledgers') || !tableExists(schema, 'ledger_entries')) return;

  const ledgerResult = await client.query(
    `SELECT id FROM ledgers WHERE name = ANY($1::text[]) ORDER BY name`,
    [['Bank Account', 'Cash in Hand', 'Operating Expenses', 'Sales Revenue']]
  );

  for (const ledger of ledgerResult.rows) {
    await insertRow(client, schema, 'ledger_entries', {
      ledger_id: ledger.id,
      debit: 1000,
      credit: 0,
      reference_type: 'expense',
      description: 'Development seed opening/activity balance',
      date: new Date(),
      branch_id: branchIds.downtown,
      sync_status: 'SYNCED',
      source_event_key: `dev-seed-ledger-${ledger.id}`,
      line_no: 1,
      party_type: 'expense',
    });
  }
};

const seedTaxAndCompliance = async (client, schema) => {
  const hsnRows = [
    { hsn_code: '9405', gst_percentage: 12, description: 'Lighting products' },
    { hsn_code: '3004', gst_percentage: 12, description: 'Medicaments' },
    { hsn_code: '8517', gst_percentage: 18, description: 'Mobile phones' },
    { hsn_code: '2106', gst_percentage: 18, description: 'Food preparations' },
    { hsn_code: '1001', gst_percentage: 5, description: 'Wheat and grains' },
    { hsn_code: '0801', gst_percentage: 5, description: 'Cashew nuts and dry fruits' },
    { hsn_code: '0902', gst_percentage: 5, description: 'Tea' },
    { hsn_code: '1806', gst_percentage: 18, description: 'Chocolate and cocoa products' },
    { hsn_code: '3401', gst_percentage: 18, description: 'Soap and cleaning preparations' },
    { hsn_code: '3924', gst_percentage: 18, description: 'Plastic household and travel articles' },
    { hsn_code: '4819', gst_percentage: 12, description: 'Paper bags and packaging' },
    { hsn_code: '4820', gst_percentage: 12, description: 'Notebooks and stationery' },
    { hsn_code: '4821', gst_percentage: 12, description: 'Paper labels' },
    { hsn_code: '8443', gst_percentage: 18, description: 'Printers and printing machinery' },
  ];
  for (const row of hsnRows) await insertRow(client, schema, 'hsn_gst', row, null);
};

const resolveTenant = async () => {
  const tenantId = process.env.DEV_SEED_TENANT_ID || process.env.POS_SYNC_TENANT_ID || null;
  const params = [];
  let where = 'WHERE is_active = TRUE';
  if (tenantId) {
    params.push(tenantId);
    where = 'WHERE id::text = $1';
  }

  const result = await masterPool.query(
    `SELECT id, shop_name, owner_name, email, mobile, database_name, gst_mode
     FROM tenants
     ${where}
     ORDER BY id ASC
     LIMIT 1`,
    params
  );

  const tenant = result.rows[0];
  if (!tenant?.database_name) {
    throw new Error(
      tenantId
        ? `No tenant found for DEV_SEED_TENANT_ID/POS_SYNC_TENANT_ID=${tenantId}.`
        : 'No active tenant with a database_name was found in the master database.'
    );
  }
  return tenant;
};

const main = async () => {
  assertDevOnly();

  const tenant = await ensureDevTenantLoginDomain(await resolveTenant());
  const tenantPool = getTenantPool(tenant.database_name);
  const client = await tenantPool.connect();

  try {
    await client.query('BEGIN');
    const tables = await loadTables(client);
    await truncateTenantData(client, tables);
    const schema = await loadSchema(client);

    await seedSettings(client, schema, tenant);
    await seedSystemLedgers(client, schema);
    await seedBranches(client, schema);
    await seedUsers(client, schema);
    const customers = await seedPeople(client, schema);
    const { suppliers, products } = await seedInventory(client, schema);
    await seedOrders(client, schema, customers, products, suppliers);
    await seedExpensesAndAccounting(client, schema);
    await seedTaxAndCompliance(client, schema);

    await client.query('COMMIT');

    console.log(`Development data initialized for tenant "${tenant.shop_name}" (${tenant.database_name}).`);
    console.log(`Logins: owner@demo.test, finance@demo.test, manager@demo.test, cashier@demo.test, inventory@demo.test, returns@demo.test, purchase@demo.test / ${DEFAULT_PASSWORD}`);
    console.log(`Single POS: ${singlePosProfile.name}=localhost:${singlePosProfile.frontendPort}->${singlePosProfile.store_number}/${singlePosProfile.terminal_id}/${singlePosProfile.touchpoint_id} (${singlePosProfile.device_id})`);
    console.log(`Reset ${tables.length} tenant tables and inserted 1 branch, 1 POS device, 1 claimed POS registration, 7 users, 10 customers, 8 staff, 5 suppliers, 16 products, 12 sales orders, 5 purchase orders, payments, expenses, settings, and compliance seeds.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await closeAllTenantPools();
    await masterPool.end();
  }
};

main().catch(async (error) => {
  console.error(error.message || error);
  try {
    await closeAllTenantPools();
    await masterPool.end();
  } catch (_) {
    // Ignore cleanup failures after a seed failure.
  }
  process.exit(1);
});

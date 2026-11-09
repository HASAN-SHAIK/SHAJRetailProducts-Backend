require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const hashToken = (value) => crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');

async function seed() {
  const pool = new Pool({
    connectionString: process.env.TENANT_DATABASE_URL_TEMPLATE
      ? process.env.TENANT_DATABASE_URL_TEMPLATE.replace('{db}', 'shaj_tenant_1774793939848')
      : 'postgresql://postgres:postgres@localhost:5432/shaj_tenant_1774793939848',
  });

  const client = await pool.connect();

  try {
    console.log('--- Starting Test Data Seeding ---');
    await client.query('BEGIN');

    // 1. Branches
    const branch1Id = '598e91ca-0460-4b95-8002-59aa26601dfb';
    const branch2Id = '22222222-2222-4222-8222-222222222222';

    await client.query(`
      UPDATE branches 
      SET store_number = 'STORE-001', 
          name = 'Mattampally Branch', 
          location = 'Main Bazaar, Mattampally',
          max_devices_allowed = 4, 
          is_active = true 
      WHERE id = $1
    `, [branch1Id]);

    await client.query(`
      INSERT INTO branches (id, name, location, store_number, subscription_plan, max_devices_allowed, is_active)
      VALUES ($1, 'Downtown Retail Store', 'MG Road Commercial Hub', 'STORE-002', 'premium', 4, true)
      ON CONFLICT (id) DO UPDATE 
      SET name = EXCLUDED.name, 
          location = EXCLUDED.location, 
          store_number = EXCLUDED.store_number, 
          is_active = true
    `, [branch2Id]);
    console.log('✅ Branches seeded.');

    // 2. Users (Password: Password@123)
    const passwordHash = bcrypt.hashSync('Password@123', 10);

    const testUsers = [
      { name: 'Admin User', email: 'admin@ameena.com', role: 'admin', branch_id: null, all_branch: true },
      { name: 'Hasan Admin', email: 'hasan@ameena.com', role: 'admin', branch_id: null, all_branch: true },
      { name: 'Store Manager', email: 'manager@ameena.com', role: 'admin', branch_id: branch1Id, all_branch: true },
      { name: 'Cashier Staff', email: 'cashier@ameena.com', role: 'staff', branch_id: branch1Id, all_branch: false },
      { name: 'Downtown Cashier', email: 'downtown.cashier@ameena.com', role: 'staff', branch_id: branch2Id, all_branch: false }
    ];

    for (const u of testUsers) {
      await client.query(`
        INSERT INTO users (name, email, password, role, branch_id, all_branch_access)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (email) DO UPDATE 
        SET name = EXCLUDED.name,
            password = EXCLUDED.password,
            role = EXCLUDED.role,
            branch_id = EXCLUDED.branch_id,
            all_branch_access = EXCLUDED.all_branch_access
      `, [u.name, u.email, passwordHash, u.role, u.branch_id, u.all_branch]);
    }
    console.log('✅ Users seeded.');

    // 3. Registered POS Devices
    await client.query(`
      INSERT INTO branch_devices (branch_id, device_id, device_name, store_number, pos_no, touchpoint_id, is_active, browser_info, os_info)
      VALUES 
        ($1, 'POS-TERM-001', 'Counter 1 Main POS', 'STORE-001', 'POS-01', 'TP-01', true, 'Chrome 128', 'Windows 11 Pro'),
        ($1, 'POS-TERM-002', 'Counter 2 Express POS', 'STORE-001', 'POS-02', 'TP-02', true, 'Chrome 128', 'Windows 11 Pro'),
        ($2, 'POS-TERM-003', 'Downtown Main Counter', 'STORE-002', 'POS-01', 'TP-01', true, 'Chrome 128', 'Windows 11 Pro')
      ON CONFLICT (branch_id, device_id) DO UPDATE 
      SET device_name = EXCLUDED.device_name,
          store_number = EXCLUDED.store_number,
          pos_no = EXCLUDED.pos_no,
          touchpoint_id = EXCLUDED.touchpoint_id,
          is_active = true
    `, [branch1Id, branch2Id]);
    console.log('✅ POS devices registered.');

    // 4. POS Setup Code for easy activation (Tenant 1 -> 31)
    const testSetupCode = '31.TEST2026';
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    await client.query(`
      CREATE TABLE IF NOT EXISTS pos_registration_requests (
        request_id TEXT PRIMARY KEY, device_id TEXT NOT NULL, installation_id TEXT, device_name TEXT, os_info TEXT,
        request_token_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', branch_id TEXT, terminal_id TEXT,
        store_number TEXT, pos_no TEXT, touchpoint_id TEXT, requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reviewed_at TIMESTAMPTZ, reviewed_by TEXT, claimed_at TIMESTAMPTZ,
        setup_code_hash TEXT, setup_code_expires_at TIMESTAMPTZ,
        CONSTRAINT pos_registration_status_check CHECK (status IN ('PENDING','APPROVED','REJECTED','CLAIMED'))
      )
    `);

    await client.query(`
      INSERT INTO pos_registration_requests 
        (request_id, device_id, device_name, request_token_hash, setup_code_hash, setup_code_expires_at, status, branch_id, store_number, pos_no, touchpoint_id, terminal_id)
      VALUES 
        ('posreg_test_setup_01', 'setup_code_terminal_01', 'Pre-configured Setup Terminal', $1, $2, $3, 'PENDING', $4, 'STORE-001', 'POS-03', 'TP-03', 'POS-03')
      ON CONFLICT (request_id) DO UPDATE 
      SET setup_code_hash = EXCLUDED.setup_code_hash,
          setup_code_expires_at = EXCLUDED.setup_code_expires_at,
          status = 'PENDING'
    `, [hashToken('test_token'), hashToken(testSetupCode), expiresAt, branch1Id]);
    console.log(`✅ POS Setup Code seeded: ${testSetupCode}`);

    // 5. Staff Profiles
    const staffIds = [
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    ];

    await client.query(`
      INSERT INTO staff (id, name, phone, role, salary, join_date, status, branch_id)
      VALUES 
        ($1, 'Kavitha Sharma', '9876543220', 'Store Manager', 35000, '2025-01-15', 'active', $5),
        ($2, 'Ramesh Babu', '9876543221', 'Head Cashier', 22000, '2025-03-01', 'active', $5),
        ($3, 'Suresh Kumar', '9876543222', 'Inventory Clerk', 18000, '2025-06-10', 'active', $5),
        ($4, 'Pooja Verma', '9876543223', 'Sales Associate', 16000, '2025-08-20', 'active', $6)
      ON CONFLICT (id) DO UPDATE 
      SET name = EXCLUDED.name,
          phone = EXCLUDED.phone,
          salary = EXCLUDED.salary,
          status = EXCLUDED.status,
          branch_id = EXCLUDED.branch_id
    `, [staffIds[0], staffIds[1], staffIds[2], staffIds[3], branch1Id, branch2Id]);
    console.log('✅ Staff profiles seeded.');

    // 6. Salaries
    await client.query(`
      INSERT INTO salaries (id, staff_id, month, base_salary, bonus, deductions, net_salary, paid_amount, pending_amount, payment_status, branch_id)
      VALUES 
        (gen_random_uuid(), $1::uuid, '2026-10', 35000, 2000, 0, 37000, 37000, 0, 'PAID', $4::uuid),
        (gen_random_uuid(), $2::uuid, '2026-10', 22000, 1000, 500, 22500, 22500, 0, 'PAID', $4::uuid),
        (gen_random_uuid(), $3::uuid, '2026-10', 18000, 500, 0, 18500, 18500, 0, 'PAID', $4::uuid),
        (gen_random_uuid(), $1::uuid, '2026-11', 35000, 0, 0, 35000, 0, 35000, 'PENDING', $4::uuid),
        (gen_random_uuid(), $2::uuid, '2026-11', 22000, 0, 0, 22000, 0, 22000, 'PENDING', $4::uuid)
    `, [staffIds[0], staffIds[1], staffIds[2], branch1Id]);
    console.log('✅ Salaries seeded.');

    // 7. Customers
    // First, sync phone column for existing customers
    await client.query(`UPDATE customers SET phone = mobile WHERE phone IS NULL OR phone = ''`);

    // Insert rich customers
    await client.query(`
      INSERT INTO customers (name, phone, mobile, type, email, shop_name, gst_number, credit_limit, current_balance, address, location, notes, is_active)
      VALUES 
        ('Rajesh Kumar (Wholesale Auto)', '9876543210', '9876543210', 'wholesale', 'rajesh.motors@gmail.com', 'Rajesh Motors & Spares', '36ABCDE1234F1Z5', 75000, 18450, 'Plot 45, Auto Nagar', 'Hyderabad', 'High volume buyer, 15 days credit terms', true),
        ('Priya Sharma (Retail)', '9876543211', '9876543211', 'retail', 'priya.sharma@yahoo.com', NULL, NULL, 15000, 2400, 'H.No 3-45/1, Near Temple', 'Mattampally', 'Regular local customer', true),
        ('Sri Sai Krishna Automobiles', '9876543212', '9876543212', 'wholesale', 'srikrishna.auto@gmail.com', 'Sri Sai Krishna Automobiles', '36VWXYZ5678K2Z9', 120000, 42800, 'Main Road, Huzurnagar', 'Suryapet', 'Major dealer in two-wheeler parts', true),
        ('Mohammed Imran', '9876543213', '9876543213', 'retail', 'imran.auto@outlook.com', NULL, NULL, 20000, 5600, 'Opp. Bus Station', 'Mattampally', 'Prompt payments', true),
        ('Kavitha Reddy', '9876543214', '9876543214', 'retail', 'kavitha.reddy@gmail.com', NULL, NULL, 10000, 0, 'Street 5, Gandhi Nagar', 'Mattampally', 'Cash on delivery preferred', true)
      ON CONFLICT DO NOTHING
    `);
    console.log('✅ Customers seeded.');

    // 8. Customer Reminders
    const custRes = await client.query(`SELECT id, phone, current_balance FROM customers WHERE current_balance > 0 LIMIT 3`);
    if (custRes.rowCount > 0) {
      await client.query(`DELETE FROM customer_reminders WHERE message_text LIKE '%Test Automated Reminder%'`);
      for (const c of custRes.rows) {
        await client.query(`
          INSERT INTO customer_reminders (customer_id, branch_id, recipient_phone, amount, channel, message_text, upi_link, status, sent_at)
          VALUES ($1, $2, $3, $4, 'sms', $5, $6, 'SENT', NOW() - INTERVAL '1 day')
        `, [
          c.id,
          branch1Id,
          c.phone || '9876543210',
          c.current_balance,
          `Dear customer, friendly reminder from Ameena Auto: your outstanding balance is INR ${c.current_balance}. Test Automated Reminder.`,
          `upi://pay?pa=ameena@upi&pn=AmeenaAuto&am=${c.current_balance}&cu=INR`
        ]);
      }
      console.log('✅ Customer reminders seeded.');
    }

    // 9. Cashier Shifts
    const userRes = await client.query(`SELECT id FROM users WHERE email = 'cashier@ameena.com' LIMIT 1`);
    const cashierId = userRes.rows[0]?.id || 1;

    await client.query(`
      INSERT INTO cashier_shifts (id, branch_id, user_id, cashier_name, terminal_id, shift_start, shift_end, opening_cash, expected_cash, declared_cash, variance, status, notes)
      VALUES 
        (gen_random_uuid(), $1, $2, 'Cashier Staff', 'POS-01', NOW() - INTERVAL '1 day 8 hours', NOW() - INTERVAL '1 day', 2000, 16800, 16800, 0, 'CLOSED', 'Regular evening shift reconciliation'),
        (gen_random_uuid(), $1, $2, 'Cashier Staff', 'POS-01', NOW() - INTERVAL '3 hours', NULL, 3000, 9450, 0, 0, 'OPEN', 'Morning shift currently active')
    `, [branch1Id, cashierId]);
    console.log('✅ Cashier shifts seeded.');

    // 10. Expenses
    await client.query(`
      INSERT INTO expenses (id, type, name, amount, description, date, branch_id, category, payment_method, notes)
      VALUES 
        (gen_random_uuid(), 'operational', 'Store Rent - November', 15000, 'Monthly store building rent', CURRENT_DATE - 2, $1, 'Rent', 'bank_transfer', 'Paid to landlord account'),
        (gen_random_uuid(), 'utilities', 'Electricity Bill', 3450, 'TSSPDCL Commercial Power Bill', CURRENT_DATE - 1, $1, 'Utilities', 'upi', 'Paid via PhonePe'),
        (gen_random_uuid(), 'supplies', 'Packing & Bubble Wrap', 1200, 'Packaging materials for retail dispatch', CURRENT_DATE, $1, 'Supplies', 'cash', 'Purchased from local market'),
        (gen_random_uuid(), 'hospitality', 'Daily Staff Refreshments', 380, 'Tea, coffee and snacks for counter staff', CURRENT_DATE, $1, 'Food & Beverage', 'cash', 'Daily allowance'),
        (gen_random_uuid(), 'maintenance', 'Air Conditioner Servicing', 1800, 'Annual servicing and filter replacement', CURRENT_DATE - 3, $1, 'Maintenance', 'upi', 'Technician service charges'),
        (gen_random_uuid(), 'marketing', 'Festival Promotional Pamphlets', 2500, 'Diwali & festive season discount leaflets', CURRENT_DATE - 4, $2, 'Marketing', 'cash', 'Distributed locally')
    `, [branch1Id, branch2Id]);
    console.log('✅ Expenses seeded.');

    // 11. Refresh date on a sample of orders so today has recent order activity
    await client.query(`
      UPDATE orders 
      SET created_at = NOW() - (INTERVAL '1 hour' * (id % 12))
      WHERE id IN (SELECT id FROM orders ORDER BY id DESC LIMIT 15)
    `);
    console.log('✅ Recent orders refreshed with current timestamps.');

    await client.query('COMMIT');
    console.log('🎉 All test data successfully committed!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seeding failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});

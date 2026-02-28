require('dotenv').config();
const bcrypt = require('bcryptjs');
const masterPool = require('../src/db/masterPool');

const run = async () => {
  const email = process.env.ADMIN_SEED_EMAIL;
  const password = process.env.ADMIN_SEED_PASSWORD;
  const name = process.env.ADMIN_SEED_NAME || 'Platform Admin';
  const role = process.env.ADMIN_SEED_ROLE || 'platform_admin';

  if (!email || !password) {
    console.error('ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD are required.');
    process.exit(1);
  }

  const existing = await masterPool.query(
    'SELECT id FROM platform_admins WHERE email = $1',
    [email]
  );
  if (existing.rowCount > 0) {
    console.log('Admin already exists. No action taken.');
    process.exit(0);
  }

  const hashed = await bcrypt.hash(password, 10);
  const result = await masterPool.query(
    'INSERT INTO platform_admins (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, email',
    [name, email, hashed, role]
  );

  console.log(`Admin created: id=${result.rows[0].id}, email=${result.rows[0].email}`);
  process.exit(0);
};

run().catch((err) => {
  console.error('Failed to seed admin:', err);
  process.exit(1);
});

require('dotenv').config();
const bcrypt = require('bcryptjs');
const masterPool = require('../src/db/masterPool');
const { resolvePlatformAdminSeedConfig } = require('../src/security/platformAdminSeedPolicy');

const run = async () => {
  const { email, password, name, role } = resolvePlatformAdminSeedConfig();

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
    'INSERT INTO platform_admins (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id',
    [name, email, hashed, role]
  );

  console.log(`Platform admin created: id=${result.rows[0].id}`);
  process.exit(0);
};

run().catch((err) => {
  console.error(`Failed to seed platform admin: ${err?.message || 'unknown error'}`);
  process.exit(1);
});

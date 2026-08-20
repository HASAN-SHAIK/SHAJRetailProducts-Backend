const ALLOWED_PLATFORM_ADMIN_ROLES = new Set(['platform_admin', 'super_admin']);
const MIN_PLATFORM_ADMIN_PASSWORD_LENGTH = 12;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UNSAFE_PASSWORDS = new Set([
  'admin',
  'admin123',
  'changeme',
  'password',
  'password123',
  'platformadmin',
]);

const resolvePlatformAdminSeedConfig = ({ env = process.env } = {}) => {
  const email = String(env.ADMIN_SEED_EMAIL || '').trim().toLowerCase();
  const password = String(env.ADMIN_SEED_PASSWORD || '');
  const name = String(env.ADMIN_SEED_NAME || 'Platform Admin').trim();
  const role = String(env.ADMIN_SEED_ROLE || 'platform_admin').trim();

  if (!email || !password) {
    throw new Error('ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD are required');
  }
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error('ADMIN_SEED_EMAIL must be a valid email address');
  }
  if (password.length < MIN_PLATFORM_ADMIN_PASSWORD_LENGTH) {
    throw new Error(
      `ADMIN_SEED_PASSWORD must be at least ${MIN_PLATFORM_ADMIN_PASSWORD_LENGTH} characters`
    );
  }
  if (UNSAFE_PASSWORDS.has(password.trim().toLowerCase())) {
    throw new Error('ADMIN_SEED_PASSWORD is not allowed to use a known unsafe default');
  }
  if (!name || name.length > 120) {
    throw new Error('ADMIN_SEED_NAME must be between 1 and 120 characters');
  }
  if (!ALLOWED_PLATFORM_ADMIN_ROLES.has(role)) {
    throw new Error('ADMIN_SEED_ROLE must be platform_admin or super_admin');
  }

  return { email, password, name, role };
};

module.exports = {
  ALLOWED_PLATFORM_ADMIN_ROLES,
  MIN_PLATFORM_ADMIN_PASSWORD_LENGTH,
  resolvePlatformAdminSeedConfig,
};

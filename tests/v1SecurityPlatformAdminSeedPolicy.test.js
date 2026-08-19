const {
  MIN_PLATFORM_ADMIN_PASSWORD_LENGTH,
  resolvePlatformAdminSeedConfig,
} = require('../src/security/platformAdminSeedPolicy');

describe('V1 platform admin seed policy', () => {
  test('requires explicit email and password', () => {
    expect(() => resolvePlatformAdminSeedConfig({ env: {} })).toThrow(
      'ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD are required'
    );
  });

  test('rejects malformed email, weak password, and unsupported role', () => {
    expect(() =>
      resolvePlatformAdminSeedConfig({
        env: {
          ADMIN_SEED_EMAIL: 'not-an-email',
          ADMIN_SEED_PASSWORD: 'very-strong-password',
        },
      })
    ).toThrow('ADMIN_SEED_EMAIL must be a valid email address');

    expect(() =>
      resolvePlatformAdminSeedConfig({
        env: {
          ADMIN_SEED_EMAIL: 'admin@example.com',
          ADMIN_SEED_PASSWORD: 'short',
        },
      })
    ).toThrow(`ADMIN_SEED_PASSWORD must be at least ${MIN_PLATFORM_ADMIN_PASSWORD_LENGTH} characters`);

    expect(() =>
      resolvePlatformAdminSeedConfig({
        env: {
          ADMIN_SEED_EMAIL: 'admin@example.com',
          ADMIN_SEED_PASSWORD: 'correct-horse-battery-staple',
          ADMIN_SEED_ROLE: 'tenant_admin',
        },
      })
    ).toThrow('ADMIN_SEED_ROLE must be platform_admin or super_admin');
  });

  test('rejects known unsafe defaults even when long enough', () => {
    expect(() =>
      resolvePlatformAdminSeedConfig({
        env: {
          ADMIN_SEED_EMAIL: 'admin@example.com',
          ADMIN_SEED_PASSWORD: 'platformadmin',
        },
      })
    ).toThrow('ADMIN_SEED_PASSWORD is not allowed to use a known unsafe default');
  });

  test('normalizes a valid seed config and preserves only supported roles', () => {
    expect(
      resolvePlatformAdminSeedConfig({
        env: {
          ADMIN_SEED_EMAIL: '  ADMIN@Example.COM ',
          ADMIN_SEED_PASSWORD: 'correct-horse-battery-staple',
          ADMIN_SEED_NAME: '  Operations Admin  ',
          ADMIN_SEED_ROLE: 'super_admin',
        },
      })
    ).toEqual({
      email: 'admin@example.com',
      password: 'correct-horse-battery-staple',
      name: 'Operations Admin',
      role: 'super_admin',
    });
  });
});

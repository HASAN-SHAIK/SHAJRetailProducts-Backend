const fs = require('fs');
const path = require('path');
const { resolveDatabaseSslConfig } = require('../src/security/databaseTlsPolicy');

describe('V1 database TLS policy', () => {
  test('keeps TLS disabled when DB_SSL is not enabled', () => {
    expect(resolveDatabaseSslConfig({ NODE_ENV: 'production', DB_SSL: 'false' })).toBe(false);
    expect(resolveDatabaseSslConfig({ NODE_ENV: 'production' })).toBe(false);
  });

  test('verifies PostgreSQL certificates by default whenever TLS is enabled', () => {
    expect(resolveDatabaseSslConfig({ NODE_ENV: 'production', DB_SSL: 'true' })).toEqual({
      rejectUnauthorized: true,
    });
  });

  test('fails closed when production attempts to disable certificate verification', () => {
    expect(() =>
      resolveDatabaseSslConfig({
        NODE_ENV: 'production',
        DB_SSL: 'true',
        DB_SSL_REJECT_UNAUTHORIZED: 'false',
      })
    ).toThrow(expect.objectContaining({ code: 'INSECURE_DB_TLS_NOT_ALLOWED' }));
  });

  test('allows explicitly insecure TLS only outside production for local compatibility', () => {
    expect(
      resolveDatabaseSslConfig({
        NODE_ENV: 'development',
        DB_SSL: 'true',
        DB_SSL_REJECT_UNAUTHORIZED: 'false',
      })
    ).toEqual({ rejectUnauthorized: false });
  });

  test('supports an explicit CA while preserving certificate verification', () => {
    expect(
      resolveDatabaseSslConfig({
        APP_ENVIRONMENT: 'production',
        DB_SSL: 'true',
        DB_SSL_CA: '-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----',
      })
    ).toEqual({
      rejectUnauthorized: true,
      ca: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----',
    });
  });

  test('rejects malformed TLS booleans instead of silently weakening policy', () => {
    expect(() => resolveDatabaseSslConfig({ DB_SSL: 'sometimes' })).toThrow(
      expect.objectContaining({ code: 'INVALID_DB_TLS_CONFIG' })
    );
  });

  test('master, admin, and tenant runtime pools all use the shared verified TLS policy', () => {
    for (const relativePath of ['src/db/masterPool.js', 'src/db/adminPool.js', 'src/db/tenantPool.js']) {
      const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
      expect(source).toContain('resolveDatabaseSslConfig');
      expect(source).not.toContain('rejectUnauthorized: false');
    }
  });
});

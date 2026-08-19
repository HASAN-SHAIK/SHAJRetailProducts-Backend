const {
  isHealthWarmupAuthorized,
  safeSecretEquals,
} = require('../src/security/healthWarmupKeyPolicy');

describe('V1 health warmup key transport security', () => {
  test('production accepts the configured key only from the dedicated header', () => {
    const base = {
      environment: 'production',
      expectedKey: 'warmup-secret-123',
    };

    expect(isHealthWarmupAuthorized({
      ...base,
      headerKey: 'warmup-secret-123',
      queryKey: undefined,
    })).toBe(true);

    expect(isHealthWarmupAuthorized({
      ...base,
      headerKey: undefined,
      queryKey: 'warmup-secret-123',
    })).toBe(false);
  });

  test('non-production keeps query compatibility without overriding a supplied header', () => {
    const base = {
      environment: 'development',
      expectedKey: 'warmup-secret-123',
    };

    expect(isHealthWarmupAuthorized({
      ...base,
      headerKey: undefined,
      queryKey: 'warmup-secret-123',
    })).toBe(true);

    expect(isHealthWarmupAuthorized({
      ...base,
      headerKey: 'wrong-key',
      queryKey: 'warmup-secret-123',
    })).toBe(false);
  });

  test('missing configuration and mismatched keys fail closed', () => {
    expect(isHealthWarmupAuthorized({
      environment: 'production',
      expectedKey: undefined,
      headerKey: 'anything',
    })).toBe(false);

    expect(safeSecretEquals('warmup-secret-123', 'warmup-secret-124')).toBe(false);
    expect(safeSecretEquals('warmup-secret-123', 'short')).toBe(false);
  });
});

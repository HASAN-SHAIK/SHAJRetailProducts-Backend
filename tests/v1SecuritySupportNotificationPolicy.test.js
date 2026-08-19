const {
  DEFAULT_NON_PRODUCTION_INTAKE_EMAIL,
  resolveSupportIntakeEmail,
} = require('../src/security/supportNotificationPolicy');

describe('V1 support notification destination policy', () => {
  test('requires an explicit intake destination in production', () => {
    expect(() =>
      resolveSupportIntakeEmail({
        environment: 'production',
        env: {},
      })
    ).toThrow('SUPPORT_CASE_INTAKE_EMAIL is required in production');
  });

  test('accepts an explicit production intake destination', () => {
    expect(
      resolveSupportIntakeEmail({
        environment: 'production',
        env: { SUPPORT_CASE_INTAKE_EMAIL: 'support@example.com' },
      })
    ).toBe('support@example.com');
  });

  test('rejects malformed configured destinations', () => {
    expect(() =>
      resolveSupportIntakeEmail({
        environment: 'production',
        env: { SUPPORT_CASE_INTAKE_EMAIL: 'not-an-email' },
      })
    ).toThrow('SUPPORT_CASE_INTAKE_EMAIL must be a valid email address');
  });

  test('retains the existing convenience fallback only outside production', () => {
    expect(
      resolveSupportIntakeEmail({
        environment: 'development',
        env: {},
      })
    ).toBe(DEFAULT_NON_PRODUCTION_INTAKE_EMAIL);
  });
});

const { logStartupFailure } = require('../src/security/startupFailurePolicy');

describe('V1 production startup failure log hygiene', () => {
  test('production startup failures do not emit raw infrastructure error details', () => {
    const logger = { error: jest.fn() };
    const error = new Error('connect ECONNREFUSED postgres://admin:supersecret@db.internal:5432/master');

    logStartupFailure({ environment: 'production', error, logger });

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('Failed to start server: INTERNAL_STARTUP_ERROR');
    const rendered = JSON.stringify(logger.error.mock.calls);
    expect(rendered).not.toContain('supersecret');
    expect(rendered).not.toContain('postgres://');
    expect(rendered).not.toContain('db.internal');
    expect(rendered).not.toContain('ECONNREFUSED');
  });

  test('non-production retains bounded developer-visible message detail', () => {
    const logger = { error: jest.fn() };
    const error = new Error('local bootstrap failed');

    logStartupFailure({ environment: 'development', error, logger });

    expect(logger.error).toHaveBeenCalledWith('Failed to start server:', 'local bootstrap failed');
  });
});

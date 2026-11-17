const { signupProtectionMiddleware } = require('./signupProtectionMiddleware');

const makeReq = ({ body = {}, headers = {}, ip = '127.0.0.1' } = {}) => ({
  body,
  headers,
  ip,
  connection: { remoteAddress: ip },
});

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('signupProtectionMiddleware', () => {
  const origEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...origEnv };
  });

  afterAll(() => {
    process.env = origEnv;
  });

  test('bypasses check when SIGNUP_PROTECTION_ENABLED is not true', async () => {
    process.env.SIGNUP_PROTECTION_ENABLED = 'false';
    const req = makeReq({ body: {} });
    const res = makeRes();
    const next = jest.fn();

    await signupProtectionMiddleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('rejects with CAPTCHA_REQUIRED when enabled and token is missing', async () => {
    process.env.SIGNUP_PROTECTION_ENABLED = 'true';
    const req = makeReq({ body: {} });
    const res = makeRes();
    const next = jest.fn();

    await signupProtectionMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CAPTCHA_REQUIRED' })
    );
  });

  test('allows bypass-test-token in test environment', async () => {
    process.env.SIGNUP_PROTECTION_ENABLED = 'true';
    process.env.NODE_ENV = 'test';
    const req = makeReq({ body: { captcha_token: 'bypass-test-token' } });
    const res = makeRes();
    const next = jest.fn();

    await signupProtectionMiddleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('accepts token from x-captcha-token header', async () => {
    process.env.SIGNUP_PROTECTION_ENABLED = 'true';
    process.env.NODE_ENV = 'test';
    const req = makeReq({ headers: { 'x-captcha-token': 'bypass-test-token' } });
    const res = makeRes();
    const next = jest.fn();

    await signupProtectionMiddleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

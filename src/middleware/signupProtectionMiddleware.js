const https = require('https');

/**
 * Verifies a CAPTCHA token against Cloudflare Turnstile, Google reCAPTCHA, or hCaptcha.
 */
const verifyCaptchaRemote = async ({ provider, secret, token, remoteIp }) => {
  let url = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
  if (provider === 'recaptcha') {
    url = 'https://www.google.com/recaptcha/api/siteverify';
  } else if (provider === 'hcaptcha') {
    url = 'https://api.hcaptcha.com/siteverify';
  }

  const payload = new URLSearchParams();
  payload.append('secret', secret);
  payload.append('response', token);
  if (remoteIp) {
    payload.append('remoteip', remoteIp);
  }

  if (typeof fetch === 'function') {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payload.toString(),
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({}));
    return Boolean(data.success);
  }

  // Fallback to https.request if fetch is not globally present
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const bodyStr = payload.toString();
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            const data = JSON.parse(raw);
            resolve(Boolean(data.success));
          } catch {
            resolve(false);
          }
        });
      }
    );
    req.on('error', () => resolve(false));
    req.write(bodyStr);
    req.end();
  });
};

/**
 * Pluggable signup protection middleware for tenant onboarding.
 *
 * Config via environment:
 * - SIGNUP_PROTECTION_ENABLED: 'true' to enforce, otherwise bypassed.
 * - SIGNUP_CAPTCHA_PROVIDER: 'turnstile' (default), 'recaptcha', or 'hcaptcha'.
 * - SIGNUP_CAPTCHA_SECRET or TURNSTILE_SECRET_KEY or RECAPTCHA_SECRET_KEY: Secret key from provider.
 */
const signupProtectionMiddleware = async (req, res, next) => {
  const isEnabled = String(process.env.SIGNUP_PROTECTION_ENABLED || '').toLowerCase() === 'true';
  if (!isEnabled) {
    return next();
  }

  const token = req.body?.captcha_token || req.headers['x-captcha-token'];
  if (!token || typeof token !== 'string' || !token.trim()) {
    return res.status(400).json({
      success: false,
      code: 'CAPTCHA_REQUIRED',
      message: 'Security verification token is required to create a new company.',
    });
  }

  const trimmedToken = token.trim();
  const nodeEnv = process.env.NODE_ENV || 'development';

  // Allow test/bypass token in non-production environments
  if ((nodeEnv === 'test' || nodeEnv === 'development') && trimmedToken === 'bypass-test-token') {
    return next();
  }

  const provider = (process.env.SIGNUP_CAPTCHA_PROVIDER || 'turnstile').toLowerCase();
  const secret =
    process.env.SIGNUP_CAPTCHA_SECRET ||
    process.env.TURNSTILE_SECRET_KEY ||
    process.env.RECAPTCHA_SECRET_KEY ||
    '';

  if (!secret) {
    // If enabled but no secret is configured, fail closed in production, warn in development
    if (nodeEnv === 'production') {
      return res.status(503).json({
        success: false,
        code: 'CAPTCHA_CONFIG_ERROR',
        message: 'Signup security verification is misconfigured.',
      });
    }
    return next();
  }

  const clientIp = req.ip || req.connection?.remoteAddress;
  const isValid = await verifyCaptchaRemote({
    provider,
    secret,
    token: trimmedToken,
    remoteIp: clientIp,
  });

  if (!isValid) {
    return res.status(400).json({
      success: false,
      code: 'CAPTCHA_VERIFICATION_FAILED',
      message: 'Security verification failed. Please complete the security check and try again.',
    });
  }

  return next();
};

module.exports = {
  signupProtectionMiddleware,
  verifyCaptchaRemote,
};

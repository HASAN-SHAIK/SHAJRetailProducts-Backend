const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { normalizePrivateKeyPem } = require('./pem');

describe('PEM normalization', () => {
  let privateKey;
  let publicKey;

  beforeAll(() => {
    const pair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
  });

  test('preserves multiline PEM private keys', () => {
    expect(normalizePrivateKeyPem(privateKey)).toBe(privateKey.trim());
  });

  test('wraps base64 DER private keys so RS256 signing can use them', () => {
    const derBody = privateKey
      .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');

    const normalized = normalizePrivateKeyPem(derBody);
    const token = jwt.sign({ sub: 'user-1' }, normalized, { algorithm: 'RS256' });

    expect(normalized).toContain('-----BEGIN PRIVATE KEY-----');
    expect(jwt.verify(token, publicKey, { algorithms: ['RS256'] })).toMatchObject({ sub: 'user-1' });
  });
});

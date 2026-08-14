const wrapPemBody = (value) => String(value || '').replace(/\s+/g, '').match(/.{1,64}/g)?.join('\n') || '';

const normalizePrivateKeyPem = (value) => {
  const normalized = String(value || '').trim().replace(/\\n/g, '\n');
  if (!normalized) return '';
  if (normalized.includes('-----BEGIN ')) return normalized;
  return `-----BEGIN PRIVATE KEY-----\n${wrapPemBody(normalized)}\n-----END PRIVATE KEY-----`;
};

module.exports = { normalizePrivateKeyPem };

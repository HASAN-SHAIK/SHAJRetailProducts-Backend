const { CATALOG_BY_KEY } = require('./catalog');

const SCOPE_TYPES = new Set(['tenant', 'branch', 'device']);

const errorWithStatus = (status, code, message) => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
};

const normalizeScopeType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!SCOPE_TYPES.has(normalized)) {
    throw errorWithStatus(400, 'INVALID_CONFIG_SCOPE', 'scope_type must be tenant, branch, or device');
  }
  return normalized;
};

const coerceBoolean = (value, key) => {
  if (value === true || value === false) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw errorWithStatus(400, 'INVALID_CONFIG_VALUE', `${key} must be a boolean`);
};

const validateSettingValue = (key, value) => {
  const meta = CATALOG_BY_KEY.get(key);
  if (!meta) throw errorWithStatus(400, 'UNKNOWN_CONFIG_KEY', `Unknown configuration key: ${key}`);

  if (meta.type === 'boolean') return coerceBoolean(value, key);
  if (meta.type === 'string') {
    if (typeof value !== 'string') throw errorWithStatus(400, 'INVALID_CONFIG_VALUE', `${key} must be a string`);
    return value;
  }
  if (meta.type === 'string_array') {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      throw errorWithStatus(400, 'INVALID_CONFIG_VALUE', `${key} must be an array of strings`);
    }
    return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
  }
  if (meta.type === 'enum') {
    const normalized = typeof value === 'string' ? value.trim() : value;
    if (!meta.values.includes(normalized)) {
      throw errorWithStatus(400, 'INVALID_CONFIG_VALUE', `${key} must be one of: ${meta.values.join(', ')}`);
    }
    return normalized;
  }
  if (meta.type === 'enum_number') {
    const numeric = Number(value);
    if (!meta.values.includes(numeric)) {
      throw errorWithStatus(400, 'INVALID_CONFIG_VALUE', `${key} must be one of: ${meta.values.join(', ')}`);
    }
    return numeric;
  }
  if (meta.type === 'integer' || meta.type === 'number') {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || (meta.type === 'integer' && !Number.isInteger(numeric))) {
      throw errorWithStatus(400, 'INVALID_CONFIG_VALUE', `${key} must be a ${meta.type}`);
    }
    if (meta.min !== undefined && numeric < meta.min) throw errorWithStatus(400, 'INVALID_CONFIG_VALUE', `${key} must be >= ${meta.min}`);
    if (meta.max !== undefined && numeric > meta.max) throw errorWithStatus(400, 'INVALID_CONFIG_VALUE', `${key} must be <= ${meta.max}`);
    return numeric;
  }
  return value;
};

const setNested = (target, path, value) => {
  const parts = path.split('.');
  let cursor = target;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) cursor[part] = value;
    else {
      cursor[part] = cursor[part] && typeof cursor[part] === 'object' ? cursor[part] : {};
      cursor = cursor[part];
    }
  });
};

const buildNestedConfig = (values) => {
  const nested = {};
  Object.entries(values || {}).forEach(([key, value]) => setNested(nested, key, value));
  return nested;
};

const mergeLayers = (layers) => {
  const values = {};
  const sources = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer.values || {})) {
      values[key] = value;
      sources[key] = {
        scope_type: layer.scopeType,
        scope_id: layer.scopeId,
        revision: layer.revisions?.[key] ?? null,
      };
    }
  }
  return { values, sources };
};

module.exports = {
  errorWithStatus,
  normalizeScopeType,
  validateSettingValue,
  buildNestedConfig,
  mergeLayers,
};

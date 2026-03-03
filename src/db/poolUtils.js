const normalizePassword = (value, label) => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  throw new Error(`${label} must be a string. Got ${typeof value}. Check your .env or config.`);
};

const getEnvPassword = (primary, fallback, label) => {
  const value = primary ?? fallback;
  return normalizePassword(value, label);
};

const toOptionalNumber = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const getPoolTuning = (prefix) => {
  const read = (key) => process.env[`${prefix}_${key}`] ?? process.env[`DB_${key}`];
  const max = toOptionalNumber(read('POOL_MAX'));
  const idleTimeoutMillis = toOptionalNumber(read('POOL_IDLE_TIMEOUT_MS'));
  const connectionTimeoutMillis = toOptionalNumber(read('POOL_CONN_TIMEOUT_MS'));
  const keepAlive = read('POOL_KEEP_ALIVE');
  const keepAliveInitialDelayMillis = toOptionalNumber(read('POOL_KEEP_ALIVE_DELAY_MS'));

  const config = {};
  if (max !== undefined) config.max = max;
  if (idleTimeoutMillis !== undefined) config.idleTimeoutMillis = idleTimeoutMillis;
  if (connectionTimeoutMillis !== undefined) config.connectionTimeoutMillis = connectionTimeoutMillis;
  if (keepAlive !== undefined) config.keepAlive = keepAlive === 'true';
  if (keepAliveInitialDelayMillis !== undefined) {
    config.keepAliveInitialDelayMillis = keepAliveInitialDelayMillis;
  }
  return config;
};

const attachQueryTimer = (pool, label = 'db') => {
  if (!pool || pool.__timed) return pool;

  const enabled =
    process.env.DB_LOG_TIMING === 'true' ||
    (process.env.NODE_ENV !== 'production' && process.env.DB_LOG_TIMING !== 'false');

  if (!enabled) {
    return pool;
  }

  const connectTimingEnabled = process.env.DB_LOG_CONNECT_TIMING === 'true';
  const thresholdMs = Number(process.env.DB_LOG_TIMING_THRESHOLD_MS || 0);
  const originalQuery = pool.query.bind(pool);
  const originalConnect = pool.connect.bind(pool);

  const formatQueryText = (args) => {
    const first = args?.[0];
    let text = '';
    if (typeof first === 'string') {
      text = first;
    } else if (first && typeof first === 'object' && typeof first.text === 'string') {
      text = first.text;
    }

    if (!text) return '';
    const singleLine = text.replace(/\s+/g, ' ').trim();
    const maxLen = Number(process.env.DB_LOG_TIMING_QUERY_MAX_LEN || 200);
    if (singleLine.length <= maxLen) return singleLine;
    return `${singleLine.slice(0, maxLen)}…`;
  };

  pool.query = async (...args) => {
    const start = process.hrtime.bigint();
    try {
      return await originalQuery(...args);
    } finally {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      if (durationMs >= thresholdMs) {
        const queryText = formatQueryText(args);
        const suffix = queryText ? ` | ${queryText}` : '';
        console.log(`[DB] ${label} query took ${durationMs.toFixed(1)}ms${suffix}`);
      }
    }
  };

  if (connectTimingEnabled) {
    pool.connect = async (...args) => {
      const start = process.hrtime.bigint();
      const client = await originalConnect(...args);
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      console.log(`[DB] ${label} connect took ${durationMs.toFixed(1)}ms`);
      return client;
    };
  }

  pool.__timed = true;
  return pool;
};

module.exports = { normalizePassword, getEnvPassword, getPoolTuning, attachQueryTimer };

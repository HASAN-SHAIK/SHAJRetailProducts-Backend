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

const attachQueryTimer = (pool, label = 'db') => {
  if (!pool || pool.__timed) return pool;

  const enabled =
    process.env.DB_LOG_TIMING === 'true' ||
    (process.env.NODE_ENV !== 'production' && process.env.DB_LOG_TIMING !== 'false');

  if (!enabled) {
    return pool;
  }

  const thresholdMs = Number(process.env.DB_LOG_TIMING_THRESHOLD_MS || 0);
  const originalQuery = pool.query.bind(pool);

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

  pool.__timed = true;
  return pool;
};

module.exports = { normalizePassword, getEnvPassword, attachQueryTimer };

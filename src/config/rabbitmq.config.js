const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
};

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const resolveEnvironment = (env) => env.APP_ENVIRONMENT || env.NODE_ENV || 'development';

const buildRabbitmqConfig = (env = process.env) => {
  const environment = resolveEnvironment(env);
  const enabled = toBoolean(env.RABBITMQ_SYNC_ENABLED, false);
  const configuredUrl = String(env.RABBITMQ_URL || '').trim();

  if (enabled && environment === 'production') {
    if (!configuredUrl) {
      throw new Error('RABBITMQ_URL is required when RabbitMQ sync is enabled in production.');
    }
    if (/^amqps?:\/\/guest:guest@/i.test(configuredUrl)) {
      throw new Error('RabbitMQ guest credentials are not allowed in production.');
    }
  }

  return Object.freeze({
    enabled,
    url: configuredUrl || 'amqp://guest:guest@localhost:5672',
    prefetch: toNumber(env.RABBITMQ_PREFETCH, 10),
    maxRetries: toNumber(env.RABBITMQ_SYNC_MAX_RETRIES, 5),
    retryDelayMs: toNumber(env.RABBITMQ_SYNC_RETRY_DELAY_MS, 30_000),
    exchanges: {
      main: env.RABBITMQ_SYNC_EXCHANGE || 'shaj.sync',
      retry: env.RABBITMQ_SYNC_RETRY_EXCHANGE || 'shaj.sync.retry',
      dlx: env.RABBITMQ_SYNC_DLX_EXCHANGE || 'shaj.sync.dlx',
    },
    queues: {
      operations: env.RABBITMQ_SYNC_QUEUE || 'shaj.sync.operations',
      retry: env.RABBITMQ_SYNC_RETRY_QUEUE || 'shaj.sync.retry',
      dlq: env.RABBITMQ_SYNC_DLQ || 'shaj.sync.dlq',
    },
    routingKeys: {
      operation: env.RABBITMQ_SYNC_ROUTING_KEY || 'sync.operation',
      retry: 'retry',
      dead: 'dead',
    },
  });
};

const rabbitmqConfig = buildRabbitmqConfig();

module.exports = { rabbitmqConfig, buildRabbitmqConfig, toBoolean, toNumber };

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
};

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const rabbitmqConfig = Object.freeze({
  enabled: toBoolean(process.env.RABBITMQ_SYNC_ENABLED, false),
  url: process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
  prefetch: toNumber(process.env.RABBITMQ_PREFETCH, 10),
  maxRetries: toNumber(process.env.RABBITMQ_SYNC_MAX_RETRIES, 5),
  retryDelayMs: toNumber(process.env.RABBITMQ_SYNC_RETRY_DELAY_MS, 30_000),
  exchanges: {
    main: process.env.RABBITMQ_SYNC_EXCHANGE || 'shaj.sync',
    retry: process.env.RABBITMQ_SYNC_RETRY_EXCHANGE || 'shaj.sync.retry',
    dlx: process.env.RABBITMQ_SYNC_DLX_EXCHANGE || 'shaj.sync.dlx',
  },
  queues: {
    operations: process.env.RABBITMQ_SYNC_QUEUE || 'shaj.sync.operations',
    retry: process.env.RABBITMQ_SYNC_RETRY_QUEUE || 'shaj.sync.retry',
    dlq: process.env.RABBITMQ_SYNC_DLQ || 'shaj.sync.dlq',
  },
  routingKeys: {
    operation: process.env.RABBITMQ_SYNC_ROUTING_KEY || 'sync.operation',
    retry: 'retry',
    dead: 'dead',
  },
});

module.exports = { rabbitmqConfig, toBoolean, toNumber };

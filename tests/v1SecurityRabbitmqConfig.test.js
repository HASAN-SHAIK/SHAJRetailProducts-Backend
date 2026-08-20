const { buildRabbitmqConfig } = require('../src/config/rabbitmq.config');

describe('V1 production RabbitMQ secret boundary', () => {
  test('disabled production messaging does not require a RabbitMQ URL', () => {
    const config = buildRabbitmqConfig({
      APP_ENVIRONMENT: 'production',
      RABBITMQ_SYNC_ENABLED: 'false',
    });
    expect(config.enabled).toBe(false);
  });

  test('enabled production messaging requires an explicit RabbitMQ URL', () => {
    expect(() => buildRabbitmqConfig({
      APP_ENVIRONMENT: 'production',
      RABBITMQ_SYNC_ENABLED: 'true',
    })).toThrow('RABBITMQ_URL is required when RabbitMQ sync is enabled in production.');
  });

  test('enabled production messaging rejects embedded guest credentials', () => {
    expect(() => buildRabbitmqConfig({
      APP_ENVIRONMENT: 'production',
      RABBITMQ_SYNC_ENABLED: 'true',
      RABBITMQ_URL: 'amqp://guest:guest@rabbitmq.internal:5672',
    })).toThrow('RabbitMQ guest credentials are not allowed in production.');
  });

  test('enabled production messaging accepts an explicitly configured non-guest URL', () => {
    const config = buildRabbitmqConfig({
      APP_ENVIRONMENT: 'production',
      RABBITMQ_SYNC_ENABLED: 'true',
      RABBITMQ_URL: 'amqps://shaj_sync:opaque-secret@rabbitmq.internal:5671/v1',
    });
    expect(config.enabled).toBe(true);
    expect(config.url).toBe('amqps://shaj_sync:opaque-secret@rabbitmq.internal:5671/v1');
  });

  test('development keeps the local guest fallback for explicitly non-production use', () => {
    const config = buildRabbitmqConfig({
      APP_ENVIRONMENT: 'development',
      RABBITMQ_SYNC_ENABLED: 'true',
    });
    expect(config.url).toBe('amqp://guest:guest@localhost:5672');
  });
});

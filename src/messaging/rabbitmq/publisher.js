const { rabbitmqConfig } = require('../../config/rabbitmq.config');
const { getRabbitChannel } = require('./connection');
const { assertTopology } = require('./topology');
const { syncLogger } = require('../sync/syncLogger');
const { recordPublished } = require('../sync/syncMetrics');

const publishSyncEvent = async (event = {}) => {
  if (!rabbitmqConfig.enabled) {
    return { published: false, reason: 'rabbitmq_disabled' };
  }

  await assertTopology();
  const channel = await getRabbitChannel();
  if (!channel) {
    return { published: false, reason: 'channel_unavailable' };
  }

  const messageId = event.clientId || event.operationId;
  const orderingKey =
    event.orderingKey ||
    `${event.tenantId || 'tenant'}:${event.module || 'general'}:${event.entityType || 'entity'}:${event.entityId || messageId}`;

  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      ...event,
      orderingKey,
      publishedAt: new Date().toISOString(),
    })
  );

  const published = channel.publish(
    rabbitmqConfig.exchanges.main,
    rabbitmqConfig.routingKeys.operation,
    payload,
    {
      persistent: true,
      contentType: 'application/json',
      messageId,
      headers: {
        'x-ordering-key': orderingKey,
        'x-tenant-id': event.tenantId || '',
        'x-module': event.module || '',
        'x-retry-count': 0,
      },
    }
  );

  if (published) {
    recordPublished({ module: event.module, action: event.action });
    syncLogger.info('sync_event_published', {
      messageId,
      module: event.module,
      entityType: event.entityType,
      action: event.action,
      orderingKey,
    });
  } else {
    syncLogger.warn('sync_event_publish_buffer_full', { messageId });
  }

  return { published, messageId, orderingKey };
};

const publishRetryEvent = async (event = {}, retryCount = 1) => {
  if (!rabbitmqConfig.enabled) return { published: false, reason: 'rabbitmq_disabled' };
  await assertTopology();
  const channel = await getRabbitChannel();
  if (!channel) return { published: false, reason: 'channel_unavailable' };

  const messageId = event.clientId || event.operationId;
  const payload = Buffer.from(JSON.stringify({ version: 1, ...event, retryCount }));
  const published = channel.publish(
    rabbitmqConfig.exchanges.retry,
    rabbitmqConfig.routingKeys.retry,
    payload,
    {
      persistent: true,
      contentType: 'application/json',
      messageId,
      headers: {
        'x-retry-count': retryCount,
        'x-ordering-key': event.orderingKey || '',
      },
    }
  );

  if (published) {
    syncLogger.info('sync_event_retry_scheduled', { messageId, retryCount });
  }
  return { published, retryCount };
};

const publishDeadLetterEvent = async (event = {}, reason = 'max_retries') => {
  if (!rabbitmqConfig.enabled) return { published: false, reason: 'rabbitmq_disabled' };
  await assertTopology();
  const channel = await getRabbitChannel();
  if (!channel) return { published: false, reason: 'channel_unavailable' };

  const messageId = event.clientId || event.operationId;
  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      ...event,
      deadLetterReason: reason,
      deadLetteredAt: new Date().toISOString(),
    })
  );

  channel.publish(rabbitmqConfig.exchanges.dlx, rabbitmqConfig.routingKeys.dead, payload, {
    persistent: true,
    contentType: 'application/json',
    messageId,
    headers: {
      'x-dead-letter-reason': reason,
    },
  });

  syncLogger.error('sync_event_dead_lettered', { messageId, reason });
  return { published: true, reason };
};

module.exports = {
  publishSyncEvent,
  publishRetryEvent,
  publishDeadLetterEvent,
};

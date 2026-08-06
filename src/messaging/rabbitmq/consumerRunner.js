const { rabbitmqConfig } = require('../../config/rabbitmq.config');
const { getRabbitChannel } = require('../rabbitmq/connection');
const { assertTopology } = require('../rabbitmq/topology');
const {
  processSyncEventInOrder,
  handleConsumerFailure,
} = require('../sync/syncOperation.service');
const { syncLogger } = require('../sync/syncLogger');

let consumerTag = null;
let dlqConsumerTag = null;

const parseMessage = (message) => {
  const content = message.content?.toString('utf8');
  if (!content) return null;
  return JSON.parse(content);
};

const getRetryCount = (message) => {
  const headerCount = message.properties?.headers?.['x-retry-count'];
  const parsed = Number(headerCount);
  return Number.isFinite(parsed) ? parsed : 0;
};

const startSyncConsumer = async () => {
  if (!rabbitmqConfig.enabled) {
    syncLogger.info('sync_consumer_disabled');
    return { started: false, reason: 'rabbitmq_disabled' };
  }

  await assertTopology();
  const channel = await getRabbitChannel();
  if (!channel) {
    return { started: false, reason: 'channel_unavailable' };
  }

  if (consumerTag) {
    return { started: true, reason: 'already_running', consumerTag };
  }

  const operationsConsume = await channel.consume(
    rabbitmqConfig.queues.operations,
    async (message) => {
      if (!message) return;
      const retryCount = getRetryCount(message);
      let event = null;

      try {
        event = parseMessage(message);
        if (!event) {
          channel.nack(message, false, false);
          return;
        }

        await processSyncEventInOrder(event);
        channel.ack(message);
      } catch (error) {
        syncLogger.error('sync_consumer_processing_failed', {
          error: error.message,
          code: error.code,
          clientId: event?.clientId,
          retryCount,
        });

        try {
          await handleConsumerFailure(event || {}, error, retryCount);
        } catch (failureError) {
          syncLogger.error('sync_consumer_failure_handler_error', {
            error: failureError.message,
          });
        }

        channel.ack(message);
      }
    },
    { noAck: false }
  );
  consumerTag = operationsConsume.consumerTag;

  const dlqConsume = await channel.consume(
    rabbitmqConfig.queues.dlq,
    (message) => {
      if (!message) return;
      try {
        const event = parseMessage(message);
        syncLogger.error('sync_dlq_message_received', {
          clientId: event?.clientId,
          module: event?.module,
          reason: event?.deadLetterReason || message.properties?.headers?.['x-dead-letter-reason'],
        });
      } catch (error) {
        syncLogger.error('sync_dlq_parse_failed', { error: error.message });
      } finally {
        channel.ack(message);
      }
    },
    { noAck: false }
  );
  dlqConsumerTag = dlqConsume.consumerTag;

  syncLogger.info('sync_consumer_started', {
    queue: rabbitmqConfig.queues.operations,
    dlq: rabbitmqConfig.queues.dlq,
    consumerTag,
  });

  return { started: true, consumerTag, dlqConsumerTag };
};

const stopSyncConsumer = async () => {
  const channel = await getRabbitChannel();
  if (!channel) return;
  if (consumerTag) {
    await channel.cancel(consumerTag);
    consumerTag = null;
  }
  if (dlqConsumerTag) {
    await channel.cancel(dlqConsumerTag);
    dlqConsumerTag = null;
  }
};

module.exports = {
  startSyncConsumer,
  stopSyncConsumer,
};

const { rabbitmqConfig } = require('../../config/rabbitmq.config');
const { getRabbitChannel } = require('./connection');
const { syncLogger } = require('../sync/syncLogger');

let topologyReady = false;

const assertTopology = async () => {
  if (!rabbitmqConfig.enabled) return false;
  if (topologyReady) return true;

  const channel = await getRabbitChannel();
  if (!channel) return false;

  const { exchanges, queues, routingKeys, retryDelayMs } = rabbitmqConfig;

  await channel.assertExchange(exchanges.main, 'topic', { durable: true });
  await channel.assertExchange(exchanges.retry, 'direct', { durable: true });
  await channel.assertExchange(exchanges.dlx, 'direct', { durable: true });

  await channel.assertQueue(queues.dlq, {
    durable: true,
    arguments: {
      'x-queue-type': 'classic',
    },
  });
  await channel.bindQueue(queues.dlq, exchanges.dlx, routingKeys.dead);

  await channel.assertQueue(queues.retry, {
    durable: true,
    arguments: {
      'x-message-ttl': retryDelayMs,
      'x-dead-letter-exchange': exchanges.main,
      'x-dead-letter-routing-key': routingKeys.operation,
    },
  });
  await channel.bindQueue(queues.retry, exchanges.retry, routingKeys.retry);

  await channel.assertQueue(queues.operations, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': exchanges.dlx,
      'x-dead-letter-routing-key': routingKeys.dead,
    },
  });
  await channel.bindQueue(queues.operations, exchanges.main, routingKeys.operation);

  topologyReady = true;
  syncLogger.info('rabbitmq_topology_ready', {
    exchange: exchanges.main,
    queue: queues.operations,
    dlq: queues.dlq,
  });
  return true;
};

module.exports = {
  assertTopology,
};

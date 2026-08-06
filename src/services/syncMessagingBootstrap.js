const { rabbitmqConfig } = require('../config/rabbitmq.config');
const { connectRabbitMq, closeRabbitMq } = require('../messaging/rabbitmq/connection');
const { assertTopology } = require('../messaging/rabbitmq/topology');
const { startSyncConsumer, stopSyncConsumer } = require('../messaging/rabbitmq/consumerRunner');
const { syncLogger } = require('../messaging/sync/syncLogger');

let started = false;

const startSyncMessaging = async () => {
  if (started) return { started: true, reason: 'already_started' };
  if (!rabbitmqConfig.enabled) {
    syncLogger.info('sync_messaging_skipped', { reason: 'rabbitmq_disabled' });
    return { started: false, reason: 'rabbitmq_disabled' };
  }

  try {
    await connectRabbitMq();
    await assertTopology();
    const consumer = await startSyncConsumer();
    started = true;
    syncLogger.info('sync_messaging_started', consumer);
    return { started: true, consumer };
  } catch (error) {
    syncLogger.error('sync_messaging_start_failed', { error: error.message });
    return { started: false, reason: error.message };
  }
};

const stopSyncMessaging = async () => {
  await stopSyncConsumer();
  await closeRabbitMq();
  started = false;
};

module.exports = {
  startSyncMessaging,
  stopSyncMessaging,
};

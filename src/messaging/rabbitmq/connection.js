const amqp = require('amqplib');
const { rabbitmqConfig } = require('../../config/rabbitmq.config');
const { syncLogger } = require('../sync/syncLogger');

let connection = null;
let channel = null;
let connectPromise = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const connectRabbitMq = async () => {
  if (!rabbitmqConfig.enabled) return null;
  if (channel) return channel;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    let attempt = 0;
    const maxAttempts = 8;
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        connection = await amqp.connect(rabbitmqConfig.url);
        connection.on('error', (error) => {
          syncLogger.error('rabbitmq_connection_error', { error: error.message });
        });
        connection.on('close', () => {
          syncLogger.warn('rabbitmq_connection_closed');
          connection = null;
          channel = null;
          connectPromise = null;
        });
        channel = await connection.createChannel();
        await channel.prefetch(rabbitmqConfig.prefetch);
        syncLogger.info('rabbitmq_connected', { attempt });
        return channel;
      } catch (error) {
        syncLogger.warn('rabbitmq_connect_retry', {
          attempt,
          error: error.message,
        });
        if (attempt >= maxAttempts) throw error;
        await sleep(Math.min(30_000, 1_000 * 2 ** attempt));
      }
    }
    return null;
  })();

  try {
    return await connectPromise;
  } catch (error) {
    connectPromise = null;
    throw error;
  }
};

const getRabbitChannel = async () => {
  if (!rabbitmqConfig.enabled) return null;
  if (channel) return channel;
  return connectRabbitMq();
};

const closeRabbitMq = async () => {
  try {
    if (channel) await channel.close();
  } catch (error) {
    syncLogger.warn('rabbitmq_channel_close_failed', { error: error.message });
  }
  try {
    if (connection) await connection.close();
  } catch (error) {
    syncLogger.warn('rabbitmq_connection_close_failed', { error: error.message });
  }
  channel = null;
  connection = null;
  connectPromise = null;
};

module.exports = {
  connectRabbitMq,
  getRabbitChannel,
  closeRabbitMq,
};

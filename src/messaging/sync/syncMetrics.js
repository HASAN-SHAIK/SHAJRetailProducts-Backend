const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const syncPublishedTotal = new client.Counter({
  name: 'shaj_sync_published_total',
  help: 'Total sync operations published to RabbitMQ',
  labelNames: ['module', 'action'],
  registers: [register],
});

const syncConsumedTotal = new client.Counter({
  name: 'shaj_sync_consumed_total',
  help: 'Total sync operations consumed from RabbitMQ',
  labelNames: ['module', 'action', 'result'],
  registers: [register],
});

const syncRetriesTotal = new client.Counter({
  name: 'shaj_sync_retries_total',
  help: 'Total sync operation retry attempts',
  labelNames: ['module'],
  registers: [register],
});

const syncConflictsTotal = new client.Counter({
  name: 'shaj_sync_conflicts_total',
  help: 'Total sync conflicts detected',
  labelNames: ['module', 'entity_type'],
  registers: [register],
});

const syncDlqTotal = new client.Counter({
  name: 'shaj_sync_dlq_total',
  help: 'Total sync messages sent to the dead letter queue',
  labelNames: ['module', 'reason'],
  registers: [register],
});

const syncProcessingDuration = new client.Histogram({
  name: 'shaj_sync_processing_duration_seconds',
  help: 'Sync operation processing duration in seconds',
  labelNames: ['module', 'action'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

const recordPublished = ({ module, action }) => {
  syncPublishedTotal.inc({ module: module || 'unknown', action: action || 'unknown' });
};

const recordConsumed = ({ module, action, result }) => {
  syncConsumedTotal.inc({
    module: module || 'unknown',
    action: action || 'unknown',
    result: result || 'unknown',
  });
};

const recordRetry = ({ module }) => {
  syncRetriesTotal.inc({ module: module || 'unknown' });
};

const recordConflict = ({ module, entityType }) => {
  syncConflictsTotal.inc({
    module: module || 'unknown',
    entity_type: entityType || 'unknown',
  });
};

const recordDlq = ({ module, reason }) => {
  syncDlqTotal.inc({ module: module || 'unknown', reason: reason || 'unknown' });
};

const startProcessingTimer = ({ module, action }) =>
  syncProcessingDuration.startTimer({ module: module || 'unknown', action: action || 'unknown' });

module.exports = {
  register,
  recordPublished,
  recordConsumed,
  recordRetry,
  recordConflict,
  recordDlq,
  startProcessingTimer,
};

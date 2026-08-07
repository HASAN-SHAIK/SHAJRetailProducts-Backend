const express = require('express');
const { posSyncAuth } = require('./posSyncAuth');

const router = express.Router();

const ensureSyncTable = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pos_sync_events (
      event_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      aggregate_version INT NOT NULL,
      schema_version INT NOT NULL,
      ordering_key TEXT,
      payload_json JSONB NOT NULL,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      source_created_at TIMESTAMPTZ,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pos_sync_events_aggregate ON pos_sync_events (aggregate_type, aggregate_id, aggregate_version)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pos_sync_events_received_at ON pos_sync_events (received_at DESC)`);
};

router.post('/events', posSyncAuth, async (req, res, next) => {
  const body = req.body || {};
  const eventId = String(body.event_id || '').trim();
  const idempotencyKey = String(req.get('Idempotency-Key') || '').trim();

  if (!eventId || !idempotencyKey || idempotencyKey !== eventId) {
    return res.status(400).json({ code: 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency-Key must match event_id' });
  }

  const required = ['event_type', 'aggregate_type', 'aggregate_id'];
  for (const key of required) {
    if (!String(body[key] || '').trim()) {
      return res.status(400).json({ code: 'INVALID_SYNC_EVENT', message: `${key} is required` });
    }
  }

  const schemaVersion = Number(body.schema_version);
  const aggregateVersion = Number(body.aggregate_version);
  if (!Number.isInteger(schemaVersion) || schemaVersion <= 0 || !Number.isInteger(aggregateVersion) || aggregateVersion <= 0) {
    return res.status(400).json({ code: 'INVALID_SYNC_EVENT', message: 'schema_version and aggregate_version must be positive integers' });
  }

  const client = await req.tenantPool.connect();
  try {
    await client.query('BEGIN');
    await ensureSyncTable(client);

    const insert = await client.query(
      `INSERT INTO pos_sync_events(
         event_id,tenant_id,device_id,event_type,aggregate_type,aggregate_id,aggregate_version,
         schema_version,ordering_key,payload_json,metadata_json,source_created_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)
       ON CONFLICT(event_id) DO NOTHING
       RETURNING event_id`,
      [
        eventId,
        req.tenant_id,
        req.posDeviceId,
        body.event_type,
        body.aggregate_type,
        body.aggregate_id,
        aggregateVersion,
        schemaVersion,
        body.ordering_key || null,
        JSON.stringify(body.payload ?? {}),
        JSON.stringify(body.metadata ?? {}),
        body.created_at || null,
      ]
    );

    await client.query('COMMIT');
    if (insert.rowCount === 0) {
      return res.status(409).json({ code: 'SYNC_EVENT_ALREADY_RECEIVED', event_id: eventId });
    }
    return res.status(202).json({ status: 'accepted', event_id: eventId });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally {
    client.release();
  }
});

module.exports = router;

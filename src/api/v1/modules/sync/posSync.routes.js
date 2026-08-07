const express = require('express');
const { posSyncAuth } = require('./posSyncAuth');
const { processPosEvent } = require('./posEvent.processor');

const router = express.Router();

router.post('/events', posSyncAuth, async (req, res, next) => {
  const body = req.body || {};
  const eventId = String(body.event_id || '').trim();
  const idempotencyKey = String(req.get('Idempotency-Key') || '').trim();

  if (!eventId || !idempotencyKey || idempotencyKey !== eventId) {
    return res.status(400).json({ code: 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency-Key must match event_id' });
  }

  for (const key of ['event_type', 'aggregate_type', 'aggregate_id']) {
    if (!String(body[key] || '').trim()) {
      return res.status(400).json({ code: 'INVALID_SYNC_EVENT', message: `${key} is required` });
    }
  }

  const schemaVersion = Number(body.schema_version);
  const aggregateVersion = Number(body.aggregate_version);
  if (!Number.isInteger(schemaVersion) || schemaVersion <= 0 || !Number.isInteger(aggregateVersion) || aggregateVersion <= 0) {
    return res.status(400).json({ code: 'INVALID_SYNC_EVENT', message: 'schema_version and aggregate_version must be positive integers' });
  }

  const event = { ...body, event_id: eventId, schema_version: schemaVersion, aggregate_version: aggregateVersion };
  const client = await req.tenantPool.connect();
  try {
    await client.query('BEGIN');
    const insert = await client.query(
      `INSERT INTO pos_sync_events(
         event_id,tenant_id,device_id,event_type,aggregate_type,aggregate_id,aggregate_version,
         schema_version,ordering_key,payload_json,metadata_json,source_created_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)
       ON CONFLICT(event_id) DO NOTHING
       RETURNING event_id`,
      [eventId, req.tenant_id, req.posDeviceId, event.event_type, event.aggregate_type, event.aggregate_id,
       aggregateVersion, schemaVersion, event.ordering_key || null, JSON.stringify(event.payload ?? {}),
       JSON.stringify(event.metadata ?? {}), event.created_at || null]
    );

    if (insert.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ code: 'SYNC_EVENT_ALREADY_RECEIVED', event_id: eventId });
    }

    const projection = await processPosEvent(client, event);
    await client.query('UPDATE pos_sync_events SET processed_at=NOW() WHERE event_id=$1', [eventId]);
    await client.query('COMMIT');
    return res.status(202).json({ status: 'accepted', event_id: eventId, projection });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (['INVALID_SALE_COMPLETED_PAYLOAD', 'INVALID_PAYMENT_RECORDED_PAYLOAD'].includes(error.code)) {
      return res.status(400).json({ code: error.code, message: error.message });
    }
    if (error.code === 'UNSUPPORTED_POS_EVENT') {
      return res.status(422).json({ code: error.code, message: error.message });
    }
    return next(error);
  } finally {
    client.release();
  }
});

module.exports = router;

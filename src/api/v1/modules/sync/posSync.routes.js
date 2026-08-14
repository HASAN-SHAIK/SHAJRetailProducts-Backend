const express = require('express');
const { posSyncAuth } = require('./posSyncAuth');
const { processPosEvent } = require('./posEvent.processor');
const { resolvePosInventoryDeviceContext } = require('./posInventoryDeviceContext');
const { getPosChanges } = require('../../../../services/posSyncGateway');
const posConfigRoutes = require('./posConfig.routes');

const router = express.Router();

router.use('/config', posConfigRoutes);

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
  const payloadJson = JSON.stringify(event.payload ?? {});
  const metadataJson = JSON.stringify(event.metadata ?? {});
  const eventValues = [eventId, req.tenant_id, req.posDeviceId, event.event_type, event.aggregate_type, event.aggregate_id, aggregateVersion, schemaVersion, event.ordering_key || null, payloadJson, metadataJson, event.created_at || null];
  const client = await req.tenantPool.connect();
  try {
    await client.query('BEGIN');
    const projectionContext = {};
    if (event.event_type === 'inventory.movement.recorded') {
      projectionContext.inventoryDevice = await resolvePosInventoryDeviceContext(client, req.posDeviceId);
    }
    const insert = await client.query(
      `INSERT INTO pos_sync_events(
         event_id,tenant_id,device_id,event_type,aggregate_type,aggregate_id,aggregate_version,
         schema_version,ordering_key,payload_json,metadata_json,source_created_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)
       ON CONFLICT(event_id) DO NOTHING
       RETURNING event_id`,
      eventValues
    );
    if (insert.rowCount === 0) {
      const existing = await client.query(
        `SELECT (
           tenant_id = $2 AND device_id = $3 AND event_type = $4 AND aggregate_type = $5 AND
           aggregate_id = $6 AND aggregate_version = $7 AND schema_version = $8 AND
           ordering_key IS NOT DISTINCT FROM $9 AND payload_json = $10::jsonb AND
           metadata_json = $11::jsonb AND source_created_at IS NOT DISTINCT FROM $12::timestamptz
         ) AS exact_match
         FROM pos_sync_events
         WHERE event_id = $1`,
        eventValues
      );
      await client.query('ROLLBACK');
      if (existing.rows[0]?.exact_match === true) return res.status(409).json({ code: 'SYNC_EVENT_ALREADY_RECEIVED', event_id: eventId });
      return res.status(409).json({ code: 'SYNC_EVENT_ID_COLLISION', event_id: eventId, message: 'event_id is already bound to a different sync event' });
    }
    const projection = await processPosEvent(client, event, projectionContext);
    await client.query('UPDATE pos_sync_events SET processed_at=NOW() WHERE event_id=$1', [eventId]);
    await client.query('COMMIT');
    return res.status(202).json({ status: 'accepted', event_id: eventId, projection });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === 'POS_SYNC_DEVICE_NOT_REGISTERED') return res.status(403).json({ code: error.code, message: error.message });
    if (['INVALID_SALE_COMPLETED_PAYLOAD', 'INVALID_SALE_RETURNED_PAYLOAD', 'INVALID_SALE_PARTIAL_RETURNED_PAYLOAD', 'INVALID_PAYMENT_RECORDED_PAYLOAD', 'INVALID_INVENTORY_MOVEMENT_PAYLOAD', 'INVALID_RECEIPT_ISSUED_PAYLOAD', 'INVALID_CUSTOMER_CHANGED_PAYLOAD'].includes(error.code)) {
      return res.status(400).json({ code: error.code, message: error.message });
    }
    if (error.code === 'UNSUPPORTED_POS_EVENT') return res.status(422).json({ code: error.code, message: error.message });
    return next(error);
  } finally {
    client.release();
  }
});

router.get('/changes', posSyncAuth, async (req, res, next) => {
  try {
    const result = await getPosChanges({ tenantPool: req.tenantPool, cursorValue: req.query.cursor, limit: req.query.limit });
    return res.status(200).json(result);
  } catch (error) {
    if (error.code === 'INVALID_CURSOR') return res.status(400).json({ code: error.code, message: error.message });
    return next(error);
  }
});

module.exports = router;

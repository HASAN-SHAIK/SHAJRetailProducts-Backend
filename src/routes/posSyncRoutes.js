const express = require('express');
const { ingestPosEvent, getPosChanges } = require('../services/posSyncGateway');

const router = express.Router();

router.post('/events', async (req, res) => {
  const event = req.body || {};
  const idempotencyKey = String(req.headers['idempotency-key'] || '').trim();
  if (!event.event_id || (idempotencyKey && idempotencyKey !== String(event.event_id))) {
    return res.status(400).json({ error: 'INVALID_IDEMPOTENCY_KEY' });
  }
  try {
    const result = await ingestPosEvent({
      tenantPool: req.tenantPool,
      tenant: req.tenant,
      tenantId: req.tenant_id,
      deviceId: req.posDeviceId,
      event,
    });
    return res.status(result?.duplicate ? 200 : 201).json({
      acknowledged: true,
      event_id: event.event_id,
      duplicate: Boolean(result?.duplicate),
      operation_id: result?.operationId || null,
      status: result?.status || result?.applied?.status || 'synced',
    });
  } catch (error) {
    const code = error.code || 'POS_SYNC_EVENT_FAILED';
    const nonRetryable = error.retryable === false || ['VALIDATION_ERROR', 'PRODUCT_MAPPING_REQUIRED'].includes(code);
    return res.status(nonRetryable ? 422 : 500).json({ error: code, message: error.message });
  }
});

router.get('/changes', async (req, res) => {
  try {
    const result = await getPosChanges({
      tenantPool: req.tenantPool,
      cursorValue: req.query.cursor,
      limit: req.query.limit,
    });
    return res.status(200).json(result);
  } catch (error) {
    const code = error.code || 'POS_CHANGE_FEED_FAILED';
    return res.status(code === 'INVALID_CURSOR' ? 400 : 500).json({ error: code, message: error.message });
  }
});

module.exports = router;

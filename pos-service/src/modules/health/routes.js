const express = require('express');
const { getDatabase } = require('../../db/database');
const { getSummary } = require('../outbox/outboxRepository');
const env = require('../../config/env');

const router = express.Router();
router.get('/health', (_req, res) => {
  getDatabase().prepare('SELECT 1').get();
  res.json({
    status: 'ok',
    service: 'shajretail-pos-service',
    version: '0.1.0',
    deviceProvisioned: Boolean(env.deviceId && env.storeId),
    outbox: getSummary(),
    timestamp: new Date().toISOString()
  });
});
module.exports = router;

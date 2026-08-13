const express = require('express');
const { posSyncAuth } = require('./posSyncAuth');
const configurationService = require('../../../../configuration/service');

const router = express.Router();

router.get('/effective', posSyncAuth, async (req, res, next) => {
  try {
    const result = await configurationService.resolveEffectiveConfiguration(req, {
      deviceId: req.posDeviceId,
      requireRegisteredDevice: true,
    });
    res.set('ETag', `"${result.etag}"`);
    res.set('Cache-Control', 'private, no-cache');
    const candidate = String(req.get('If-None-Match') || '').replace(/^W\//, '').replaceAll('"', '');
    if (candidate && candidate === result.etag) return res.status(304).end();
    return res.status(200).json(result);
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({
        code: error.code || 'POS_CONFIG_FAILED',
        message: error.message || 'Unable to resolve POS configuration',
      });
    }
    return next(error);
  }
});

module.exports = router;

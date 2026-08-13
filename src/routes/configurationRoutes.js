const express = require('express');
const isAdmin = require('../middleware/isAdmin');
const {
  getCatalog,
  getEffective,
  getScope,
  updateScope,
  resetScopeValue,
  getAudit,
} = require('../controllers/configurationController');

const router = express.Router();

router.get('/catalog', isAdmin, getCatalog);
router.get('/effective', getEffective);
router.get('/scopes/:scopeType/:scopeId', isAdmin, getScope);
router.get('/scopes/:scopeType/:scopeId/audit', isAdmin, getAudit);
router.put('/scopes/:scopeType/:scopeId', isAdmin, updateScope);
router.delete('/scopes/:scopeType/:scopeId/:settingKey', isAdmin, resetScopeValue);

module.exports = router;

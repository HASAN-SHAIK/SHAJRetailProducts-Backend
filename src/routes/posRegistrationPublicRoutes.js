const express = require('express');
const {
  createRegistrationRequest,
  registrationStatus,
  claimRegistration,
  claimSetupCode,
} = require('../controllers/posRegistrationController');

const router = express.Router();

router.post('/requests', createRegistrationRequest);
router.get('/requests/:requestId', registrationStatus);
router.post('/requests/:requestId/claim', claimRegistration);
router.post('/setup-codes/claim', claimSetupCode);

module.exports = router;

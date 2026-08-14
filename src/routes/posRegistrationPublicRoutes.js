const express = require('express');
const {
  createRegistrationRequest,
  registrationStatus,
  claimRegistration,
} = require('../controllers/posRegistrationController');

const router = express.Router();

router.post('/requests', createRegistrationRequest);
router.get('/requests/:requestId', registrationStatus);
router.post('/requests/:requestId/claim', claimRegistration);

module.exports = router;

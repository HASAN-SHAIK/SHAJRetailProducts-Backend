const express = require('express');
const swaggerUi = require('swagger-ui-express');
const { swaggerSpec } = require('./openapi');

const router = express.Router();

router.use('/', swaggerUi.serve);
router.get('/', swaggerUi.setup(swaggerSpec, { explorer: true }));

module.exports = router;

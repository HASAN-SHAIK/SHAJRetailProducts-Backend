const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'SHAJTech REST API',
      version: '1.0.0',
      description:
        'Clean-architecture REST API for SHAJTech retail platform. Authentication uses tenant JWT (cookie or Bearer). Branch scope via x-branch-id header.',
    },
    servers: [{ url: '/api/v1', description: 'API v1' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'auth_token' },
      },
      schemas: {
        ApiSuccess: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'object' },
            meta: {
              type: 'object',
              properties: {
                page: { type: 'integer' },
                limit: { type: 'integer' },
                total: { type: 'integer' },
                total_pages: { type: 'integer' },
              },
            },
          },
        },
        ApiError: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                details: { type: 'array', items: { type: 'object' } },
              },
            },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
    tags: [
      { name: 'Auth' },
      { name: 'Products' },
      { name: 'Customers' },
      { name: 'Suppliers' },
      { name: 'Categories' },
      { name: 'Expenses' },
      { name: 'Staff' },
      { name: 'Purchases' },
      { name: 'Sales' },
    ],
    paths: {
      '/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'Tenant login',
          security: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password'],
                  properties: {
                    email: { type: 'string' },
                    password: { type: 'string' },
                    branch_id: { type: 'string', format: 'uuid' },
                  },
                },
              },
            },
          },
          responses: { 200: { description: 'Login successful' } },
        },
      },
      '/auth/me': {
        get: { tags: ['Auth'], summary: 'Current authenticated user', responses: { 200: { description: 'OK' } } },
      },
      '/products': {
        get: {
          tags: ['Products'],
          summary: 'List products',
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'category', in: 'query', schema: { type: 'string' } },
            { name: 'sort_by', in: 'query', schema: { type: 'string' } },
            { name: 'sort_order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
          ],
          responses: { 200: { description: 'Paginated product list', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiSuccess' } } } } },
        },
        post: { tags: ['Products'], summary: 'Create product (admin)', responses: { 201: { description: 'Created' } } },
      },
      '/products/barcode/{barcode}': {
        get: {
          tags: ['Products'],
          summary: 'Lookup product by barcode',
          parameters: [{ name: 'barcode', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Product found' } },
        },
      },
      '/products/{id}': {
        get: { tags: ['Products'], summary: 'Get product by ID', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: 'OK' } } },
        put: { tags: ['Products'], summary: 'Update product (admin)', responses: { 200: { description: 'Updated' } } },
        delete: { tags: ['Products'], summary: 'Delete product (admin)', responses: { 204: { description: 'Deleted' } } },
      },
      '/customers': {
        get: { tags: ['Customers'], summary: 'List customers with search/pagination', responses: { 200: { description: 'OK' } } },
        post: { tags: ['Customers'], summary: 'Create customer', responses: { 201: { description: 'Created' } } },
      },
      '/suppliers': {
        get: { tags: ['Suppliers'], summary: 'List suppliers', responses: { 200: { description: 'OK' } } },
        post: { tags: ['Suppliers'], summary: 'Create supplier', responses: { 201: { description: 'Created' } } },
      },
      '/categories': {
        get: { tags: ['Categories'], summary: 'List product categories', responses: { 200: { description: 'OK' } } },
      },
      '/expenses': {
        get: { tags: ['Expenses'], summary: 'List expenses with filters', responses: { 200: { description: 'OK' } } },
        post: { tags: ['Expenses'], summary: 'Create expense', responses: { 201: { description: 'Created' } } },
      },
      '/staff': {
        get: { tags: ['Staff'], summary: 'List staff', responses: { 200: { description: 'OK' } } },
        post: { tags: ['Staff'], summary: 'Create staff member', responses: { 201: { description: 'Created' } } },
      },
      '/purchases': {
        get: { tags: ['Purchases'], summary: 'List purchases', responses: { 200: { description: 'OK' } } },
        post: { tags: ['Purchases'], summary: 'Create purchase', responses: { 201: { description: 'Created' } } },
      },
      '/sales': {
        get: { tags: ['Sales'], summary: 'List sales orders', responses: { 200: { description: 'OK' } } },
        post: { tags: ['Sales'], summary: 'Create sale order', responses: { 201: { description: 'Created' } } },
      },
    },
  },
  apis: [],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = { swaggerSpec };

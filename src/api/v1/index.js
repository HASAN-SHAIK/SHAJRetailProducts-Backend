const express = require('express');
const { requestLogger } = require('./shared/middleware/requestLogger');
const { apiErrorHandler } = require('./shared/middleware/apiErrorHandler');

const authRoutes = require('./modules/auth/auth.routes');
const productRoutes = require('./modules/products/product.routes');
const customerRoutes = require('./modules/customers/customer.routes');
const supplierRoutes = require('./modules/suppliers/supplier.routes');
const categoryRoutes = require('./modules/categories/category.routes');
const expenseRoutes = require('./modules/expenses/expense.routes');
const staffRoutes = require('./modules/staff/staff.routes');
const purchaseRoutes = require('./modules/purchases/purchase.routes');
const purchaseReturnRoutes = require('./modules/purchaseReturns/purchaseReturn.routes');
const saleRoutes = require('./modules/sales/sale.routes');
const swaggerRoutes = require('./swagger/setup');

const apiV1AuthRouter = authRoutes;

const apiV1Router = express.Router();
apiV1Router.use(requestLogger);
apiV1Router.use('/products', productRoutes);
apiV1Router.use('/customers', customerRoutes);
apiV1Router.use('/suppliers', supplierRoutes);
apiV1Router.use('/categories', categoryRoutes);
apiV1Router.use('/expenses', expenseRoutes);
apiV1Router.use('/staff', staffRoutes);
apiV1Router.use('/purchases', purchaseRoutes);
apiV1Router.use('/purchase-returns', purchaseReturnRoutes);
apiV1Router.use('/sales', saleRoutes);
apiV1Router.use(apiErrorHandler);

module.exports = {
  apiV1AuthRouter,
  apiV1Router,
  swaggerRoutes,
};

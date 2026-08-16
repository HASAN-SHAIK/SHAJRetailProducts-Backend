const express = require('express');
const router = express.Router();
const { createOrder,
    getAllOrders,
    getOrderById,
    updateOrder,
    updateOrderItemPrice,
    deleteOrder,
    markOrderAsPaid,
    processOrderReturn,
    getCategories,
    syncOfflineOrders} = require('../controllers/orderController');
const { requirePermission } = require('../middleware/requirePermission');

router.get('/getcategories', requirePermission('products:read'), getCategories);
router.get('/', requirePermission('orders:read'), getAllOrders);
router.post('/:id/returns', requirePermission('pos:refund'), processOrderReturn);
router.patch('/:orderId/items/:itemId/price', requirePermission('pos:discount'), updateOrderItemPrice);
router.get('/:id', requirePermission('orders:read'), getOrderById);
router.post('/', requirePermission('pos:sale'), createOrder);
router.post('/offline-sync', requirePermission('orders:write'), syncOfflineOrders);
router.put('/:id', requirePermission('orders:write'), updateOrder);
router.delete('/:id', requirePermission('pos:void'), deleteOrder);
router.post('/mark-paid', requirePermission('orders:write'), markOrderAsPaid);

module.exports = router;

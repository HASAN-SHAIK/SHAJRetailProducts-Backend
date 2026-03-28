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
const { authMiddleware } = require('../middleware/authMiddleware');
const isAdmin = require('../middleware/isAdmin');

router.get('/getcategories', getCategories);
router.get('/', getAllOrders);
router.post('/:id/returns', processOrderReturn);
router.patch('/:orderId/items/:itemId/price', updateOrderItemPrice);
router.get('/:id', getOrderById)
router.post('/', createOrder);
router.post('/offline-sync', syncOfflineOrders);
router.put('/:id', updateOrder);
router.delete('/:id', deleteOrder);
router.post('/mark-paid', markOrderAsPaid);

module.exports = router;

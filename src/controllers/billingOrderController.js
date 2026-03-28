const billingOrderService = require('../services/billingOrderService');
const { jsonOk } = require('../utils/responses');

const createOrder = async (req, res) => {
  try {
    const result = await billingOrderService.createOrder(req, req.body || {});
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const getOrders = async (req, res) => {
  try {
    const result = await billingOrderService.getOrders(req, req.query || {});
    return jsonOk(res, result);
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const getOrderById = async (req, res) => {
  try {
    const result = await billingOrderService.getOrderById(req, req.params.id);
    return jsonOk(res, result);
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

module.exports = {
  createOrder,
  getOrders,
  getOrderById
};

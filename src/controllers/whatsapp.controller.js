const whatsappService = require('../services/whatsapp.service');

const sendBill = async (req, res) => {
  try {
    const payload = req.body || {};
    const result = await whatsappService.sendBill(req, payload);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

module.exports = { sendBill };

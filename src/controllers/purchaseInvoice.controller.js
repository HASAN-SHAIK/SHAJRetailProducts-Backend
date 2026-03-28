const purchaseInvoiceService = require('../services/purchaseInvoice.service');
const { generatePDF } = require('../utils/pdfGenerator');
const { buildPurchaseTemplate } = require('../templates/purchasePdfTemplate');

const parseInvoice = async (req, res) => {
  try {
    const items = await purchaseInvoiceService.parseInvoice(req, req.file);
    return res.status(200).json({ success: true, items });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, message: error.message || 'Parse failed' });
  }
};

const savePurchase = async (req, res) => {
  try {
    const result = await purchaseInvoiceService.savePurchase(req, req.body || {});
    return res.status(200).json({ success: true, items: result });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, message: error.message || 'Save failed' });
  }
};

const generatePurchasePdf = async (req, res) => {
  try {
    const html = buildPurchaseTemplate(req.body || {});
    const pdf = await generatePDF(html);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename=purchase-order.pdf'
    });
    return res.send(pdf);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'PDF generation failed' });
  }
};

module.exports = { parseInvoice, savePurchase, generatePurchasePdf };

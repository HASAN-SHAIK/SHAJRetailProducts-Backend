const purchaseInvoiceService = require('../services/purchaseInvoice.service');
const { generatePDF } = require('../utils/pdfGenerator');
const { buildPurchaseTemplate } = require('../templates/purchasePdfTemplate');

const parseInvoice = async (req, res) => {
  try {
    const parsed = await purchaseInvoiceService.parseInvoice(req, req.file);
    return res.status(200).json({ success: true, ...parsed });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, message: error.message || 'Parse failed' });
  }
};

const importPdfInvoice = async (req, res) => {
  try {
    const parsed = await purchaseInvoiceService.parseInvoice(req, req.file);
    const branchId = req.body?.branch_id || req.query?.branch_id || null;
    const items = parsed.parsed_data?.items || [];
    const matchedItems = await purchaseInvoiceService.matchProducts(req, items, branchId);
    return res.status(200).json({
      success: true,
      raw_text: parsed.raw_text,
      confidence_score: parsed.confidence_score,
      extraction_method: parsed.extraction_method,
      warnings: parsed.warnings || [],
      parsed_data: {
        invoice_number: parsed.parsed_data?.invoice_number || null,
        invoice_date: parsed.parsed_data?.invoice_date || null,
        due_date: parsed.parsed_data?.due_date || null,
        place_of_supply: parsed.parsed_data?.place_of_supply || null,
        reverse_charge: parsed.parsed_data?.reverse_charge ?? null,
        seller: parsed.parsed_data?.seller || { name: null, address: null, gstin: null, mobile: null },
        items: matchedItems,
        totals: parsed.parsed_data?.totals || { subtotal: null, cgst: null, sgst: null, total_tax: null, grand_total: null },
        bank_details: parsed.parsed_data?.bank_details || { account_number: null, ifsc: null, bank_name: null, account_holder: null }
      }
    });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, message: error.message || 'Import failed' });
  }
};

const savePurchase = async (req, res) => {
  try {
    const result = await purchaseInvoiceService.savePurchase(req, req.body || {});
    return res.status(200).json({ success: true, data: result });
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

module.exports = { parseInvoice, importPdfInvoice, savePurchase, generatePurchasePdf };

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatNumber = (value) => {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toFixed(2) : '0.00';
};

const buildPurchaseTemplate = (data = {}) => {
  const company = data.company || {};
  const supplier = data.supplier || {};
  const items = Array.isArray(data.items) ? data.items : [];
  const subtotal = items.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const taxLines = Array.isArray(data.taxes) ? data.taxes : [];
  const taxTotal = taxLines.reduce((sum, tax) => sum + Number(tax.amount || 0), 0);
  const grandTotal = subtotal + taxTotal;

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Purchase Order</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: Arial, sans-serif; color: #0f172a; font-size: 12px; }
          .header { display: flex; justify-content: space-between; margin-bottom: 16px; }
          .company h1 { margin: 0 0 6px; font-size: 18px; }
          .company p { margin: 2px 0; }
          .po-details { text-align: right; }
          .po-details h2 { margin: 0 0 6px; font-size: 14px; }
          .section { margin-bottom: 16px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #cbd5f5; padding: 6px; text-align: left; }
          th { background: #f1f5f9; }
          .right { text-align: right; }
          .totals { width: 40%; margin-left: auto; }
          .footer { margin-top: 24px; display: flex; justify-content: space-between; }
          .signature { text-align: right; margin-top: 24px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="company">
            <h1>${escapeHtml(company.name || 'SHAJTech')}</h1>
            <p>${escapeHtml(company.address || '')}</p>
            <p>GSTIN: ${escapeHtml(company.gstin || '')}</p>
            <p>Phone: ${escapeHtml(company.phone || '')}</p>
          </div>
          <div class="po-details">
            <h2>Purchase Order</h2>
            <p>PO Number: ${escapeHtml(data.po_number || '')}</p>
            <p>Date: ${escapeHtml(data.date || '')}</p>
            <p>Supplier: ${escapeHtml(supplier.name || '')}</p>
            <p>Supplier GSTIN: ${escapeHtml(supplier.gstin || '')}</p>
          </div>
        </div>

        <div class="section">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Item Name</th>
                <th>HSN</th>
                <th class="right">Qty</th>
                <th class="right">Purchase Price</th>
                <th class="right">GST %</th>
                <th class="right">Total</th>
              </tr>
            </thead>
            <tbody>
              ${items
                .map(
                  (item, index) => `
                    <tr>
                      <td>${index + 1}</td>
                      <td>${escapeHtml(item.name || '')}</td>
                      <td>${escapeHtml(item.hsn || '')}</td>
                      <td class="right">${formatNumber(item.qty)}</td>
                      <td class="right">₹${formatNumber(item.purchase_price)}</td>
                      <td class="right">${formatNumber(item.gst_percent)}</td>
                      <td class="right">₹${formatNumber(item.total)}</td>
                    </tr>
                  `
                )
                .join('')}
            </tbody>
          </table>
        </div>

        <div class="section totals">
          <table>
            <tbody>
              <tr>
                <td>Subtotal</td>
                <td class="right">₹${formatNumber(subtotal)}</td>
              </tr>
              ${taxLines
                .map(
                  (tax) => `
                    <tr>
                      <td>${escapeHtml(tax.label)}</td>
                      <td class="right">₹${formatNumber(tax.amount)}</td>
                    </tr>
                  `
                )
                .join('')}
              <tr>
                <td><strong>Grand Total</strong></td>
                <td class="right"><strong>₹${formatNumber(grandTotal)}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="footer">
          <div class="notes">
            <strong>Notes</strong>
            <p>${escapeHtml(data.notes || '')}</p>
          </div>
          <div class="signature">
            <p>Authorized Signature</p>
          </div>
        </div>
      </body>
    </html>
  `;
};

module.exports = { buildPurchaseTemplate };

const pool = require('../db');
const { resolveBranchIdFromRequest } = require('../utils/branch');
const { buildPaginationMeta, parsePagination } = require('../utils/queryParams');

const getRequestPool = (req) => req.tenantPool || pool;

const branchFilterClause = '($1::uuid IS NULL OR o.branch_id = $1)';

const listLedger = async (req, res) => {
  try {
    const requestPool = getRequestPool(req);
    const branchId = resolveBranchIdFromRequest(req);
    const { page, limit, offset } = parsePagination(req, { defaultLimit: 50, maxLimit: 200 });
    const countResult = await requestPool.query(
      `SELECT COUNT(*)::int AS total
       FROM gst_ledger gl
       LEFT JOIN orders o ON o.id = gl.bill_id
       WHERE ${branchFilterClause}`,
      [branchId]
    );
    const result = await requestPool.query(
      `SELECT gl.id AS "gstEntryId",
              gl.bill_id AS "billId",
              gl.type,
              gl.taxable_amount AS "taxableAmount",
              gl.cgst,
              gl.sgst,
              gl.igst,
              gl.total_tax AS "totalTax",
              gl.date,
              gl.is_synced AS "isSynced"
       FROM gst_ledger gl
       LEFT JOIN orders o ON o.id = gl.bill_id
       WHERE ${branchFilterClause}
       ORDER BY gl.date DESC
       LIMIT $2 OFFSET $3`,
      [branchId, limit, offset]
    );
    return res.status(200).json({
      success: true,
      entries: result.rows,
      pagination: buildPaginationMeta({ page, limit, total: countResult.rows[0]?.total || 0 }),
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const upsertLedger = async (req, res) => {
  try {
    const requestPool = getRequestPool(req);
    const payload = req.body || {};
    const id = payload.gstEntryId || payload.id;
    const billId = payload.billId || payload.bill_id;
    if (!id || !billId) {
      return res.status(400).json({ success: false, error: 'gstEntryId and billId are required.' });
    }
    await requestPool.query(
      `INSERT INTO gst_ledger (id, bill_id, type, taxable_amount, cgst, sgst, igst, total_tax, date, is_synced)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, CURRENT_DATE), FALSE)
       ON CONFLICT (id) DO UPDATE
       SET type = EXCLUDED.type,
           taxable_amount = EXCLUDED.taxable_amount,
           cgst = EXCLUDED.cgst,
           sgst = EXCLUDED.sgst,
           igst = EXCLUDED.igst,
           total_tax = EXCLUDED.total_tax,
           date = EXCLUDED.date`,
      [
        id,
        billId,
        payload.type,
        payload.taxableAmount ?? payload.taxable_amount ?? 0,
        payload.cgst ?? 0,
        payload.sgst ?? 0,
        payload.igst ?? 0,
        payload.totalTax ?? payload.total_tax ?? 0,
        payload.date || null,
      ]
    );
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const getSummary = async (req, res) => {
  try {
    const requestPool = getRequestPool(req);
    const branchId = resolveBranchIdFromRequest(req);
    const result = await requestPool.query(
      `SELECT
          COALESCE(SUM(CASE WHEN gl.type = 'SALE' THEN gl.taxable_amount ELSE 0 END), 0)::numeric AS sales_total,
          COALESCE(SUM(CASE WHEN gl.type = 'RETURN' THEN gl.taxable_amount ELSE 0 END), 0)::numeric AS returns_total,
          COALESCE(SUM(gl.total_tax), 0)::numeric AS total_tax
       FROM gst_ledger gl
       LEFT JOIN orders o ON o.id = gl.bill_id
       WHERE ${branchFilterClause}`,
      [branchId]
    );
    const row = result.rows[0] || {};
    return res.status(200).json({
      success: true,
      summary: {
        total_sales: Number(row.sales_total || 0),
        total_returns: Number(row.returns_total || 0),
        total_tax: Number(row.total_tax || 0),
        net_tax_liability: Number(row.total_tax || 0),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const getReports = async (req, res) => {
  try {
    const requestPool = getRequestPool(req);
    const branchId = resolveBranchIdFromRequest(req);
    const from = req.query?.from;
    const to = req.query?.to;
    const result = await requestPool.query(
      `SELECT gl.date,
              COALESCE(SUM(gl.cgst), 0)::numeric AS cgst,
              COALESCE(SUM(gl.sgst), 0)::numeric AS sgst,
              COALESCE(SUM(gl.igst), 0)::numeric AS igst
       FROM gst_ledger gl
       LEFT JOIN orders o ON o.id = gl.bill_id
       WHERE ($2::date IS NULL OR gl.date >= $2)
         AND ($3::date IS NULL OR gl.date <= $3)
         AND ${branchFilterClause}
       GROUP BY gl.date
       ORDER BY gl.date DESC`,
      [branchId, from || null, to || null]
    );
    return res.status(200).json({ success: true, reports: result.rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const buildGstSchedules = (rows) => {
  const b2b = [];
  const b2cSmall = [];
  const b2cLarge = [];
  const creditNotes = [];

  for (const row of rows) {
    const isReturn = String(row.type || '').toUpperCase() === 'RETURN' || String(row.transaction_type || '').toLowerCase() === 'return';
    const taxable = Number(row.taxable_amount || 0);
    const cgst = Number(row.cgst || 0);
    const sgst = Number(row.sgst || 0);
    const igst = Number(row.igst || 0);
    const totalTax = Number(row.total_tax || (cgst + sgst + igst));
    const invoiceTotal = Number(row.total_price || (taxable + totalTax));
    const customerGstin = String(row.customer_gstin || '').trim();
    const isInterState = igst > 0;

    const mapped = {
      id: row.id,
      billId: row.bill_id,
      bill_id: row.bill_id,
      orderNumber: row.order_number || String(row.bill_id || '-'),
      order_number: row.order_number || String(row.bill_id || '-'),
      type: row.type || (isReturn ? 'RETURN' : 'SALE'),
      date: row.date,
      customerName: row.customer_name || 'Retail Customer',
      customer_name: row.customer_name || 'Retail Customer',
      customerGstin: customerGstin,
      customer_gstin: customerGstin,
      placeOfSupply: row.customer_state || (isInterState ? 'Inter-State' : 'Intra-State'),
      place_of_supply: row.customer_state || (isInterState ? 'Inter-State' : 'Intra-State'),
      taxableAmount: taxable,
      taxable_amount: taxable,
      cgst,
      sgst,
      igst,
      totalTax,
      total_tax: totalTax,
      invoiceTotal,
      invoice_total: invoiceTotal,
    };

    if (isReturn) {
      creditNotes.push(mapped);
    } else if (customerGstin.length >= 5) {
      b2b.push(mapped);
    } else if (isInterState && invoiceTotal > 250000) {
      b2cLarge.push(mapped);
    } else {
      b2cSmall.push(mapped);
    }
  }

  const calcScheduleTotals = (items) => items.reduce(
    (acc, it) => ({
      count: acc.count + 1,
      taxable: Math.round((acc.taxable + it.taxableAmount) * 100) / 100,
      cgst: Math.round((acc.cgst + it.cgst) * 100) / 100,
      sgst: Math.round((acc.sgst + it.sgst) * 100) / 100,
      igst: Math.round((acc.igst + it.igst) * 100) / 100,
      totalTax: Math.round((acc.totalTax + it.totalTax) * 100) / 100,
      invoiceTotal: Math.round((acc.invoiceTotal + it.invoiceTotal) * 100) / 100,
    }),
    { count: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0, invoiceTotal: 0 }
  );

  const b2bTotals = calcScheduleTotals(b2b);
  const b2cSmallTotals = calcScheduleTotals(b2cSmall);
  const b2cLargeTotals = calcScheduleTotals(b2cLarge);
  const creditNotesTotals = calcScheduleTotals(creditNotes);

  return {
    b2b,
    b2c: [...b2cSmall, ...b2cLarge],
    b2c_small: b2cSmall,
    b2c_large: b2cLarge,
    credit_notes: creditNotes,
    raw: rows,
    totals: {
      b2b: b2bTotals,
      b2c_small: b2cSmallTotals,
      b2c_large: b2cLargeTotals,
      credit_notes: creditNotesTotals,
      net: {
        taxable: Math.round((b2bTotals.taxable + b2cSmallTotals.taxable + b2cLargeTotals.taxable - creditNotesTotals.taxable) * 100) / 100,
        cgst: Math.round((b2bTotals.cgst + b2cSmallTotals.cgst + b2cLargeTotals.cgst - creditNotesTotals.cgst) * 100) / 100,
        sgst: Math.round((b2bTotals.sgst + b2cSmallTotals.sgst + b2cLargeTotals.sgst - creditNotesTotals.sgst) * 100) / 100,
        igst: Math.round((b2bTotals.igst + b2cSmallTotals.igst + b2cLargeTotals.igst - creditNotesTotals.igst) * 100) / 100,
        totalTax: Math.round((b2bTotals.totalTax + b2cSmallTotals.totalTax + b2cLargeTotals.totalTax - creditNotesTotals.totalTax) * 100) / 100,
        invoiceTotal: Math.round((b2bTotals.invoiceTotal + b2cSmallTotals.invoiceTotal + b2cLargeTotals.invoiceTotal - creditNotesTotals.invoiceTotal) * 100) / 100,
      },
    },
  };
};

const generateGstCsv = (schedules) => {
  const headers = [
    'Schedule',
    'Invoice / Return No',
    'Date',
    'Customer Name',
    'Customer GSTIN',
    'Place of Supply',
    'Taxable Value',
    'CGST',
    'SGST',
    'IGST',
    'Total Tax',
    'Invoice Total',
  ];

  const lines = [headers.join(',')];

  const escapeCsv = (val) => {
    const s = String(val ?? '').replace(/"/g, '""');
    return /[",\n\r]/.test(s) ? `"${s}"` : s;
  };

  const addItems = (scheduleName, items) => {
    for (const item of items) {
      lines.push([
        escapeCsv(scheduleName),
        escapeCsv(item.orderNumber),
        escapeCsv(item.date ? String(item.date).slice(0, 10) : ''),
        escapeCsv(item.customerName),
        escapeCsv(item.customerGstin),
        escapeCsv(item.placeOfSupply),
        item.taxableAmount.toFixed(2),
        item.cgst.toFixed(2),
        item.sgst.toFixed(2),
        item.igst.toFixed(2),
        item.totalTax.toFixed(2),
        item.invoiceTotal.toFixed(2),
      ].join(','));
    }
  };

  addItems('B2B (Table 4)', schedules.b2b);
  addItems('B2C Large (Table 5)', schedules.b2c_large);
  addItems('B2C Small (Table 7)', schedules.b2c_small);
  addItems('Credit / Debit Notes (Table 9B)', schedules.credit_notes);

  return lines.join('\r\n');
};

const getFilingData = async (req, res) => {
  try {
    const requestPool = getRequestPool(req);
    const branchId = resolveBranchIdFromRequest(req);
    const { from, to, format } = req.query || {};
    const { page, limit, offset } = parsePagination(req, { defaultLimit: 200, maxLimit: 1000 });

    const dataRes = await requestPool.query(
      `SELECT gl.id,
              gl.bill_id,
              gl.type,
              gl.taxable_amount,
              gl.cgst,
              gl.sgst,
              gl.igst,
              gl.total_tax,
              gl.date,
              o.order_number,
              o.customer_id,
              o.total_price,
              o.transaction_type,
              c.name AS customer_name,
              COALESCE(c.gst_number, '') AS customer_gstin,
              c.state AS customer_state
       FROM gst_ledger gl
       LEFT JOIN orders o ON o.id = gl.bill_id
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE ${branchFilterClause}
         AND ($4::date IS NULL OR gl.date >= $4)
         AND ($5::date IS NULL OR gl.date <= $5)
       ORDER BY gl.date DESC
       LIMIT $2 OFFSET $3`,
      [branchId, limit, offset, from || null, to || null]
    );

    const schedules = buildGstSchedules(dataRes.rows);

    if (String(format || '').toLowerCase() === 'csv') {
      const csv = generateGstCsv(schedules);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="gstr1_filing_schedules.csv"');
      return res.status(200).send(csv);
    }

    return res.status(200).json({
      success: true,
      data: schedules,
      pagination: buildPaginationMeta({ page, limit, total: dataRes.rowCount }),
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const exportGstCsv = async (req, res) => {
  req.query = req.query || {};
  req.query.format = 'csv';
  return getFilingData(req, res);
};

module.exports = {
  listLedger,
  upsertLedger,
  getSummary,
  getReports,
  getFilingData,
  exportGstCsv,
  buildGstSchedules,
  generateGstCsv,
};

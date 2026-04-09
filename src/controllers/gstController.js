const pool = require('../db');
const { resolveBranchIdFromRequest } = require('../utils/branch');

const getRequestPool = (req) => req.tenantPool || pool;

const listLedger = async (req, res) => {
  try {
    const requestPool = getRequestPool(req);
    const branchId = resolveBranchIdFromRequest(req);
    const result = await requestPool.query(
      `SELECT id AS "gstEntryId",
              bill_id AS "billId",
              type,
              taxable_amount AS "taxableAmount",
              cgst,
              sgst,
              igst,
              total_tax AS "totalTax",
              date,
              is_synced AS "isSynced"
       FROM gst_ledger
       WHERE ($1::uuid IS NULL OR bill_id IN (SELECT id FROM orders WHERE branch_id = $1))
       ORDER BY date DESC`,
      [branchId]
    );
    return res.status(200).json({ success: true, entries: result.rows });
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
          COALESCE(SUM(CASE WHEN type = 'SALE' THEN taxable_amount ELSE 0 END), 0)::numeric AS sales_total,
          COALESCE(SUM(CASE WHEN type = 'RETURN' THEN taxable_amount ELSE 0 END), 0)::numeric AS returns_total,
          COALESCE(SUM(total_tax), 0)::numeric AS total_tax
       FROM gst_ledger
       WHERE ($1::uuid IS NULL OR bill_id IN (SELECT id FROM orders WHERE branch_id = $1))`,
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
      `SELECT date,
              COALESCE(SUM(cgst), 0)::numeric AS cgst,
              COALESCE(SUM(sgst), 0)::numeric AS sgst,
              COALESCE(SUM(igst), 0)::numeric AS igst
       FROM gst_ledger
       WHERE ($1::date IS NULL OR date >= $1)
         AND ($2::date IS NULL OR date <= $2)
         AND ($3::uuid IS NULL OR bill_id IN (SELECT id FROM orders WHERE branch_id = $3))
       GROUP BY date
       ORDER BY date DESC`,
      [from || null, to || null, branchId]
    );
    return res.status(200).json({ success: true, reports: result.rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const getFilingData = async (req, res) => {
  try {
    const requestPool = getRequestPool(req);
    const branchId = resolveBranchIdFromRequest(req);
    const dataRes = await requestPool.query(
      `SELECT bill_id, type, taxable_amount, cgst, sgst, igst, total_tax, date
       FROM gst_ledger
       WHERE ($1::uuid IS NULL OR bill_id IN (SELECT id FROM orders WHERE branch_id = $1))
       ORDER BY date DESC`,
      [branchId]
    );
    return res.status(200).json({
      success: true,
      data: {
        b2b: [],
        b2c: [],
        credit_notes: dataRes.rows.filter((row) => row.type === 'RETURN'),
        raw: dataRes.rows,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

module.exports = { listLedger, upsertLedger, getSummary, getReports, getFilingData };

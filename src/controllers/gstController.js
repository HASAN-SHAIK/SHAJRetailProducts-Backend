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

const getFilingData = async (req, res) => {
  try {
    const requestPool = getRequestPool(req);
    const branchId = resolveBranchIdFromRequest(req);
    const { page, limit, offset } = parsePagination(req, { defaultLimit: 100, maxLimit: 500 });
    const dataRes = await requestPool.query(
      `SELECT gl.bill_id, gl.type, gl.taxable_amount, gl.cgst, gl.sgst, gl.igst, gl.total_tax, gl.date
       FROM gst_ledger gl
       LEFT JOIN orders o ON o.id = gl.bill_id
       WHERE ${branchFilterClause}
       ORDER BY gl.date DESC
       LIMIT $2 OFFSET $3`,
      [branchId, limit, offset]
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

const pool = require('../db');
const { resolveBranchIdFromRequest } = require('../utils/branch');

const getRequestPool = (req) => req.tenantPool || pool;

const createOrUpdate = async (req, res) => {
  try {
    const requestPool = getRequestPool(req);
    const payload = req.body || {};
    const id = payload.ewayId || payload.id;
    const billId = payload.billId || payload.bill_id;
    if (!id || !billId) {
      return res.status(400).json({ success: false, error: 'ewayId and billId are required.' });
    }
    await requestPool.query(
      `INSERT INTO eway_bills (id, bill_id, transport_details, distance, gstin, generated_number, status, created_at, updated_at, is_synced)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), FALSE)
       ON CONFLICT (id) DO UPDATE
       SET transport_details = EXCLUDED.transport_details,
           distance = EXCLUDED.distance,
           gstin = EXCLUDED.gstin,
           generated_number = EXCLUDED.generated_number,
           status = EXCLUDED.status,
           updated_at = NOW()`,
      [
        id,
        billId,
        payload.transportDetails || payload.transport_details || null,
        payload.distance || null,
        payload.gstin || null,
        payload.generatedNumber || payload.generated_number || null,
        payload.status || null,
      ]
    );
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const listEway = async (req, res) => {
  try {
    const requestPool = getRequestPool(req);
    const branchId = resolveBranchIdFromRequest(req);
    const result = await requestPool.query(
      `SELECT id AS "ewayId",
              bill_id AS "billId",
              transport_details AS "transportDetails",
              distance,
              gstin,
              generated_number AS "generatedNumber",
              status,
              created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM eway_bills
       WHERE ($1::uuid IS NULL OR bill_id IN (SELECT id FROM orders WHERE branch_id = $1))
       ORDER BY created_at DESC`,
      [branchId]
    );
    return res.status(200).json({ success: true, ewayBills: result.rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const deleteEway = async (req, res) => {
  try {
    const requestPool = getRequestPool(req);
    await requestPool.query(`DELETE FROM eway_bills WHERE id = $1`, [req.params.id]);
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

module.exports = { createOrUpdate, listEway, deleteEway };

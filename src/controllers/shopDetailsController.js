const pool = require('../db');

const getRequestPool = (req) => req.tenantPool || pool;
const sanitizeUpiId = (value) => {
  if (value === undefined) return undefined;
  const normalized = String(value || '').trim();
  return normalized || null;
};
const ensureShopDetailsSchema = async (requestPool) => {
  await requestPool.query(
    `ALTER TABLE IF EXISTS shop_details
     ADD COLUMN IF NOT EXISTS upi_id VARCHAR(100)`
  );
};

const getMyShopDetails = async (req, res) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ message: 'Access Denied' });
    }

    const requestPool = getRequestPool(req);
    await ensureShopDetailsSchema(requestPool);
    const { rows } = await requestPool.query(
      `SELECT
         id,
         shop_name,
         owner_name,
         mobile_number,
         upi_id,
         gst_number,
         address_line,
         city,
         state,
         pincode,
         created_at
       FROM shop_details
       LIMIT 1`
    );

    if (rows.length === 0) {
      const tenant = req.tenant || {};
      const insertRes = await requestPool.query(
        `INSERT INTO shop_details (shop_name, owner_name, mobile_number, upi_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, shop_name, owner_name, mobile_number, upi_id, gst_number, address_line, city, state, pincode, created_at`,
        [tenant.shop_name || null, tenant.owner_name || null, tenant.mobile || null, null]
      );
      return res.status(200).json({ shop_details: insertRes.rows[0] });
    }

    return res.status(200).json({ shop_details: rows[0] });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

const updateMyShopDetails = async (req, res) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ message: 'Access Denied' });
    }

    const {
      shop_name,
      owner_name,
      mobile_number,
      upi_id,
      gst_number,
      address_line,
      city,
      state,
      pincode
    } = req.body || {};
    const isAdmin = String(req.user?.role || '').toLowerCase() === 'admin';
    if (upi_id !== undefined && !isAdmin) {
      return res.status(403).json({ message: 'Only admin can update UPI ID' });
    }

    const requestPool = getRequestPool(req);
    await ensureShopDetailsSchema(requestPool);
    const existing = await requestPool.query(
      `SELECT id FROM shop_details ORDER BY id ASC LIMIT 1`
    );

    if (existing.rowCount === 0) {
      const insertRes = await requestPool.query(
        `INSERT INTO shop_details (shop_name, owner_name, mobile_number, upi_id, gst_number, address_line, city, state, pincode)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, shop_name, owner_name, mobile_number, upi_id, gst_number, address_line, city, state, pincode, created_at`,
        [
          shop_name || null,
          owner_name || null,
          mobile_number || null,
          sanitizeUpiId(upi_id),
          gst_number || null,
          address_line || null,
          city || null,
          state || null,
          pincode || null
        ]
      );
      return res.status(200).json({ shop_details: insertRes.rows[0] });
    }

    const updates = [];
    const values = [];
    const addField = (field, value) => {
      if (value !== undefined) {
        values.push(value);
        updates.push(`${field} = $${values.length}`);
      }
    };
    addField('shop_name', shop_name);
    addField('owner_name', owner_name);
    addField('mobile_number', mobile_number);
    addField('upi_id', sanitizeUpiId(upi_id));
    addField('gst_number', gst_number);
    addField('address_line', address_line);
    addField('city', city);
    addField('state', state);
    addField('pincode', pincode);

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    values.push(existing.rows[0].id);
    const updateRes = await requestPool.query(
      `UPDATE shop_details SET ${updates.join(', ')} WHERE id = $${values.length}
       RETURNING id, shop_name, owner_name, mobile_number, upi_id, gst_number, address_line, city, state, pincode, created_at`,
      values
    );

    return res.status(200).json({ shop_details: updateRes.rows[0] });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

module.exports = { getMyShopDetails, updateMyShopDetails };

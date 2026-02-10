const pool = require('../db');

const getMyShopDetails = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Access Denied' });
    }

    const { rows } = await pool.query(
      `SELECT
         id,
         user_id,
         shop_name,
         owner_name,
         mobile_number,
         alternate_mobile,
         gst_number,
         pan_number,
         address_line,
         city,
         state,
         pincode,
         created_at,
         updated_at
       FROM shop_details
       WHERE user_id = $1`,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Shop details not found' });
    }

    return res.status(200).json({ shop_details: rows[0] });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

module.exports = { getMyShopDetails };

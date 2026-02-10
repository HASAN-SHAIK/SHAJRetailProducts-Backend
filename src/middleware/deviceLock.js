const pool = require("../db");

module.exports = async function deviceLock(req, res, next) {

  // 🔓 Allow auth routes always
  if (req.path.startsWith('/auth')) {
    return next();
  }

  const deviceId = req.headers['x-device-id'];
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!deviceId) {
    return res.status(403).json({ error: 'Device not recognized' });
  }

  const { rows } = await pool.query(
    'SELECT device_id FROM users WHERE id = $1',
    [userId]
  );

  if (!rows.length || rows[0].device_id !== deviceId) {
    return res.status(403).json({
      error: 'Access denied from this device'
    });
  }

  next();
};

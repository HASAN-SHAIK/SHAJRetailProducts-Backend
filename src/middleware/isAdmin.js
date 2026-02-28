const { getAuthUser } = require('../utils/auth');

const isAdmin = (req, res, next) => {
  try {
    const decoded = req.user || getAuthUser(req);
    if (!decoded || decoded.type !== 'tenant') {
      return res.status(401).json({ error: 'Access Denied. No token provided.' });
    }
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Access Denied. Admins only.' });
    }
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(400).json({ error: 'Invalid token' });
  }
};

module.exports = isAdmin;

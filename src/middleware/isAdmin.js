const { getAuthUser } = require('../utils/auth');

const isAdmin = (req, res, next) => {
  try {
    const decoded = req.user || getAuthUser(req);
    if (!decoded || decoded.type !== 'tenant') {
      console.warn(`[isAdmin] No tenant token provided for: ${req.method} ${req.originalUrl}`);
      return res.status(401).json({ error: 'Access Denied. No token provided.' });
    }
    if (decoded.role !== 'admin') {
      console.warn(`[isAdmin] Role '${decoded.role}' is not admin for: ${req.method} ${req.originalUrl}`);
      return res.status(403).json({ error: 'Access Denied. Admins only.' });
    }
    req.user = decoded;
    next();
  } catch (error) {
    console.error(`[isAdmin] Auth check failed for ${req.method} ${req.originalUrl}:`, error?.stack || error?.message || error);
    return res.status(400).json({ error: 'Invalid token' });
  }
};

module.exports = isAdmin;

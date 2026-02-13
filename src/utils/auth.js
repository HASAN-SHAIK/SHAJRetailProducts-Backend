const jwt = require('jsonwebtoken');

const getTokenFromRequest = (req) => {
  const cookieToken = req.cookies?.token;
  const headerToken = req.headers.authorization
    ? req.headers.authorization.replace(/^Bearer\s+/i, '')
    : null;
  return cookieToken || headerToken || null;
};

const getAuthUser = (req) => {
  if (req?.user) return req.user;
  const token = getTokenFromRequest(req);
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return null;
  }
};

module.exports = { getAuthUser };

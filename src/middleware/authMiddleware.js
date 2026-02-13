const jwt = require('jsonwebtoken');
require('dotenv').config();

exports.authMiddleware = (req, res, next) => {
    const cookieToken = req.cookies?.token;
    const headerToken = req.headers.authorization
        ? req.headers.authorization.replace(/^Bearer\s+/i, "")
        : null;
    const token = cookieToken || headerToken;
    if (!token) return res.status(401).json({ message: "Access Denied" });

    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        req.user = verified;
        next();
    } catch (error) {
        res.status(400).json({ message: "Invalid Token" });
    }
};


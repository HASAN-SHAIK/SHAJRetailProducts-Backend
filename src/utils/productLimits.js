const resolveMaxProducts = (features) => {
  const raw = features?.max_products;
  if (raw === undefined || raw === null) {
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
};

const fetchActiveProductCount = async (db) => {
  const res = await db.query(
    'SELECT COUNT(*)::int AS total FROM products WHERE is_deleted = FALSE'
  );
  return Number(res.rows[0]?.total || 0);
};

module.exports = { resolveMaxProducts, fetchActiveProductCount };

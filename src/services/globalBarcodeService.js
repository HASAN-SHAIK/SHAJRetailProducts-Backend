const masterPool = require('../db/masterPool');

const normalizeBarcode = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
};

const getGlobalProductByBarcode = async (barcode) => {
  const code = normalizeBarcode(barcode);
  if (!code) return null;
  const res = await masterPool.query(
    `SELECT barcode, name, company, category
     FROM global_products
     WHERE barcode = $1
     LIMIT 1`,
    [code]
  );
  return res.rows[0] || null;
};

const upsertGlobalProduct = async ({ barcode, name, company, category }) => {
  const code = normalizeBarcode(barcode);
  if (!code) return null;
  const res = await masterPool.query(
    `INSERT INTO global_products (barcode, name, company, category, updated_at)
     VALUES ($1, $2, $3, $4, NOW() AT TIME ZONE 'UTC')
     ON CONFLICT (barcode) DO UPDATE
       SET name = COALESCE(EXCLUDED.name, global_products.name),
           company = COALESCE(EXCLUDED.company, global_products.company),
           category = COALESCE(EXCLUDED.category, global_products.category),
           updated_at = NOW() AT TIME ZONE 'UTC'
     RETURNING barcode, name, company, category`,
    [code, name || null, company || null, category || null]
  );
  return res.rows[0] || null;
};

module.exports = { getGlobalProductByBarcode, upsertGlobalProduct };

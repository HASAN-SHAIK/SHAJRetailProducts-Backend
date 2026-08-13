const pool = require('../db');

const getRequestPool = (req) => req.tenantPool || pool;

/**
 * Legacy customer-fix product queries omit is_weight_based in a few list/search
 * projections. Hydrate only missing values so newer callers can reliably
 * distinguish piece-based and weight-based products without changing the
 * existing controller/query behavior on this branch.
 */
const hydrateProductWeight = (req, res, next) => {
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    const products = Array.isArray(body?.products)
      ? body.products
      : Array.isArray(body?.data?.products)
        ? body.data.products
        : null;

    if (!products || !products.length) {
      return originalJson(body);
    }

    const missingIds = Array.from(
      new Set(
        products
          .filter(
            (product) =>
              product?.id &&
              (product.is_weight_based === undefined || product.is_weight_based === null)
          )
          .map((product) => String(product.id))
      )
    );

    if (!missingIds.length) {
      return originalJson(body);
    }

    getRequestPool(req)
      .query(
        `SELECT id, is_weight_based
         FROM products
         WHERE id = ANY($1::uuid[])
           AND is_deleted = FALSE`,
        [missingIds]
      )
      .then(({ rows }) => {
        const weightById = new Map(
          (rows || []).map((row) => [String(row.id), row.is_weight_based])
        );
        products.forEach((product) => {
          const value = weightById.get(String(product?.id || ''));
          if (value !== undefined) {
            product.is_weight_based = value;
          }
        });
        originalJson(body);
      })
      .catch((error) => {
        console.error('Failed to hydrate product weight flags:', error);
        originalJson(body);
      });

    return res;
  };

  next();
};

module.exports = hydrateProductWeight;

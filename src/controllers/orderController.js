
const pool = require('../db'); // PostgreSQL connection pool
const getRequestPool = (req) => req.tenantPool || pool;
const { createTransaction } = require('./transactionController');
const { getDateRange } = require('../utils/dateRange');
const { resolveMaxProducts, fetchActiveProductCount } = require('../utils/productLimits');
const { upsertProductInCache, hasBarcodeColumn } = require('../services/tenantProductCache');
const {
  invalidateOrderCaches,
  invalidateSearchCache,
  cacheGet,
  cacheSet,
  buildRecentOrdersKey,
  DEFAULTS
} = require('../services/smartCache');
const { resolveBranchIdFromRequest } = require('../utils/branch');

const getTenantId = (req) => req.tenant_id || req.tenant?.id || null;

const refreshCacheForProducts = async (tenantId, requestPool, productIds, branchId = null) => {
  if (!tenantId || !productIds || productIds.length === 0) return [];
  const barcodeSelect = (await hasBarcodeColumn(requestPool))
    ? 'barcode'
    : 'NULL::text AS barcode';
  const result = await requestPool.query(
    `SELECT id,
            name,
            company,
            category,
            ${barcodeSelect},
            selling_price,
            purchase_price,
            mrp,
            hsn_code,
            gst_percentage,
            is_batch_enabled,
            stock_quantity,
            is_weight_based,
            time_for_delivery,
            expiry_date,
            created_at,
            branch_id
     FROM products
     WHERE id = ANY($1::int[])`,
    [productIds]
  );
  for (const row of result.rows) {
    upsertProductInCache(tenantId, row);
  }
  invalidateSearchCache(tenantId, branchId);
  return result.rows;
};

const mapProductsForIndexedDb = (rows) => {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    company: row.company ?? null,
    barcode: row.barcode ?? null,
    selling_price: row.selling_price,
    stock_quantity: row.stock_quantity,
    is_weight_based: row.is_weight_based,
    expiry_date: row.expiry_date ?? null
  }));
};

const normalizePaymentModeValue = (value) => {
  const mode = (value || '').toLowerCase();
  if (mode === 'upi' || mode === 'online') return 'online';
  if (mode === 'card' || mode === 'cash') return 'cash';
  return mode || null;
};

const RETURN_REASONS = new Set([
  'damaged',
  'wrong item',
  'customer changed mind',
  'billing mistake',
  'expired',
  'other'
]);

const REFUND_MODES = new Set(['cash', 'upi', 'bank', 'wallet', 'exchange', 'online']);

const resolveIsGstEnabled = (req, payload) => {
  if (payload && payload.is_gst_enabled !== undefined) {
    return Boolean(payload.is_gst_enabled);
  }
  if (req?.planFeatures?.GST_invoice_enabled !== undefined) {
    return Boolean(req.planFeatures.GST_invoice_enabled);
  }
  if (req?.planFeatures?.gst_enabled !== undefined) {
    return Boolean(req.planFeatures.gst_enabled);
  }
  if (req?.planFeatures?.enable_gst !== undefined) {
    return Boolean(req.planFeatures.enable_gst);
  }
  return true;
};

const resolveOrderLocation = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload.location || payload.customer_location || 'Other';
  const cleaned = typeof raw === 'string' ? raw.trim() : raw;
  return cleaned ? cleaned : 'Other';
};

const buildCustomerPayload = (req) => {
  const { customer, customer_name, customer_phone, customer_address, customer_location, location } = req.body || {};
  if (customer && typeof customer === 'object') return customer;
  if (!customer_name && !customer_phone && !customer_address && !customer_location && !location) return null;
  return {
    name: customer_name,
    mobile: customer_phone,
    address: customer_address,
    location: customer_location || location || null
  };
};

const buildCustomerPayloadFromOrder = (order) => {
  if (!order || typeof order !== 'object') return null;
  if (order.customer && typeof order.customer === 'object') return order.customer;
  const { customer_name, customer_phone, customer_address, customer_location, location } = order;
  if (!customer_name && !customer_phone && !customer_address && !customer_location && !location) return null;
  return {
    name: customer_name || null,
    mobile: customer_phone || null,
    address: customer_address || null,
    location: customer_location || location || null
  };
};

const validateCustomer = (req) => {
  const { customer_id } = req.body || {};
  if (customer_id) return null;
  const resolvedCustomer = buildCustomerPayload(req);
  if (!resolvedCustomer) return null;
  if (!resolvedCustomer.name || !resolvedCustomer.mobile) {
    return 'Customer name and phone are required';
  }
  return null;
};

const upsertCustomer = async (tenantPool, customer) => {
  const { name, mobile, address, location } = customer;
  const existing = await tenantPool.query(
    'SELECT id FROM customers WHERE mobile = $1',
    [mobile]
  );
  if (existing.rowCount > 0) return existing.rows[0].id;

  const insertRes = await tenantPool.query(
    'INSERT INTO customers (name, mobile, address, location) VALUES ($1, $2, $3, $4) RETURNING id',
    [name || null, mobile || null, address || null, location || null]
  );
  return insertRes.rows[0].id;
};

const buildValidationError = (message) => {
  const err = new Error(message);
  err.status = 400;
  return err;
};

const normalizeReturnReason = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;
  const normalized = text.toLowerCase();
  return RETURN_REASONS.has(normalized) ? text : text;
};

const normalizeRefundMode = (value) => {
  const normalized = normalizePaymentModeValue(value);
  if (!normalized) return null;
  return REFUND_MODES.has(normalized) ? normalized : normalized;
};

const resolveReturnStatus = (orderTotal, returnedTotal) => {
  const total = Number(orderTotal || 0);
  const returned = Number(returnedTotal || 0);
  if (!Number.isFinite(total) || total <= 0) return 'completed';
  if (!Number.isFinite(returned) || returned <= 0) return 'completed';
  if (returned + 0.0001 < total) return 'partially_returned';
  return 'fully_returned';
};

const validateReturnQuantity = (qty, isWeightBased) => {
  if (!Number.isFinite(qty) || qty <= 0) {
    throw buildValidationError('return quantity must be > 0');
  }
  if (!isWeightBased && !Number.isInteger(qty)) {
    throw buildValidationError('Non-integer quantity not allowed for piece based items');
  }
};

const normalizeNumber = (value) => {
    if (value === null || value === undefined) return NaN;
    if (typeof value === 'string' && value.trim() === '') return NaN;
    return Number(value);
  };

  const computeLineMetrics = ({
    sellingPrice,
    purchasePrice,
    quantity,
    discountAmount,
    gstPercent,
    isGstEnabled
  }) => {
    const price = normalizeNumber(sellingPrice);
    const cost = normalizeNumber(purchasePrice);
    const qty = normalizeNumber(quantity);
    const discount = Number.isFinite(normalizeNumber(discountAmount))
      ? normalizeNumber(discountAmount)
      : 0;
    const gst = Number.isFinite(normalizeNumber(gstPercent))
      ? normalizeNumber(gstPercent)
      : 0;

    const lineTotal = Number.isFinite(price) && Number.isFinite(qty) ? price * qty : 0;
    const taxable = Math.max(lineTotal - (Number.isFinite(discount) ? discount : 0), 0);
    const gstAmount = isGstEnabled ? (taxable * (Number.isFinite(gst) ? gst : 0)) / 100 : 0;
    const profit =
      (Number.isFinite(price) ? price : 0) * (Number.isFinite(qty) ? qty : 0) -
      (Number.isFinite(cost) ? cost : 0) * (Number.isFinite(qty) ? qty : 0) -
      (Number.isFinite(discount) ? discount : 0);
    const marginPercent = lineTotal > 0 ? (profit / lineTotal) * 100 : 0;

    return {
      line_total: lineTotal,
      discount_amount: Number.isFinite(discount) ? discount : 0,
      taxable_amount: taxable,
      gst_amount: gstAmount,
      profit,
      margin_percent: marginPercent
    };
  };

  const isUuid = (value) =>
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

  const ensureBranchExists = async (client, branchId) => {
    const branchRes = await client.query('SELECT id FROM branches WHERE id = $1', [branchId]);
    if (branchRes.rowCount === 0) {
      throw buildValidationError('Invalid branch_id.');
    }
  };

  const resolveBranchId = async (client, branchIdInput) => {
    if (isUuid(branchIdInput)) {
      await ensureBranchExists(client, branchIdInput);
      return branchIdInput;
    }

    const branchesRes = await client.query(
      'SELECT id FROM branches ORDER BY created_at ASC LIMIT 2'
    );
    if (branchesRes.rowCount === 1) {
      return branchesRes.rows[0].id;
    }
    if (branchesRes.rowCount === 0) {
      throw buildValidationError('No branches found.');
    }
    throw buildValidationError('branch_id is required.');
  };

  const allocateBatchStock = async (client, productId, branchId, quantity) => {
    const batchesRes = await client.query(
      `SELECT id, quantity
       FROM batches
       WHERE product_id = $1 AND branch_id = $2 AND quantity > 0
       ORDER BY expiry_date ASC NULLS LAST, created_at ASC
       FOR UPDATE`,
      [productId, branchId]
    );

    if (batchesRes.rowCount === 0) {
      const productRes = await client.query(
        `SELECT stock_quantity, branch_id
         FROM products
         WHERE id = $1 AND is_deleted = FALSE
         FOR UPDATE`,
        [productId]
      );
      if (productRes.rowCount === 0) {
        throw buildValidationError(`Product ID ${productId} not found or deleted.`);
      }
      const product = productRes.rows[0];
      if (product.branch_id && product.branch_id !== branchId) {
        throw buildValidationError(`Product ID ${productId} not available in selected branch.`);
      }
      const stock = normalizeNumber(product.stock_quantity);
      if (!Number.isFinite(stock) || stock < quantity) {
        throw buildValidationError(`Insufficient stock for Product ID ${productId} in selected branch.`);
      }
      return;
    }

    let remaining = quantity;
    const updates = [];
    for (const batch of batchesRes.rows) {
      if (remaining <= 0) break;
      const available = Number(batch.quantity || 0);
      if (available <= 0) continue;
      const deduct = Math.min(available, remaining);
      remaining -= deduct;
      updates.push({ id: batch.id, remaining: available - deduct });
    }

    if (remaining > 0) {
      throw buildValidationError(`Insufficient stock for Product ID ${productId} in selected branch.`);
    }

    for (const update of updates) {
      await client.query(
        'UPDATE batches SET quantity = $1 WHERE id = $2',
        [update.remaining, update.id]
      );
    }
  };

const validateQuantityForProduct = (quantity, product, productIdForMessage) => {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw buildValidationError('quantity must be > 0');
  }

  const isWeightBased = Number(product.is_weight_based) === 1;
  if (!isWeightBased && !Number.isInteger(quantity)) {
    throw buildValidationError('Non-integer quantity not allowed for piece based items');
  }

  const stock = normalizeNumber(product.stock_quantity);
  if (!Number.isFinite(stock) || stock < quantity) {
    const productId = productIdForMessage ?? product.id ?? product.product_id;
    throw buildValidationError(`Insufficient stock for Product ID ${productId}. Available: ${product.stock_quantity}`);
  }
};

//Get Order Profit
const getProfitByOrderId = async (orderId, db) => {
    try {
      const requestPool = db || pool;
      const query = `
        SELECT 
          oi.quantity,
          oi.selling_price,
          oi.purchase_price_snapshot,
          oi.profit
        FROM order_items oi
        WHERE oi.order_id = $1
      `;
  
      const { rows } = await requestPool.query(query, [orderId]);
  
      let totalProfit = 0, total_price = 0;
  
      for (const item of rows) {
        const fallbackProfit =
          (Number(item.selling_price || 0) - Number(item.purchase_price_snapshot || 0)) *
          Number(item.quantity || 0);
        const profitPerItem = Number(item.profit ?? fallbackProfit);
        total_price += (Number(item.selling_price || 0) * Number(item.quantity || 0));
        totalProfit += profitPerItem;
      }
  
      return { order_id: orderId, profit: totalProfit, total_price };
  
    } catch (error) {
      console.error("Error calculating profit:", error.message);
      throw error;
    }
  };

// 🟢 Helper Function: Check Product Availability
const checkProductAvailability = async (client, items) => {
    for (const item of items) {
        const { product_id, quantity } = item;
        const productRes = await client.query(
            'SELECT stock_quantity, is_weight_based FROM products WHERE id = $1 AND is_deleted = FALSE FOR UPDATE',
            [product_id]
        );

        if (productRes.rowCount === 0) {
            throw new Error(`Product ID ${product_id} not found or deleted.`);
        }

        const qty = normalizeNumber(quantity);
        validateQuantityForProduct(qty, productRes.rows[0], product_id);
    }
};

// 🟢 Helper Function: Update Stock and Insert Order Items
const processOrderItems = async (client, orderId, items) => {
    let totalPrice = 0;

    for (const item of items) {
        const { product_id, quantity } = item;
        const qty = normalizeNumber(quantity);

        // Get selling_price of the product
        const priceRes = await client.query('SELECT selling_price, stock_quantity, is_weight_based FROM products WHERE id = $1', [product_id]);
        const product = priceRes.rows[0];
        validateQuantityForProduct(qty, product, product_id);
        const selling_price = normalizeNumber(product.selling_price);
        totalPrice += selling_price * qty;

        // Insert into order_items
        await client.query(
            'INSERT INTO order_items (order_id, product_id, quantity, selling_price) VALUES ($1, $2, $3, $4)',
            [orderId, product_id, qty, selling_price]
        );

        // Update product stock
        await client.query(
            'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
            [qty, product_id]
        );
    }

    return totalPrice;
};

  const saleOrder = async(req, res) => {
      const requestPool = getRequestPool(req);
      const client = await requestPool.connect();
      try {
          await client.query("BEGIN");
          const { products, payment_method, payment_mode } = req.body;
            const branchId = await resolveBranchId(client, req.body?.branch_id);
          const resolvedLocation = resolveOrderLocation(req.body);
          if (!products || products.length === 0) {
              throw buildValidationError("Should have products");
          }
        if (req.planFeatures?.customer_details_enabled) {
            const customerError = validateCustomer(req);
            if (customerError) {
                throw buildValidationError(customerError);
            }
        }

        const productIds = [...new Set(products.map((item) => item.product_id))];
        const productRes = await client.query(
            "SELECT id, selling_price, purchase_price, stock_quantity, is_weight_based FROM products WHERE id = ANY($1) AND is_deleted = FALSE FOR UPDATE",
            [productIds]
        );

        if (productRes.rowCount !== productIds.length) {
            const foundIds = new Set(productRes.rows.map((row) => row.id));
            const missingId = productIds.find((id) => !foundIds.has(id));
            throw buildValidationError(`Product ID ${missingId} not found or deleted.`);
        }

        const productById = new Map(productRes.rows.map((row) => [row.id, row]));
        const requestedQtyByProduct = new Map();
        const preparedItems = [];
        const isGstEnabled = resolveIsGstEnabled(req, req.body);
        let total_price = 0;
        let total_profit = 0;

        for (const item of products) {
            const product = productById.get(item.product_id);
            const qty = normalizeNumber(item.quantity);
            if (!Number.isFinite(qty) || qty <= 0) {
                throw buildValidationError('quantity must be > 0');
            }
            const isWeightBased = Number(product.is_weight_based) === 1;
            if (!isWeightBased && !Number.isInteger(qty)) {
                throw buildValidationError('Non-integer quantity not allowed for piece based items');
            }

            const sellingPrice = normalizeNumber(item.selling_price ?? item.price ?? item.unit_price ?? product.selling_price);
            if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) {
              throw new Error('selling_price must be > 0');
            }
            if (!Number.isFinite(sellingPrice) || sellingPrice <= 0) {
              throw buildValidationError('selling_price must be > 0');
            }
            const purchasePriceSnapshot = normalizeNumber(product.purchase_price);
            const discountAmount = normalizeNumber(item.discount_amount ?? item.discount) || 0;
            const gstPercent = normalizeNumber(product.gst_percentage) || 0;
            const metrics = computeLineMetrics({
              sellingPrice,
              purchasePrice: purchasePriceSnapshot,
              quantity: qty,
              discountAmount,
              gstPercent,
              isGstEnabled
            });
            total_price += metrics.line_total - metrics.discount_amount;
            total_profit += metrics.profit;
            preparedItems.push({
              product_id: item.product_id,
              qty,
              sellingPrice,
              purchasePriceSnapshot,
              discountAmount: metrics.discount_amount,
              gstPercent,
              profit: metrics.profit,
              marginPercent: metrics.margin_percent
            });

            const prevQty = requestedQtyByProduct.get(item.product_id) || 0;
            requestedQtyByProduct.set(item.product_id, prevQty + qty);
        }

          for (const [productId, totalQty] of requestedQtyByProduct.entries()) {
              await allocateBatchStock(client, productId, branchId, totalQty);
          }

        const resolvedPaymentMode = normalizePaymentModeValue(payment_mode || payment_method);
        const orderStatus = 'pending';

        let resolvedCustomerId = req.body?.customer_id || null;
        const resolvedCustomer = buildCustomerPayload(req);
        if (!resolvedCustomerId && resolvedCustomer) {
            resolvedCustomerId = await upsertCustomer(client, resolvedCustomer);
        }
        const resolvedCustomerPhone = resolvedCustomer?.mobile || req.body?.customer_phone || null;

          const orderResult = await client.query(
              "INSERT INTO orders (user_id, customer_id, customer_phone, branch_id, total_price, order_status, payment_mode, location, transaction_type, is_gst_enabled) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id",
              [req.user?.user_id || null, resolvedCustomerId, resolvedCustomerPhone, branchId, total_price, orderStatus, resolvedPaymentMode || null, resolvedLocation, 'sale', isGstEnabled]
          );
        const order_id = orderResult.rows[0].id;

        const orderItemProductIds = preparedItems.map((item) => item.product_id);
        const orderItemQuantities = preparedItems.map((item) => item.qty);
        const orderItemPrices = preparedItems.map((item) => item.sellingPrice);
        const orderItemPurchaseSnapshots = preparedItems.map((item) => item.purchasePriceSnapshot);
        const orderItemDiscounts = preparedItems.map((item) => item.discountAmount);
        const orderItemGstPercents = preparedItems.map((item) => item.gstPercent);
        const orderItemProfits = preparedItems.map((item) => item.profit);
        const orderItemMargins = preparedItems.map((item) => item.marginPercent);

        await client.query(
            `INSERT INTO order_items (
                order_id,
                product_id,
                quantity,
                selling_price,
                purchase_price_snapshot,
                discount_amount,
                gst_percent,
                profit,
                margin_percent
             )
             SELECT $1,
                    unnest($2::int[]),
                    unnest($3::numeric[]),
                    unnest($4::numeric[]),
                    unnest($5::numeric[]),
                    unnest($6::numeric[]),
                    unnest($7::numeric[]),
                    unnest($8::numeric[]),
                    unnest($9::numeric[])`,
            [
              order_id,
              orderItemProductIds,
              orderItemQuantities,
              orderItemPrices,
              orderItemPurchaseSnapshots,
              orderItemDiscounts,
              orderItemGstPercents,
              orderItemProfits,
              orderItemMargins
            ]
        );

        const stockProductIds = [];
        const stockQuantities = [];
        for (const [productId, totalQty] of requestedQtyByProduct.entries()) {
            stockProductIds.push(productId);
            stockQuantities.push(totalQty);
        }

          await client.query(
              `UPDATE products p
               SET stock_quantity = p.stock_quantity - u.qty
               FROM (
                 SELECT unnest($1::int[]) AS product_id, unnest($2::numeric[]) AS qty
               ) AS u
               WHERE p.id = u.product_id`,
              [stockProductIds, stockQuantities]
          );

        // Payment should be recorded only when payment is actually made (mark paid).
        await client.query("COMMIT");

        let updatedProducts = [];
        const tenantId = getTenantId(req);
        if (tenantId) {
          try {
            const refreshed = await refreshCacheForProducts(
              tenantId,
              requestPool,
              stockProductIds,
              branchId
            );
            updatedProducts = mapProductsForIndexedDb(refreshed);
          } catch (error) {
            console.error('Failed to refresh product cache after sale order:', error);
          }
          invalidateOrderCaches(tenantId, branchId);
        }

        res.status(201).json({
          message: "Order created successfully",
          order_id,
          payment_mode: resolvedPaymentMode,
          updated_products: updatedProducts
        });
    } catch (error) {
        await client.query("ROLLBACK");
        const status = error.status || 400;
        res.status(status).json({ error: error.message });
    } finally {
        client.release();
    } 
}

  const createPurchaseOrder = async (req, res) => {
      const requestPool = getRequestPool(req);
      const client = await requestPool.connect();
      try {
          if (req.user?.role !== 'admin') {
              return res.status(403).json({ message: "Admin access required" });
          }
          await client.query("BEGIN"); // Start transaction
          const { products, total_amount, payment_mode, branch_id } = req.body;
          const resolvedBranchId = await resolveBranchId(client, branch_id);
          const resolvedLocation = resolveOrderLocation(req.body);
          if (!products || products.length === 0) {
              return res.status(400).json({ message: "No items provided for purchase" });
          }
        const maxProducts = resolveMaxProducts(req.features);
        let currentProductCount = null;
        let newProductsAdded = 0;
        if (maxProducts !== null) {
            currentProductCount = await fetchActiveProductCount(client);
        }
        // Step 1: Create the order entry
        const resolvedPaymentMode = normalizePaymentModeValue(payment_mode);
        const orderStatus = 'pending';
          const orderQuery = `
              INSERT INTO orders (customer_phone, branch_id, total_price, order_status, payment_mode, location, transaction_type, is_gst_enabled)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id;
          `;
          const orderResult = await client.query(orderQuery, [null, resolvedBranchId, total_amount, orderStatus, resolvedPaymentMode || null, resolvedLocation, 'purchase', false]);
          const orderId = orderResult.rows[0].id;
          // Step 2: Process each item in the purchase order
          const touchedProductIds = new Set();
          for (let item of products) {
              const { product_name, company, quantity, purchase_price, selling_price, category, time_for_delivery, is_weight_based, batch_number, expiry_date } = item;
              const expiryDate = expiry_date ? new Date(expiry_date) : null;
              if (expiryDate && Number.isNaN(expiryDate.getTime())) {
                  const err = new Error('Invalid expiry_date');
                  err.status = 400;
                  throw err;
              }
              // Check if the product already exists
              const productQuery = `SELECT * FROM products WHERE name ilike $1 AND company ilike $2;`;
              const productResult = await client.query(productQuery, [product_name, company]);
              if (productResult.rows.length > 0) {
                // Product exists: only update quantity + prices
                const existingProduct = productResult.rows[0];
                const existingQty = normalizeNumber(existingProduct.stock_quantity);
                const incomingQty = normalizeNumber(quantity);
                const newQuantity = existingQty + incomingQty;

                const existingPurchasePrice = normalizeNumber(existingProduct.purchase_price);
                const incomingPurchasePrice = normalizeNumber(purchase_price);
                const newPurchasePrice = Number.isFinite(incomingPurchasePrice)
                  ? (existingPurchasePrice * existingQty + incomingPurchasePrice * incomingQty) / newQuantity
                  : existingPurchasePrice;

                const resolvedSellingPrice = selling_price ?? existingProduct.selling_price;

                  const updateProductQuery = `
                      UPDATE products
                      SET stock_quantity = $1, purchase_price = $2, selling_price = $3
                      WHERE id = $4;
                  `;
                  await client.query(updateProductQuery, [newQuantity, newPurchasePrice, resolvedSellingPrice, existingProduct.id]);
                  touchedProductIds.add(existingProduct.id);
                  await client.query(
                    `INSERT INTO batches (product_id, branch_id, batch_number, expiry_date, purchase_price, selling_price, quantity)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [existingProduct.id, resolvedBranchId, batch_number || null, expiryDate, purchase_price, resolvedSellingPrice, quantity]
                  );
              } else {
                  if (maxProducts !== null) {
                      const projectedTotal = currentProductCount + newProductsAdded + 1;
                      if (projectedTotal > maxProducts) {
                        const err = new Error(`Product limit reached (${maxProducts}). Upgrade plan to add more products.`);
                        err.status = 403;
                        throw err;
                    }
                }
                // Product does not exist, insert as a new product
                  const insertProductQuery = `
                      INSERT INTO products (name, company, stock_quantity, purchase_price, selling_price, category, time_for_delivery, is_weight_based)
                      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                      RETURNING id;
                  `;
                  const inserted = await client.query(insertProductQuery, [product_name, company, quantity, purchase_price, selling_price, category, time_for_delivery, is_weight_based ?? 0]);
                  if (inserted.rowCount > 0) {
                      touchedProductIds.add(inserted.rows[0].id);
                      newProductsAdded += 1;
                      await client.query(
                        `INSERT INTO batches (product_id, branch_id, batch_number, expiry_date, purchase_price, selling_price, quantity)
                         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                        [inserted.rows[0].id, resolvedBranchId, batch_number || null, expiryDate, purchase_price, selling_price, quantity]
                      );
                  }
              }
            // Step 3: Insert into order_items
            // const insertOrderItemQuery = `
            //     INSERT INTO order_items (order_id, product_name, company, quantity, purchase_price, selling_price)
            //     VALUES ($1, $2, $3, $4, $5, $6);
            // `;
            // await client.query(insertOrderItemQuery, [orderId, product_name, company, quantity, purchase_price, selling_price]);
        }
        // Step 4: Insert into transactions as a purchase
        // Payment should be recorded only when payment is actually made (mark paid).
        const productIds = Array.from(touchedProductIds);
        const productsRes = productIds.length
            ? await client.query(
                `SELECT id, name, company, stock_quantity, purchase_price, selling_price, category, time_for_delivery, is_weight_based
                 FROM products
                 WHERE id = ANY($1::int[])`,
                [productIds]
              )
            : { rows: [] };

        await client.query("COMMIT"); // Commit transaction

        let updatedProducts = [];
        const tenantId = getTenantId(req);
        if (tenantId && productIds.length > 0) {
          try {
            const refreshed = await refreshCacheForProducts(
              tenantId,
              requestPool,
              productIds,
              resolvedBranchId
            );
            updatedProducts = mapProductsForIndexedDb(refreshed);
          } catch (error) {
            console.error('Failed to refresh product cache after purchase order:', error);
          }
          invalidateOrderCaches(tenantId, resolvedBranchId);
        }

        res.status(201).json({
          message: "Purchase order created successfully",
          orderId,
          products: productsRes.rows,
          updated_products: updatedProducts
        });
    } catch (error) {
        await client.query("ROLLBACK"); // Rollback transaction on error
        console.error("Error creating purchase order:", error);
        const status = error.status || 500;
        res.status(status).json({ message: error.message || "Internal server error" });
    } finally {
        client.release(); // Release client back to pool
    }
 };

const createPersonalOrder = async (req, res) => {
  const requestPool = getRequestPool(req);
  const client = await requestPool.connect();

  try {

    const { total_amount, payment_method, payment_mode } = req.body;
    const resolvedLocation = resolveOrderLocation(req.body);

    if (!total_amount) {
      return res.status(400).json({ error: "Amount is required" });
    }

    await client.query("BEGIN"); // Start transaction

    // 1️⃣ Create a Personal Order

    const resolvedPaymentMode = normalizePaymentModeValue(payment_mode || payment_method);
    const orderStatus = 'pending';

    const orderQuery = `
      INSERT INTO orders (customer_phone, total_price, order_status, payment_mode, location, transaction_type, is_gst_enabled)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id;
    `;

    const orderResult = await client.query(orderQuery, [null, total_amount, orderStatus, resolvedPaymentMode || null, resolvedLocation, 'personal', false]);

    const orderId = orderResult.rows[0].id;

    // 2️⃣ Insert into Transactions (Type: Personal)

    // Payment should be recorded only when payment is actually made (mark paid).

    await client.query("COMMIT"); // Commit transaction
    const tenantId = getTenantId(req);
    const branchId = resolveBranchIdFromRequest(req);
    if (tenantId) {
      invalidateOrderCaches(tenantId, branchId);
    }
    res.status(201).json({ message: "Personal transaction recorded successfully", orderId });

  } catch (error) {

    await client.query("ROLLBACK"); // Rollback on error

    console.error("Error creating personal order:", error);

    res.status(500).json({ error: "Failed to create personal transaction" });

  } finally {

    client.release(); // Release the client

  }

};


// 🟢 Create Order
const createOrder = async (req, res) => {
    const { transaction_type } = req.body;
    if(!transaction_type)
        return res.status(400).json({ error: "transaction type should be provided"});
    if(transaction_type === 'sale') 
        await saleOrder(req, res);
    else if(transaction_type === 'purchase')
        await createPurchaseOrder(req, res);
    else if(transaction_type === 'personal')
        await createPersonalOrder(req, res);
    else
        res.json({message: "transaction type should be sent for creating order"});
    // const client = await pool.connect();
    // try {
    //     const { type, payment_mode } = req.query;
    //     await client.query("BEGIN");
    //     const { user_id, products } = req.body;
    //     let total_price = 0;
    //     let total_profit = 0;
    //     for (const product of products) {
    //         const { rows } = await client.query(
    //             "SELECT selling_price, purchase_price, stock_quantity FROM products WHERE id = $1 FOR UPDATE",
    //             [product.product_id]
    //         );
    //         if (rows.length === 0 || rows[0].stock_quantity < product.quantity) {
    //             throw new Error("Product not available or insufficient stock");
    //         }
    //         const sellingPrice = rows[0].selling_price;
    //         const purchasePrice = rows[0].purchase_price;
    //         const profit = (sellingPrice - purchasePrice) * product.quantity;
    //         total_price += sellingPrice * product.quantity;
    //         total_profit += profit;
    //         await client.query(
    //             "UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2",
    //             [product.quantity, product.product_id]
    //         );

    //     }
    //     const orderResult = await client.query(
    //         "INSERT INTO orders (user_id, total_price, order_status) VALUES ($1, $2, 'pending') RETURNING id",
    //         [user_id, total_price]
    //     );
    //     const order_id = orderResult.rows[0].id;
    //     for (const item of products) {
    //     console.log(item);
    //     const productResult = await client.query("SELECT * from PRODUCTS where id = $1", [item.product_id]);
    //     const product = productResult.rows[0];
    //     console.log(product)
    //     await client.query(
    //         `INSERT INTO order_items (order_id, product_id, quantity, selling_price) VALUES($1, $2, $3, $4)`,
    //         [order_id, product.id, item.quantity, product.selling_price]
    //     );
    //     }
        
    //     await client.query("COMMIT");
    //     res.status(201).json({ message: "Order created successfully", order_id, payment_mode: payment_mode });
    // } catch (error) {
    //     await client.query("ROLLBACK");
    //     res.status(400).json({ error: error.message });
    // } finally {
    //     client.release();
    // }
 };

// 🟢 Get Order by ID
const getOrderById = async (req, res) => {
    try {
        const tenantId = req.user?.tenant_id;
        if (req.tenantPool && !tenantId) {
            return res.status(401).json({ error: "Missing tenant_id" });
        }
        const requestPool = getRequestPool(req);
        const { id } = req.params;
        const view = String(req.query?.view || '').toLowerCase();
        if (view === 'mobile') {
            const orderRes = await requestPool.query(
                `SELECT id,
                        order_status,
                        total_price AS total
                 FROM orders
                 WHERE id = $1`,
                [id]
            );
            if (orderRes.rowCount === 0) {
                return res.status(404).json({ error: "Order not found" });
            }
            const itemsRes = await requestPool.query(
                `SELECT p.name AS product_name,
                        oi.quantity,
                        oi.selling_price AS price
                 FROM order_items oi
                 JOIN products p ON p.id = oi.product_id
                 WHERE oi.order_id = $1`,
                [id]
            );
            const orderRow = orderRes.rows[0];
            return res.json({
                id: orderRow.id,
                status: orderRow.order_status,
                total: Number(orderRow.total || 0),
                items: itemsRes.rows.map((row) => ({
                    product_name: row.product_name,
                    quantity: Number(row.quantity || 0),
                    price: Number(row.price || 0)
                }))
            });
        }
          const orderRes = await requestPool.query(
                `SELECT o.id,
                        o.total_price AS total_amount,
                        o.order_status,
                        o.returned_amount,
                        o.payment_mode,
                        o.is_gst_enabled,
                        o.created_at,
                        o.customer_id,
                        o.customer_phone,
                      u.name AS user_name,
                      c.name AS customer_name,
                      c.mobile AS customer_mobile,
                      c.address AS customer_address,
                      COALESCE(t.total_paid, 0)::numeric AS total_paid
               FROM orders o
               LEFT JOIN users u ON o.user_id = u.id
                 LEFT JOIN customers c ON c.id = o.customer_id
                 LEFT JOIN (
                   SELECT order_id, COALESCE(SUM(total_price), 0)::numeric AS total_paid
                   FROM transactions
                   WHERE transaction_type IS NULL OR transaction_type <> 'refund'
                   GROUP BY order_id
                 ) t ON t.order_id = o.id
                 WHERE o.id = $1`,
                [id]
            );

        if (orderRes.rowCount === 0) {
            return res.status(404).json({ error: "Order not found" });
        }

          const orderItems = await requestPool.query(
              `SELECT p.id AS product_id,
                      p.name AS product_name,
                      p.is_weight_based,
                      oi.quantity,
                      oi.selling_price,
                      oi.purchase_price_snapshot,
                      oi.discount_amount,
                      oi.gst_percent,
                      oi.profit,
                      oi.margin_percent,
                      (oi.quantity * oi.selling_price - COALESCE(oi.discount_amount, 0))::numeric AS line_total
               FROM order_items oi
               JOIN products p ON p.id = oi.product_id
               WHERE oi.order_id = $1`,
              [id]
          );

          const returnedItemsRes = await requestPool.query(
              `SELECT ori.product_id,
                      COALESCE(SUM(ori.quantity), 0)::numeric AS returned_qty
               FROM order_return_items ori
               JOIN order_returns r ON r.id = ori.return_id
               WHERE r.order_id = $1
               GROUP BY ori.product_id`,
              [id]
          );
          const returnedByProduct = new Map(
              returnedItemsRes.rows.map((row) => [Number(row.product_id), Number(row.returned_qty || 0)])
          );

          const paymentsRes = await requestPool.query(
              `SELECT id,
                      total_price AS amount,
                      payment_mode,
                      transaction_type,
                      created_at
               FROM transactions
               WHERE order_id = $1
               ORDER BY created_at ASC`,
              [id]
          );

          const orderRow = orderRes.rows[0];
          const totalAmount = Number(orderRow.total_amount || 0);
          const totalPaid = Number(orderRow.total_paid || 0);
          const returnedAmount = Number(orderRow.returned_amount || 0);
          const balance = Math.max(totalAmount - totalPaid - returnedAmount, 0);
          const completedLike = ['completed', 'partially_returned', 'fully_returned'];
          const paymentHistory = completedLike.includes(orderRow.order_status)
              ? paymentsRes.rows
                  .filter((row) => row.transaction_type !== 'refund')
                  .map((row) => ({
                  id: row.id,
                  amount: Number(row.amount || 0),
                  payment_mode: row.payment_mode,
                  created_at: row.created_at
              }))
              : [];
        let paymentAction = 'none';
        if (!completedLike.includes(orderRow.order_status)) {
            const mode = (orderRow.payment_mode || '').toLowerCase();
            paymentAction = mode === 'online' ? 'pay_online' : 'mark_paid';
        }

        let paymentStatus = 'unpaid';
          if (totalPaid === 0) {
              paymentStatus = 'unpaid';
          } else if (totalPaid + returnedAmount < totalAmount) {
              paymentStatus = 'partial';
          } else {
              paymentStatus = 'paid';
          }

        const customerDetailsEnabled = Boolean(req.planFeatures?.customer_details_enabled);
          res.json({
              order: {
                  id: orderRow.id,
                  order_status: orderRow.order_status,
                  returned_amount: returnedAmount,
                  customer: customerDetailsEnabled && orderRow.customer_id
                      ? {
                            id: orderRow.customer_id,
                            name: orderRow.customer_name,
                            mobile: orderRow.customer_mobile,
                          address: orderRow.customer_address
                      }
                    : null,
                customer_phone: orderRow.customer_phone || null,
                  items: orderItems.rows.map((row) => {
                      const soldQty = Number(row.quantity || 0);
                      const returnedQty = returnedByProduct.get(Number(row.product_id)) || 0;
                      return {
                          product_id: row.product_id,
                          product_name: row.product_name,
                          quantity: soldQty,
                          returned_quantity: returnedQty,
                          remaining_quantity: Math.max(soldQty - returnedQty, 0),
                          selling_price: Number(row.selling_price || 0),
                          purchase_price_snapshot: Number(row.purchase_price_snapshot || 0),
                          discount_amount: Number(row.discount_amount || 0),
                          gst_percent: Number(row.gst_percent || 0),
                          profit: Number(row.profit || 0),
                          margin_percent: Number(row.margin_percent || 0),
                          line_total: Number(row.line_total || 0),
                          is_weight_based: row.is_weight_based
                      };
                  }),
                  payments: paymentHistory,
                  payment_history: paymentHistory,
                  total_amount: totalAmount,
                  total_paid: totalPaid,
                  balance,
            payment_status: paymentStatus,
            payment_mode: orderRow.payment_mode,
            payment_action: paymentAction,
                is_gst_enabled: orderRow.is_gst_enabled === true,
                created_at: orderRow.created_at
            },
            customer_details_enabled: customerDetailsEnabled
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// 🟢 Get All Orders
const getAllOrders = async (req, res) => {
    try {
        const tenantId = req.user?.tenant_id;
        if (req.tenantPool && !tenantId) {
            return res.status(401).json({ error: "Missing tenant_id" });
        }
        const requestPool = getRequestPool(req);
        const branchId = resolveBranchIdFromRequest(req);
        const sinceRaw = req.query?.since;
        if (sinceRaw) {
            const sinceDate = new Date(sinceRaw);
            if (Number.isNaN(sinceDate.getTime())) {
                return res.status(400).json({ error: "Invalid since timestamp" });
            }
            const resolvedLimit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 100, 1), 500);
              const ordersRes = await requestPool.query(
                  `SELECT o.id,
                          o.total_price AS total_amount,
                          o.created_at,
                          o.order_status,
                          o.payment_mode,
                          o.is_gst_enabled,
                          o.returned_amount,
                          c.name AS customer_name,
                          COALESCE(o.customer_phone, c.mobile) AS customer_phone,
                          COALESCE(o.product_count, 0)::int AS product_count,
                          COALESCE(o.product_summary, '') AS product_names,
                          COALESCE(o.total_paid, 0)::numeric AS total_paid
                   FROM orders o
                   LEFT JOIN customers c ON c.id = o.customer_id
                   WHERE o.created_at >= $1
                     AND ($2::uuid IS NULL OR o.branch_id = $2)
                   ORDER BY o.created_at ASC, o.id ASC
                   LIMIT $3`,
                  [sinceDate, branchId, resolvedLimit]
              );

            const customerDetailsEnabled = Boolean(req.planFeatures?.customer_details_enabled);
            const orders = ordersRes.rows.map((order) => {
                const totalAmount = Number(order.total_amount || 0);
                const totalPaid = Number(order.total_paid || 0);
                const returnedAmount = Number(order.returned_amount || 0);
                const balance = Math.max(totalAmount - totalPaid - returnedAmount, 0);
                const productList = String(order.product_names || '')
                    .split(',')
                    .map((name) => name.trim())
                    .filter(Boolean);
                const displayProducts = productList.slice(0, 3);
                const productsSummary =
                    productList.length > 3
                        ? `${displayProducts.slice(0, 2).join(', ')} +${productList.length - 2} more`
                        : displayProducts.join(', ');
                let paymentStatus = 'unpaid';
                if (totalPaid === 0) {
                    paymentStatus = 'unpaid';
                } else if (totalPaid + returnedAmount < totalAmount) {
                    paymentStatus = 'partial';
                } else {
                    paymentStatus = 'paid';
                }
                let paymentAction = 'none';
                if (!['completed', 'partially_returned', 'fully_returned'].includes(order.order_status)) {
                    const mode = (order.payment_mode || '').toLowerCase();
                    paymentAction = mode === 'online' ? 'pay_online' : 'mark_paid';
                }
                  return {
                      id: order.id,
                      products_summary: productsSummary || `${order.product_count || 0} items`,
                      product_names: productList,
                      product_count: Number(order.product_count || 0),
                      customer_name: customerDetailsEnabled ? order.customer_name : null,
                      customer_phone: order.customer_phone || null,
                      total_amount: totalAmount,
                      total_paid: totalPaid,
                      returned_amount: returnedAmount,
                      balance,
                      payment_status: paymentStatus,
                      payment_mode: order.payment_mode,
                      payment_action: paymentAction,
                      order_status: order.order_status,
                    is_gst_enabled: order.is_gst_enabled === true,
                    created_at: order.created_at
                };
            });

            const lastCreatedAt = orders.length ? orders[orders.length - 1].created_at : sinceDate;
            return res.json({
                orders,
                customer_details_enabled: customerDetailsEnabled,
                sync: {
                    next_since: lastCreatedAt,
                    received: orders.length
                }
            });
        }
        const view = String(req.query?.view || '').toLowerCase();
        if (view === 'mobile') {
            const resolvedPage = Math.max(parseInt(req.query?.page, 10) || 1, 1);
            const resolvedLimit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 20, 1), 100);
            const offset = (resolvedPage - 1) * resolvedLimit;

            const ordersRes = await requestPool.query(
                `SELECT
                    o.id,
                    o.total_price AS total,
                    o.order_status AS status,
                    o.created_at,
                    COALESCE(o.product_count, SUM(oi.quantity))::numeric AS items
                 FROM orders o
                 LEFT JOIN order_items oi ON oi.order_id = o.id
                 WHERE o.transaction_type = 'sale'
                   AND ($3::uuid IS NULL OR o.branch_id = $3)
                 GROUP BY o.id, o.total_price, o.order_status, o.created_at, o.product_count
                 ORDER BY o.id DESC
                 LIMIT $1 OFFSET $2`,
                [resolvedLimit, offset, branchId]
            );

            const totalRes = await requestPool.query(
                `SELECT COUNT(*)::int AS total
                 FROM orders
                 WHERE transaction_type = 'sale'
                   AND ($1::uuid IS NULL OR branch_id = $1)`,
                [branchId]
            );

            return res.json({
                orders: ordersRes.rows.map((row) => ({
                    id: row.id,
                    total: Number(row.total || 0),
                    items: Number(row.items || 0),
                    status: row.status,
                    created_at: row.created_at
                })),
                total: Number(totalRes.rows[0]?.total || 0)
            });
        }
        let {
            range,
            start_date: startDateRaw,
            end_date: endDateRaw,
            page,
            limit,
            search,
            sort_by: sortByRaw,
            sort_order: sortOrderRaw
        } = req.query || {};
        const sortKey = (sortByRaw || 'id').toLowerCase();
        const sortOrder = (sortOrderRaw || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
        const allowedSorts = new Set(['id', 'created_at', 'total_amount', 'total_paid', 'balance']);
        const resolvedSort = allowedSorts.has(sortKey) ? sortKey : 'created_at';
        const resolvedPage = Math.max(parseInt(page, 10) || 1, 1);
        const resolvedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
        const offset = (resolvedPage - 1) * resolvedLimit;

        const { start, end } = getDateRange(range, startDateRaw, endDateRaw);

        const searchValue = typeof search === 'string' && search.trim() ? `%${search.trim()}%` : null;
        const useRecentCache =
            !range &&
            !startDateRaw &&
            !endDateRaw &&
            !searchValue &&
            resolvedPage === 1 &&
            resolvedLimit <= 20 &&
            (resolvedSort === 'id' || resolvedSort === 'created_at') &&
            sortOrder === 'DESC';

        if (tenantId && useRecentCache) {
            const recentKey = buildRecentOrdersKey(tenantId, branchId);
            const cached = cacheGet(recentKey);
            if (cached) {
                return res.json(cached);
            }
        }
          const ordersRes = await requestPool.query(
              `WITH base AS (
                 SELECT o.id,
                        o.total_price AS total_amount,
                        o.created_at,
                        o.order_status,
                        o.payment_mode,
                        o.is_gst_enabled,
                        o.returned_amount,
                        o.customer_id,
                        o.customer_phone,
                        COALESCE(o.product_count, 0)::int AS product_count,
                        COALESCE(o.product_summary, '') AS product_names,
                        COALESCE(o.total_paid, 0)::numeric AS total_paid
                 FROM orders o
                 LEFT JOIN customers c ON c.id = o.customer_id
                 WHERE o.created_at BETWEEN $1 AND $2
                   AND ($5::uuid IS NULL OR o.branch_id = $5)
                   AND (
                     $6::text IS NULL
                     OR o.id::text ILIKE $6
                     OR c.name ILIKE $6
                     OR o.product_summary ILIKE $6
                   )
                 ORDER BY
                   CASE WHEN $7 = 'id' THEN o.id END ${sortOrder},
                   CASE WHEN $7 = 'created_at' THEN o.created_at END ${sortOrder},
                   CASE WHEN $7 = 'total_amount' THEN o.total_price END ${sortOrder},
                   CASE WHEN $7 = 'total_paid' THEN COALESCE(o.total_paid, 0)::numeric END ${sortOrder},
                   CASE WHEN $7 = 'balance' THEN (o.total_price - COALESCE(o.total_paid, 0)::numeric - COALESCE(o.returned_amount, 0)::numeric) END ${sortOrder},
                   o.id DESC
                 LIMIT $3 OFFSET $4
               )
               SELECT b.id,
                      b.total_amount,
                      b.created_at,
                      b.order_status,
                      b.payment_mode,
                      b.is_gst_enabled,
                      b.returned_amount,
                      c.name AS customer_name,
                      COALESCE(b.customer_phone, c.mobile) AS customer_phone,
                      b.product_count,
                      b.product_names,
                      b.total_paid
               FROM base b
               LEFT JOIN customers c ON c.id = b.customer_id
                ORDER BY
                  CASE WHEN $7 = 'id' THEN b.id END ${sortOrder},
                  CASE WHEN $7 = 'created_at' THEN b.created_at END ${sortOrder},
                  CASE WHEN $7 = 'total_amount' THEN b.total_amount END ${sortOrder},
                  CASE WHEN $7 = 'total_paid' THEN COALESCE(b.total_paid, 0)::numeric END ${sortOrder},
                  CASE WHEN $7 = 'balance' THEN (b.total_amount - COALESCE(b.total_paid, 0)::numeric - COALESCE(b.returned_amount, 0)::numeric) END ${sortOrder},
                  b.id DESC`,
              [start, end, resolvedLimit, offset, branchId, searchValue, resolvedSort]
          );

        if (ordersRes.rowCount === 0) {
            return res.status(200).json({ error: "No orders found" });
        }

          const customerDetailsEnabled = Boolean(req.planFeatures?.customer_details_enabled);
        const orders = ordersRes.rows.map((order) => {
            const totalAmount = Number(order.total_amount || 0);
            const totalPaid = Number(order.total_paid || 0);
            const returnedAmount = Number(order.returned_amount || 0);
            const balance = Math.max(totalAmount - totalPaid - returnedAmount, 0);
            const productList = String(order.product_names || '')
                .split(',')
                .map((name) => name.trim())
                .filter(Boolean);
            const displayProducts = productList.slice(0, 3);
            const productsSummary =
                productList.length > 3
                    ? `${displayProducts.slice(0, 2).join(', ')} +${productList.length - 2} more`
                    : displayProducts.join(', ');
        let paymentStatus = 'unpaid';
        if (totalPaid === 0) {
            paymentStatus = 'unpaid';
        } else if (totalPaid + returnedAmount < totalAmount) {
            paymentStatus = 'partial';
        } else {
            paymentStatus = 'paid';
        }
            let paymentAction = 'none';
            if (!['completed', 'partially_returned', 'fully_returned'].includes(order.order_status)) {
                const mode = (order.payment_mode || '').toLowerCase();
                paymentAction = mode === 'online' ? 'pay_online' : 'mark_paid';
            }
            return {
                id: order.id,
                products_summary: productsSummary || `${order.product_count || 0} items`,
                product_names: productList,
                product_count: Number(order.product_count || 0),
                    customer_name: customerDetailsEnabled ? order.customer_name : null,
                    customer_phone: order.customer_phone || null,
                    total_amount: totalAmount,
                    total_paid: totalPaid,
                    returned_amount: returnedAmount,
                    balance,
                payment_status: paymentStatus,
                payment_mode: order.payment_mode,
                payment_action: paymentAction,
                order_status: order.order_status,
                is_gst_enabled: order.is_gst_enabled === true,
                created_at: order.created_at
            };
        });
          const totalCountRes = searchValue
            ? await requestPool.query(
                `SELECT COUNT(*)::int AS total_records
                 FROM orders o
                 LEFT JOIN customers c ON c.id = o.customer_id
                 WHERE o.created_at BETWEEN $1 AND $2
                   AND (
                     o.id::text ILIKE $3
                     OR c.name ILIKE $3
                     OR o.product_summary ILIKE $3
                   )`,
                [start, end, searchValue]
              )
            : await requestPool.query(
                `SELECT COUNT(*)::int AS total_records
                 FROM orders o
                 WHERE o.created_at BETWEEN $1 AND $2`,
                [start, end]
              );
        const totalRecords = Number(totalCountRes.rows[0]?.total_records || 0);
        const totalPages = totalRecords === 0 ? 0 : Math.ceil(totalRecords / resolvedLimit);

        const response = {
            orders,
            customer_details_enabled: customerDetailsEnabled,
            pagination: {
                page: resolvedPage,
                limit: resolvedLimit,
                total_records: totalRecords,
                total_pages: totalPages
            }
        };
        if (tenantId && useRecentCache) {
            const recentKey = buildRecentOrdersKey(tenantId, branchId);
            cacheSet(recentKey, response, DEFAULTS.recentOrdersTtlMs, { tenantId });
        }
        res.json(response);
    } catch (error) {
        if (error.message === 'INVALID_DATE_RANGE') {
            return res.status(400).json({ error: "Invalid date range" });
        }
        res.status(500).json({ error: error.message });
    }
};

// 🟢 Delete Order
const deleteOrder = async (req, res) => {
    const order_id = req.params.id;

    const requestPool = getRequestPool(req);
    const client = await requestPool.connect();
    try {
      await client.query('BEGIN');

      const orderRes = await client.query(
        'SELECT id FROM orders WHERE id = $1',
        [order_id]
      );
      if (orderRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Order not found' });
      }

      const itemsRes = await client.query(
        'SELECT product_id, quantity FROM order_items WHERE order_id = $1',
        [order_id]
      );

      for (const item of itemsRes.rows) {
        await client.query(
          'UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2',
          [item.quantity, item.product_id]
        );
      }

      await client.query('DELETE FROM order_items WHERE order_id = $1', [order_id]);
      await client.query('DELETE FROM transactions WHERE order_id = $1', [order_id]);
      await client.query('DELETE FROM orders WHERE id = $1', [order_id]);

      await client.query('COMMIT');
      const tenantId = getTenantId(req);
      const branchId = resolveBranchIdFromRequest(req);
      if (tenantId && itemsRes.rowCount > 0) {
        const productIds = itemsRes.rows
          .map((row) => Number(row.product_id))
          .filter((value) => Number.isFinite(value));
        if (productIds.length > 0) {
          refreshCacheForProducts(tenantId, requestPool, productIds, branchId).catch((error) => {
            console.error('Failed to refresh product cache after delete order:', error);
          });
        }
        invalidateOrderCaches(tenantId, branchId);
      }
      res.status(204).json({ message: 'Order deleted successfully' });

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error deleting order:', error);
      res.status(500).json({ message: 'Internal server error' });
    } finally {
      client.release();
    }
  };

  const updateOrder = async (req, res) => {
    const orderId = parseInt(req.params.id);
    const { payment_method, payment_mode, products } = req.body;
  
    const requestPool = getRequestPool(req);
    const client = await requestPool.connect();
  
    try {
      await client.query('BEGIN');
      const orderMetaRes = await client.query(
        'SELECT branch_id, is_gst_enabled FROM orders WHERE id = $1',
        [orderId]
      );
      const orderBranchId = orderMetaRes.rows[0]?.branch_id || null;
      const orderGstEnabled = orderMetaRes.rows[0]?.is_gst_enabled === true;
  
      // 1. Get the old order items
      const { rows: oldOrderItems } = await client.query(
        `SELECT product_id, quantity FROM order_items WHERE order_id = $1`,
        [orderId]
      );
  
      // 2. Restore stock based on old order items
      for (const item of oldOrderItems) {
        await client.query(
          `UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2`,
          [item.quantity, item.product_id]
        );
      }
  
      // 3. Delete old order items
      await client.query(
        `DELETE FROM order_items WHERE order_id = $1`,
        [orderId]
      );
  
      let newTotalPrice = 0;
      let newProfit = 0;
  
      // 4. Insert new order items and update stock
      for (const product of products) {
        const { product_id, quantity, selling_price } = product;
        const qty = normalizeNumber(quantity);

        const { rows: productRows } = await client.query(
          `SELECT stock_quantity, purchase_price, selling_price, is_weight_based, gst_percentage FROM products WHERE id = $1 FOR UPDATE`,
          [product_id]
        );

        if (productRows.length === 0) {
          throw buildValidationError(`Product ID ${product_id} not found or deleted.`);
        }

        const productInfo = productRows[0];
        validateQuantityForProduct(qty, productInfo, product_id);
        const resolvedSellingPrice = normalizeNumber(selling_price ?? product.price ?? product.unit_price ?? productInfo.selling_price);
        if (!Number.isFinite(resolvedSellingPrice) || resolvedSellingPrice <= 0) {
          throw buildValidationError('selling_price must be > 0');
        }
        const purchasePriceSnapshot = normalizeNumber(productInfo.purchase_price);
        const discountAmount = normalizeNumber(product.discount_amount ?? product.discount) || 0;
        const gstPercent = normalizeNumber(productInfo.gst_percentage) || 0;
        const metrics = computeLineMetrics({
          sellingPrice: resolvedSellingPrice,
          purchasePrice: purchasePriceSnapshot,
          quantity: qty,
          discountAmount,
          gstPercent,
          isGstEnabled: orderGstEnabled
        });

        // Insert into order_items
        await client.query(
          `INSERT INTO order_items (
              order_id,
              product_id,
              quantity,
              selling_price,
              purchase_price_snapshot,
              discount_amount,
              gst_percent,
              profit,
              margin_percent
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            orderId,
            product_id,
            qty,
            resolvedSellingPrice,
            purchasePriceSnapshot,
            metrics.discount_amount,
            gstPercent,
            metrics.profit,
            metrics.margin_percent
          ]
        );

        // Decrease stock quantity
        await client.query(
          `UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2`,
          [qty, product_id]
        );

        newTotalPrice += metrics.line_total - metrics.discount_amount;
        newProfit += metrics.profit;
      }
  
      // 5. Update transactions table
      await client.query(
        `UPDATE transactions
         SET total_price = $1, profit = $2, payment_mode = $3
         WHERE order_id = $4`,
        [newTotalPrice, newProfit, payment_mode || payment_method || null, orderId]
      );
  
      // 6. Update orders table
      await client.query(
        `UPDATE orders
         SET total_price = $1
         WHERE id = $2`,
        [newTotalPrice, orderId]
      );
  
      await client.query('COMMIT');
      const tenantId = getTenantId(req);
      if (tenantId) {
        const productIds = [
          ...new Set([
            ...oldOrderItems.map((item) => Number(item.product_id)),
            ...products.map((item) => Number(item.product_id))
          ])
        ].filter((value) => Number.isFinite(value));
        if (productIds.length > 0) {
          refreshCacheForProducts(tenantId, requestPool, productIds, orderBranchId).catch(
            (error) => {
              console.error('Failed to refresh product cache after order update:', error);
            }
          );
        }
        invalidateOrderCaches(tenantId, orderBranchId);
      }
      res.status(200).json({ message: 'Order updated successfully' });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error updating order:', error.message);
      if (error.status === 400) {
        return res.status(400).json({ error: error.message });
      }
      if(error.message.includes('products_stock_quantity_check'))
        return res.status(500).json({error: "Some Products Quantity is out of Stock Please Check Quanity"});
      else
      res.status(500).json({ error: 'Failed to update order' });
    } finally {
      client.release();
    }
  };

  const updateOrderItemPrice = async (req, res) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    const orderId = Number(req.params.orderId || req.params.id);
    const itemId = Number(req.params.itemId);
    const sellingPriceInput = req.body?.sellingPrice ?? req.body?.selling_price;
    const resolvedSellingPrice = normalizeNumber(sellingPriceInput);

    if (!Number.isFinite(orderId) || !Number.isFinite(itemId)) {
      return res.status(400).json({ error: 'Invalid order or item id.' });
    }
    if (!Number.isFinite(resolvedSellingPrice) || resolvedSellingPrice <= 0) {
      return res.status(400).json({ error: 'sellingPrice must be > 0.' });
    }

    const requestPool = getRequestPool(req);
    const client = await requestPool.connect();

    try {
      await client.query('BEGIN');

      const itemRes = await client.query(
        `SELECT o.id,
                o.branch_id,
                o.transaction_type,
                o.is_gst_enabled,
                oi.id AS item_id,
                oi.quantity,
                oi.purchase_price_snapshot,
                oi.discount_amount,
                oi.gst_percent
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         WHERE o.id = $1 AND oi.id = $2
         FOR UPDATE`,
        [orderId, itemId]
      );

      if (itemRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Order item not found.' });
      }

      const item = itemRes.rows[0];
      if (item.transaction_type !== 'sale') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Price override is only allowed for sale orders.' });
      }

      const metrics = computeLineMetrics({
        sellingPrice: resolvedSellingPrice,
        purchasePrice: normalizeNumber(item.purchase_price_snapshot),
        quantity: normalizeNumber(item.quantity),
        discountAmount: normalizeNumber(item.discount_amount) || 0,
        gstPercent: normalizeNumber(item.gst_percent) || 0,
        isGstEnabled: item.is_gst_enabled === true
      });

      await client.query(
        `UPDATE order_items
         SET selling_price = $1,
             profit = $2,
             margin_percent = $3
         WHERE id = $4`,
        [resolvedSellingPrice, metrics.profit, metrics.margin_percent, itemId]
      );

      const totalsRes = await client.query(
        `SELECT
           COALESCE(SUM(oi.quantity * oi.selling_price - COALESCE(oi.discount_amount, 0)), 0)::numeric AS total_price,
           COALESCE(SUM(oi.profit), 0)::numeric AS total_profit
         FROM order_items oi
         WHERE oi.order_id = $1`,
        [orderId]
      );
      const newTotalPrice = Number(totalsRes.rows[0]?.total_price || 0);
      const newTotalProfit = Number(totalsRes.rows[0]?.total_profit || 0);

      await client.query(
        `UPDATE orders
         SET total_price = $1
         WHERE id = $2`,
        [newTotalPrice, orderId]
      );

      await client.query(
        `UPDATE transactions
         SET total_price = $1,
             profit = $2
         WHERE order_id = $3
           AND (transaction_type IS NULL OR transaction_type <> 'refund')`,
        [newTotalPrice, newTotalProfit, orderId]
      );

      await client.query('COMMIT');

      const tenantId = getTenantId(req);
      if (tenantId) {
        invalidateOrderCaches(tenantId, item.branch_id || null);
      }

      return res.status(200).json({
        order_id: orderId,
        item_id: itemId,
        selling_price: resolvedSellingPrice,
        line_total: metrics.line_total - metrics.discount_amount,
        profit: metrics.profit,
        margin_percent: metrics.margin_percent,
        order_total: newTotalPrice,
        order_profit: newTotalProfit
      });
    } catch (error) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: error.message || 'Failed to update order item price.' });
    } finally {
      client.release();
    }
  };
  

const processOrderReturn = async (req, res) => {
    const requestPool = getRequestPool(req);
    const client = await requestPool.connect();
    try {
        await client.query('BEGIN');

        const orderId = Number(req.params.orderId || req.params.id);
        if (!Number.isFinite(orderId)) {
            throw buildValidationError('Invalid order id.');
        }

        const payload = req.body || {};
        const items = Array.isArray(payload.items) ? payload.items : [];
        if (items.length == 0) {
            throw buildValidationError('Return items are required.');
        }

        const refundMode = normalizeRefundMode(payload.refundMode || payload.refund_mode);
        if (!refundMode) {
            throw buildValidationError('refundMode is required.');
        }

        const reason = normalizeReturnReason(payload.reason);

        const orderRes = await client.query(
            `SELECT id,
                    total_price,
                    order_status,
                    returned_amount,
                    is_gst_enabled,
                    branch_id,
                    customer_id
             FROM orders
             WHERE id = $1
             FOR UPDATE`,
            [orderId]
        );
        if (orderRes.rowCount == 0) {
            throw buildValidationError('Order not found.');
        }

        const order = orderRes.rows[0];
        if (!['completed', 'partially_returned'].includes(order.order_status)) {
            throw buildValidationError('Only completed orders can be returned.');
        }

        const orderItemsRes = await client.query(
            `SELECT oi.product_id,
                    oi.quantity,
                    oi.selling_price,
                    p.is_weight_based,
                    oi.purchase_price_snapshot,
                    oi.gst_percent
             FROM order_items oi
             JOIN products p ON p.id = oi.product_id
             WHERE oi.order_id = $1`,
            [orderId]
        );
        if (orderItemsRes.rowCount == 0) {
            throw buildValidationError('Order has no items.');
        }

        const orderItemsByProduct = new Map(
            orderItemsRes.rows.map((row) => [Number(row.product_id), row])
        );

        const returnedRes = await client.query(
            `SELECT ori.product_id,
                    COALESCE(SUM(ori.quantity), 0)::numeric AS returned_qty
             FROM order_return_items ori
             JOIN order_returns r ON r.id = ori.return_id
             WHERE r.order_id = $1
             GROUP BY ori.product_id`,
            [orderId]
        );
        const returnedByProduct = new Map(
            returnedRes.rows.map((row) => [Number(row.product_id), Number(row.returned_qty || 0)])
        );

        const prepared = [];
        for (const item of items) {
            const productId = Number(item.productId ?? item.product_id ?? item.productID);
            if (!Number.isFinite(productId)) {
                throw buildValidationError('productId is required.');
            }
            const orderItem = orderItemsByProduct.get(productId);
            if (!orderItem) {
                throw buildValidationError(`Product ${productId} is not part of this order.`);
            }
            const qty = normalizeNumber(item.quantity);
            validateReturnQuantity(qty, Number(orderItem.is_weight_based) === 1);
            const soldQty = Number(orderItem.quantity || 0);
            const alreadyReturned = returnedByProduct.get(productId) || 0;
            const remaining = soldQty - alreadyReturned;
            if (qty > remaining + 0.0001) {
                throw buildValidationError(`Return quantity exceeds remaining quantity for product ${productId}.`);
            }
            const resolvedUnitPrice = normalizeNumber(item.unitPrice ?? item.unit_price ?? orderItem.selling_price);
            const unitPrice = Number.isFinite(resolvedUnitPrice) && resolvedUnitPrice > 0
                ? resolvedUnitPrice
                : Number(orderItem.selling_price || 0);
            const lineTotal = unitPrice * qty;
            const gstPercent = order.is_gst_enabled ? Number(orderItem.gst_percent || 0) : 0;
            const gstAmount = order.is_gst_enabled ? (lineTotal * gstPercent) / 100 : 0;
            prepared.push({
                product_id: productId,
                qty,
                unit_price: unitPrice,
                line_total: lineTotal,
                gst_amount: gstAmount,
                purchase_price: normalizeNumber(orderItem.purchase_price_snapshot) || 0
            });
        }

        if (prepared.length == 0) {
            throw buildValidationError('No valid return items found.');
        }

        const refundTotal = prepared.reduce((sum, row) => sum + Number(row.line_total || 0), 0);
        if (!Number.isFinite(refundTotal) || refundTotal <= 0) {
            throw buildValidationError('Refund total must be > 0.');
        }

        const returnRes = await client.query(
            `INSERT INTO order_returns (order_id, customer_id, refund_total, refund_mode, reason, created_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, created_at`,
            [
                orderId,
                order.customer_id || null,
                refundTotal,
                refundMode,
                reason || null,
                req.user?.user_id || null
            ]
        );
        const returnId = returnRes.rows[0].id;

        const productIds = prepared.map((row) => row.product_id);
        const quantities = prepared.map((row) => row.qty);
        const unitPrices = prepared.map((row) => row.unit_price);
        const lineTotals = prepared.map((row) => row.line_total);
        const gstAmounts = prepared.map((row) => row.gst_amount);

        await client.query(
            `INSERT INTO order_return_items (return_id, product_id, quantity, unit_price, line_total, gst_amount)
             SELECT $1,
                    unnest($2::int[]),
                    unnest($3::numeric[]),
                    unnest($4::numeric[]),
                    unnest($5::numeric[]),
                    unnest($6::numeric[])`,
            [returnId, productIds, quantities, unitPrices, lineTotals, gstAmounts]
        );

        await client.query(
            `UPDATE products p
             SET stock_quantity = p.stock_quantity + u.qty
             FROM (
               SELECT unnest($1::int[]) AS product_id, unnest($2::numeric[]) AS qty
             ) AS u
             WHERE p.id = u.product_id`,
            [productIds, quantities]
        );

        if (order.branch_id) {
            const purchasePrices = prepared.map((row) => row.purchase_price);
            await client.query(
                `INSERT INTO batches (product_id, branch_id, batch_number, expiry_date, purchase_price, selling_price, quantity)
                 SELECT unnest($1::int[]),
                        $2::uuid,
                        NULL::text,
                        NULL::date,
                        unnest($3::numeric[]),
                        unnest($4::numeric[]),
                        unnest($5::numeric[])`,
                [productIds, order.branch_id, purchasePrices, unitPrices, quantities]
            );
        }

        const refundProfit = prepared.reduce(
            (sum, row) => sum + ((Number(row.unit_price || 0) - Number(row.purchase_price || 0)) * Number(row.qty || 0)),
            0
        );

        await client.query(
            `INSERT INTO transactions (order_id, total_price, profit, payment_mode, transaction_type, reference_id, created_at)
             VALUES ($1, $2, $3, $4, 'refund', $5, NOW())`,
            [orderId, -refundTotal, -refundProfit, refundMode, returnId]
        );

        const previousReturned = Number(order.returned_amount || 0);
        const totalPrice = Number(order.total_price || 0);
        const nextReturned = Math.min(previousReturned + refundTotal, totalPrice);
        const nextStatus = resolveReturnStatus(totalPrice, nextReturned);

        await client.query(
            `UPDATE orders
             SET returned_amount = $1,
                 order_status = $2
             WHERE id = $3`,
            [nextReturned, nextStatus, orderId]
        );

        await client.query('COMMIT');

        const tenantId = getTenantId(req);
        if (tenantId && productIds.length) {
            refreshCacheForProducts(tenantId, requestPool, productIds, order.branch_id).catch((error) => {
                console.error('Failed to refresh product cache after return:', error);
            });
            invalidateOrderCaches(tenantId, order.branch_id);
        }

        return res.status(201).json({
            return_id: returnId,
            refund_total: refundTotal,
            returned_amount: nextReturned,
            order_status: nextStatus
        });
    } catch (error) {
        await client.query('ROLLBACK');
        const status = error.status || 400;
        return res.status(status).json({ error: error.message || 'Failed to process return.' });
    } finally {
        client.release();
    }
};

const markOrderAsPaid = async (req, res) => {
    const requestPool = getRequestPool(req);
    const client = await requestPool.connect();
    try {
        await client.query("BEGIN");
        const { order_id, payment_mode } = req.body;
        const resolvedPaymentMode = normalizePaymentModeValue(payment_mode || 'cash') || 'cash';

        const result = await client.query(
            `WITH order_row AS (
               SELECT id, total_price
               FROM orders
               WHERE id = $1
               FOR UPDATE
             ),
             calc AS (
               SELECT
                 COALESCE(SUM(oi.quantity * oi.selling_price - COALESCE(oi.discount_amount, 0)), 0)::numeric AS items_total,
                 COALESCE(SUM(
                   CASE
                     WHEN oi.profit IS NOT NULL THEN oi.profit
                     ELSE (oi.selling_price - COALESCE(oi.purchase_price_snapshot, 0)) * oi.quantity
                   END
                 ), 0)::numeric AS profit
               FROM order_items oi
               WHERE oi.order_id = $1
             ),
             ins AS (
               INSERT INTO transactions (order_id, total_price, profit, payment_mode)
               SELECT order_row.id,
                      COALESCE(NULLIF(calc.items_total, 0), order_row.total_price, 0) AS paid_amount,
                      calc.profit,
                      $2
               FROM order_row, calc
               RETURNING order_id, total_price
             )
             UPDATE orders
             SET order_status = 'completed',
                 payment_mode = $2,
                 total_paid = COALESCE(ins.total_price, 0)
             FROM ins
             WHERE orders.id = ins.order_id
             RETURNING id;`,
            [order_id, resolvedPaymentMode]
        );

        if (result.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Order not found" });
        }

        await client.query("COMMIT");
        const tenantId = getTenantId(req);
        const branchId = resolveBranchIdFromRequest(req);
        if (tenantId) {
            invalidateOrderCaches(tenantId, branchId);
        }
        res.status(200).json({ message: "Order marked as paid successfully" });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("Error marking order as paid:", error);
        res.status(500).json({ error: "Internal Server Error" });
    } finally {
        client.release();
    }
 };

 const getCategories = async(req, res) => {
    try {
      const requestPool = getRequestPool(req);
      // Update order status
      const categoryRes = await requestPool.query("select distinct category from products");
      res.status(200).json({ data: categoryRes.rows});
    } catch (error) {
      res.status(500).json({ error: "Internal Server Error at getCategories" });
    }
 }

const normalizePaymentMode = (order) => {
  return order.payment_mode || order.payment_method || null;
};

const validateOfflineOrder = (order) => {
  if (!order || typeof order !== 'object') return 'Order is required.';
  if (!order.transaction_type) return 'transaction_type is required.';

  const type = order.transaction_type;
  const paymentMode = normalizePaymentMode(order);

    if (type === 'sale') {
      if (!Array.isArray(order.products) || order.products.length === 0) return 'products are required for sale.';
      if (!paymentMode) return 'payment_mode is required for sale.';
        for (const item of order.products) {
        if (!item.product_id) return 'product_id is required for sale items.';
        if (!item.quantity || item.quantity <= 0) return 'quantity must be > 0 for sale items.';
      }
    } else if (type === 'purchase') {
      if (!Array.isArray(order.products) || order.products.length === 0) return 'products are required for purchase.';
      if (!paymentMode) return 'payment_mode is required for purchase.';
      if (order.total_amount === undefined || order.total_amount === null) return 'total_amount is required for purchase.';
        for (const item of order.products) {
        if (!item.product_name) return 'product_name is required for purchase items.';
        if (!item.company) return 'company is required for purchase items.';
      if (!item.quantity || item.quantity <= 0) return 'quantity must be > 0 for purchase items.';
      if (item.purchase_price === undefined || item.purchase_price === null) return 'purchase_price is required for purchase items.';
      if (item.selling_price === undefined || item.selling_price === null) return 'selling_price is required for purchase items.';
    }
  } else if (type === 'personal') {
    if (!paymentMode) return 'payment_mode is required for personal.';
    if (order.total_amount === undefined || order.total_amount === null) return 'total_amount is required for personal.';
  } else {
    return 'transaction_type must be sale, purchase, or personal.';
  }

  if (Array.isArray(order.payments) && order.payments.length > 0) {
    for (const payment of order.payments) {
      const amount = normalizeNumber(payment?.amount_paid ?? payment?.amount);
      const mode = normalizePaymentModeValue(payment?.payment_mode || payment?.payment_method);
      if (!Number.isFinite(amount) || amount <= 0) return 'payment amount must be > 0.';
      if (!mode) return 'payment_mode is required for payments.';
    }
  }

  return null;
};

const syncOfflineOrders = async (req, res) => {
  const { orders, sync_id } = req.body;
  if (!Array.isArray(orders) || orders.length === 0) {
    return res.status(400).json({ error: 'orders must be a non-empty array.' });
  }

  const requestPool = getRequestPool(req);
  const results = [];
  const seen = new Set();

  for (const order of orders) {
    const clientOrderId = order?.client_order_id;

    if (clientOrderId && seen.has(clientOrderId)) {
      results.push({
        client_order_id: clientOrderId,
        status: 'failed',
        errors: [{ code: 'DUPLICATE_IN_BATCH', message: 'Duplicate client_order_id in batch.' }]
      });
      continue;
    }
    if (clientOrderId) seen.add(clientOrderId);

    const validationError = validateOfflineOrder(order);
    if (validationError) {
      results.push({
        client_order_id: clientOrderId || null,
        status: 'failed',
        errors: [{ code: 'VALIDATION_ERROR', message: validationError }]
      });
      continue;
    }

    const client = await requestPool.connect();
    const touchedProductIds = new Set();
    try {
      await client.query('BEGIN');

        const type = order.transaction_type;
        const paymentMode = normalizePaymentModeValue(normalizePaymentMode(order));
        const resolvedLocation = resolveOrderLocation(order);
          const branchId =
            type === 'sale' || type === 'purchase'
              ? await resolveBranchId(client, order.branch_id)
              : null;
        let orderId = null;
        let orderStatus = 'pending';
        let resolvedCustomerId = null;
        const resolvedCustomer = buildCustomerPayloadFromOrder(order);
        if (resolvedCustomer && (resolvedCustomer.name || resolvedCustomer.mobile)) {
          resolvedCustomerId = await upsertCustomer(client, resolvedCustomer);
        }
        const resolvedCustomerPhone =
          resolvedCustomer?.mobile || order.customer_phone || order.customer_mobile || null;

      let orderTotal = 0;
      let orderProfit = 0;
      if (type === 'sale') {
        const items = order.products;
        let totalPrice = 0;
        let totalProfit = 0;

          for (const item of items) {
            const { product_id, quantity } = item;
            const productRes = await client.query(
              'SELECT selling_price, purchase_price, stock_quantity, is_weight_based, gst_percentage FROM products WHERE id = $1 AND is_deleted = FALSE FOR UPDATE',
              [product_id]
            );

          if (productRes.rowCount === 0) {
            throw new Error(`Product ID ${product_id} not found or deleted.`);
          }

            const product = productRes.rows[0];
            const qty = normalizeNumber(quantity);
            validateQuantityForProduct(qty, product, product_id);
            const sellingPrice = normalizeNumber(item.selling_price ?? item.price ?? item.unit_price ?? product.selling_price);

            const discountAmount = normalizeNumber(item.discount_amount ?? item.discount) || 0;
            const gstPercent = normalizeNumber(product.gst_percentage) || 0;
            const metrics = computeLineMetrics({
              sellingPrice,
              purchasePrice: normalizeNumber(product.purchase_price),
              quantity: qty,
              discountAmount,
              gstPercent,
              isGstEnabled: resolveIsGstEnabled(req, order)
            });

            totalPrice += metrics.line_total - metrics.discount_amount;
            totalProfit += metrics.profit;
            touchedProductIds.add(product_id);
          }
          orderTotal = totalPrice;
          orderProfit = totalProfit;

          const orderDate = order.client_created_at ? new Date(order.client_created_at) : new Date();
          const isGstEnabled = resolveIsGstEnabled(req, order);
          const orderResult = await client.query(
            'INSERT INTO orders (customer_id, customer_phone, branch_id, total_price, order_status, payment_mode, created_at, location, transaction_type, is_gst_enabled) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id',
            [resolvedCustomerId, resolvedCustomerPhone, branchId, totalPrice, 'pending', paymentMode || null, orderDate, resolvedLocation, 'sale', isGstEnabled]
          );

          orderId = orderResult.rows[0].id;

          for (const item of items) {
            const { product_id, quantity } = item;
            const priceRes = await client.query(
              'SELECT selling_price, purchase_price, gst_percentage FROM products WHERE id = $1',
              [product_id]
            );
            const resolvedSellingPrice = normalizeNumber(item.selling_price ?? item.price ?? item.unit_price ?? priceRes.rows[0].selling_price);
            if (!Number.isFinite(resolvedSellingPrice) || resolvedSellingPrice <= 0) {
              throw new Error('selling_price must be > 0');
            }
            const qty = normalizeNumber(quantity);
            const purchasePriceSnapshot = normalizeNumber(priceRes.rows[0]?.purchase_price);
            const discountAmount = normalizeNumber(item.discount_amount ?? item.discount) || 0;
            const gstPercent = normalizeNumber(priceRes.rows[0]?.gst_percentage) || 0;
            const metrics = computeLineMetrics({
              sellingPrice: resolvedSellingPrice,
              purchasePrice: purchasePriceSnapshot,
              quantity: qty,
              discountAmount,
              gstPercent,
              isGstEnabled: resolveIsGstEnabled(req, order)
            });

            await allocateBatchStock(client, product_id, branchId, qty);
            await client.query(
              `INSERT INTO order_items (
                  order_id,
                  product_id,
                  quantity,
                  selling_price,
                  purchase_price_snapshot,
                  discount_amount,
                  gst_percent,
                  profit,
                  margin_percent
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                orderId,
                product_id,
                qty,
                resolvedSellingPrice,
                purchasePriceSnapshot,
                metrics.discount_amount,
                gstPercent,
                metrics.profit,
                metrics.margin_percent
              ]
            );

          await client.query(
            'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
            [qty, product_id]
          );
          touchedProductIds.add(product_id);
        }

        orderStatus = 'pending';
      } else if (type === 'purchase') {
        const items = order.products;
        const totalAmount = order.total_amount;
        orderTotal = normalizeNumber(totalAmount) || 0;
          const orderDate = order.client_created_at ? new Date(order.client_created_at) : new Date();
          const orderResult = await client.query(
            'INSERT INTO orders (customer_id, customer_phone, branch_id, total_price, order_status, payment_mode, created_at, location, transaction_type, is_gst_enabled) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id',
            [resolvedCustomerId, resolvedCustomerPhone, branchId, totalAmount, 'pending', paymentMode || null, orderDate, resolvedLocation, 'purchase', false]
          );

        orderId = orderResult.rows[0].id;

          for (const item of items) {
            const { product_name, company, quantity, purchase_price, selling_price, category, time_for_delivery, is_weight_based, batch_number, expiry_date } = item;
            const expiryDate = expiry_date ? new Date(expiry_date) : null;
            if (expiryDate && Number.isNaN(expiryDate.getTime())) {
              throw new Error('Invalid expiry_date');
            }
            const productQuery = 'SELECT * FROM products WHERE name ILIKE $1 AND company ILIKE $2;';
            const productResult = await client.query(productQuery, [product_name, company]);

            if (productResult.rows.length > 0) {
              const existingProduct = productResult.rows[0];
            const newQuantity = normalizeNumber(existingProduct.stock_quantity) + normalizeNumber(quantity);
            const totalPurchasePrice = normalizeNumber(existingProduct.purchase_price) * normalizeNumber(existingProduct.stock_quantity) + normalizeNumber(purchase_price) * normalizeNumber(quantity);
            const newPurchasePrice = normalizeNumber(totalPurchasePrice) / normalizeNumber(newQuantity);

              await client.query(
                'UPDATE products SET stock_quantity = $1, purchase_price = $2, selling_price = $3, time_for_delivery = $4, is_weight_based = $5 WHERE id = $6',
                [newQuantity, newPurchasePrice, selling_price, time_for_delivery, is_weight_based ?? existingProduct.is_weight_based ?? 0, existingProduct.id]
              );
              touchedProductIds.add(existingProduct.id);
              await client.query(
                `INSERT INTO batches (product_id, branch_id, batch_number, expiry_date, purchase_price, selling_price, quantity)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [existingProduct.id, branchId, batch_number || null, expiryDate, purchase_price, selling_price, quantity]
              );
            } else {
              const insertRes = await client.query(
                'INSERT INTO products (name, company, stock_quantity, purchase_price, selling_price, category, time_for_delivery, is_weight_based) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
                [product_name, company, quantity, purchase_price, selling_price, category, time_for_delivery, is_weight_based ?? 0]
              );
              if (insertRes.rowCount > 0) {
                touchedProductIds.add(insertRes.rows[0].id);
                await client.query(
                  `INSERT INTO batches (product_id, branch_id, batch_number, expiry_date, purchase_price, selling_price, quantity)
                   VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                  [insertRes.rows[0].id, branchId, batch_number || null, expiryDate, purchase_price, selling_price, quantity]
                );
              }
            }
          }

        orderStatus = 'pending';
      } else if (type === 'personal') {
        const totalAmount = order.total_amount;
        orderTotal = normalizeNumber(totalAmount) || 0;
          const orderDate = order.client_created_at ? new Date(order.client_created_at) : new Date();
          const orderResult = await client.query(
            'INSERT INTO orders (customer_id, customer_phone, total_price, order_status, payment_mode, created_at, location, transaction_type, is_gst_enabled) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id',
            [resolvedCustomerId, resolvedCustomerPhone, totalAmount, 'pending', paymentMode || null, orderDate, resolvedLocation, 'personal', false]
          );

        orderId = orderResult.rows[0].id;

        orderStatus = 'pending';
      }

      const payments = Array.isArray(order.payments) ? order.payments : [];
      let totalPaid = 0;
      const insertedTransactions = [];
      if (payments.length > 0) {
        for (const payment of payments) {
          const amount = normalizeNumber(payment?.amount_paid ?? payment?.amount);
          if (!Number.isFinite(amount) || amount <= 0) continue;
          const resolvedPaymentMode =
            normalizePaymentModeValue(payment?.payment_mode || payment?.payment_method) || paymentMode || null;
          const ratio = orderTotal > 0 ? amount / orderTotal : 0;
          const profit = type === 'sale' ? orderProfit * ratio : 0;
          const createdAt = payment?.created_at ? new Date(payment.created_at) : new Date();
          const txRes = await client.query(
            `INSERT INTO transactions (order_id, total_price, profit, payment_mode, created_at)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, order_id, total_price, payment_mode, created_at`,
            [orderId, amount, profit, resolvedPaymentMode, createdAt]
          );
          if (txRes.rowCount > 0) {
            insertedTransactions.push(txRes.rows[0]);
          }
          totalPaid += amount;
        }
      }

      if (totalPaid > 0) {
        const completed = orderTotal > 0 && totalPaid >= orderTotal;
        await client.query(
          `UPDATE orders
           SET total_paid = $1,
               order_status = $2
           WHERE id = $3`,
          [totalPaid, completed ? 'completed' : 'pending', orderId]
        );
        orderStatus = completed ? 'completed' : 'pending';
      }

      await client.query('COMMIT');

      const tenantId = getTenantId(req);
      if (tenantId && touchedProductIds.size > 0) {
        refreshCacheForProducts(tenantId, requestPool, Array.from(touchedProductIds), branchId).catch(
          (error) => {
            console.error('Failed to refresh product cache after offline sync:', error);
          }
        );
        invalidateOrderCaches(tenantId, branchId);
      }

      results.push({
        client_order_id: clientOrderId || null,
        status: 'created',
        order_id: orderId,
        order_status: orderStatus,
        payment_mode: paymentMode || null,
        transactions: insertedTransactions
      });
    } catch (error) {
      await client.query('ROLLBACK');
      results.push({
        client_order_id: clientOrderId,
        status: 'failed',
        errors: [{ code: 'PROCESSING_ERROR', message: error.message }]
      });
    } finally {
      client.release();
    }
  }

  res.status(200).json({ sync_id: sync_id || null, results });
};

module.exports = {
  markOrderAsPaid,
  processOrderReturn,
  createOrder,
  getAllOrders,
  getOrderById,
  updateOrder,
  updateOrderItemPrice,
  deleteOrder,
  getProfitByOrderId,
  getCategories,
  syncOfflineOrders
}


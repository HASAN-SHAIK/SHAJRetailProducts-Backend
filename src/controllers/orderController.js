
const pool = require('../db'); // PostgreSQL connection pool
const getRequestPool = (req) => req.tenantPool || pool;
const { createTransaction } = require('./transactionController');
const { getDateRange } = require('../utils/dateRange');
const { resolveMaxProducts, fetchActiveProductCount } = require('../utils/productLimits');

const normalizePaymentModeValue = (value) => {
  const mode = (value || '').toLowerCase();
  if (mode === 'upi' || mode === 'online') return 'online';
  if (mode === 'card' || mode === 'cash') return 'cash';
  return mode || null;
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

const normalizeNumber = (value) => {
  if (value === null || value === undefined) return NaN;
  if (typeof value === 'string' && value.trim() === '') return NaN;
  return Number(value);
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
          p.actual_price
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = $1
      `;
  
      const { rows } = await requestPool.query(query, [orderId]);
  
      let totalProfit = 0, total_price = 0;
  
      for (const item of rows) {
        const profitPerItem = (item.selling_price - item.actual_price) * item.quantity;
        total_price += item.selling_price * item.quantity;
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
            "SELECT id, selling_price, actual_price, stock_quantity, is_weight_based FROM products WHERE id = ANY($1) AND is_deleted = FALSE FOR UPDATE",
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
        let total_price = 0;

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

            const sellingPrice = normalizeNumber(item.selling_price ?? product.selling_price);
            total_price += sellingPrice * qty;
            preparedItems.push({ product_id: item.product_id, qty, sellingPrice });

            const prevQty = requestedQtyByProduct.get(item.product_id) || 0;
            requestedQtyByProduct.set(item.product_id, prevQty + qty);
        }

        for (const [productId, totalQty] of requestedQtyByProduct.entries()) {
            const product = productById.get(productId);
            const stock = normalizeNumber(product.stock_quantity);
            if (!Number.isFinite(stock) || stock < totalQty) {
                throw buildValidationError(`Insufficient stock for Product ID ${productId}. Available: ${product.stock_quantity}`);
            }
        }

        const resolvedPaymentMode = normalizePaymentModeValue(payment_mode || payment_method);
        const orderStatus = 'pending';

        let resolvedCustomerId = req.body?.customer_id || null;
        const resolvedCustomer = buildCustomerPayload(req);
        if (!resolvedCustomerId && resolvedCustomer) {
            resolvedCustomerId = await upsertCustomer(client, resolvedCustomer);
        }

        const orderResult = await client.query(
            "INSERT INTO orders (user_id, customer_id, total_price, order_status, payment_mode, location, transaction_type) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
            [req.user?.user_id || null, resolvedCustomerId, total_price, orderStatus, resolvedPaymentMode || null, resolvedLocation, 'sale']
        );
        const order_id = orderResult.rows[0].id;

        const orderItemProductIds = preparedItems.map((item) => item.product_id);
        const orderItemQuantities = preparedItems.map((item) => item.qty);
        const orderItemPrices = preparedItems.map((item) => item.sellingPrice);

        await client.query(
            `INSERT INTO order_items (order_id, product_id, quantity, selling_price)
             SELECT $1, unnest($2::int[]), unnest($3::numeric[]), unnest($4::numeric[])`,
            [order_id, orderItemProductIds, orderItemQuantities, orderItemPrices]
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
        res.status(201).json({ message: "Order created successfully", order_id, payment_mode: resolvedPaymentMode });
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
        const { products, total_amount, payment_mode } = req.body;
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
            INSERT INTO orders (total_price, order_status, payment_mode, location, transaction_type)
            VALUES ($1, $2, $3, $4, $5) RETURNING id;
        `;
        const orderResult = await client.query(orderQuery, [total_amount, orderStatus, resolvedPaymentMode || null, resolvedLocation, 'purchase']);
        const orderId = orderResult.rows[0].id;
        // Step 2: Process each item in the purchase order
        const touchedProductIds = new Set();
        for (let item of products) {
            const { product_name, company, quantity, actual_price, selling_price, category, time_for_delivery, is_weight_based } = item;
            // Check if the product already exists
            const productQuery = `SELECT * FROM products WHERE name ilike $1 AND company ilike $2;`;
            const productResult = await client.query(productQuery, [product_name, company]);
            if (productResult.rows.length > 0) {
                // Product exists: only update quantity + prices
                const existingProduct = productResult.rows[0];
                const existingQty = normalizeNumber(existingProduct.stock_quantity);
                const incomingQty = normalizeNumber(quantity);
                const newQuantity = existingQty + incomingQty;

                const existingActual = normalizeNumber(existingProduct.actual_price);
                const incomingActual = normalizeNumber(actual_price);
                const newActualPrice = Number.isFinite(incomingActual)
                  ? (existingActual * existingQty + incomingActual * incomingQty) / newQuantity
                  : existingActual;

                const resolvedSellingPrice = selling_price ?? existingProduct.selling_price;

                const updateProductQuery = `
                    UPDATE products
                    SET stock_quantity = $1, actual_price = $2, selling_price = $3
                    WHERE id = $4;
                `;
                await client.query(updateProductQuery, [newQuantity, newActualPrice, resolvedSellingPrice, existingProduct.id]);
                touchedProductIds.add(existingProduct.id);
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
                    INSERT INTO products (name, company, stock_quantity, actual_price, selling_price, category, time_for_delivery, is_weight_based)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    RETURNING id;
                `;
                const inserted = await client.query(insertProductQuery, [product_name, company, quantity, actual_price, selling_price, category, time_for_delivery, is_weight_based ?? 0]);
                if (inserted.rowCount > 0) {
                    touchedProductIds.add(inserted.rows[0].id);
                    newProductsAdded += 1;
                }
            }
            // Step 3: Insert into order_items
            // const insertOrderItemQuery = `
            //     INSERT INTO order_items (order_id, product_name, company, quantity, actual_price, selling_price)
            //     VALUES ($1, $2, $3, $4, $5, $6);
            // `;
            // await client.query(insertOrderItemQuery, [orderId, product_name, company, quantity, actual_price, selling_price]);
        }
        // Step 4: Insert into transactions as a purchase
        // Payment should be recorded only when payment is actually made (mark paid).
        const productIds = Array.from(touchedProductIds);
        const productsRes = productIds.length
            ? await client.query(
                `SELECT id, name, company, stock_quantity, actual_price, selling_price, category, time_for_delivery, is_weight_based
                 FROM products
                 WHERE id = ANY($1::int[])`,
                [productIds]
              )
            : { rows: [] };

        await client.query("COMMIT"); // Commit transaction
        res.status(201).json({ message: "Purchase order created successfully", orderId, products: productsRes.rows });
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
      INSERT INTO orders (total_price, order_status, payment_mode, location, transaction_type)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id;
    `;

    const orderResult = await client.query(orderQuery, [total_amount, orderStatus, resolvedPaymentMode || null, resolvedLocation, 'personal']);

    const orderId = orderResult.rows[0].id;

    // 2️⃣ Insert into Transactions (Type: Personal)

    // Payment should be recorded only when payment is actually made (mark paid).

    await client.query("COMMIT"); // Commit transaction

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
    //             "SELECT selling_price, actual_price, stock_quantity FROM products WHERE id = $1 FOR UPDATE",
    //             [product.product_id]
    //         );
    //         if (rows.length === 0 || rows[0].stock_quantity < product.quantity) {
    //             throw new Error("Product not available or insufficient stock");
    //         }
    //         const sellingPrice = rows[0].selling_price;
    //         const actualPrice = rows[0].actual_price;
    //         const profit = (sellingPrice - actualPrice) * product.quantity;
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
                    o.payment_mode,
                    o.created_at,
                    o.customer_id,
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
                    (oi.quantity * oi.selling_price)::numeric AS line_total
             FROM order_items oi
             JOIN products p ON p.id = oi.product_id
             WHERE oi.order_id = $1`,
            [id]
        );

        const paymentsRes = await requestPool.query(
            `SELECT id,
                    total_price AS amount,
                    payment_mode,
                    created_at
             FROM transactions
             WHERE order_id = $1
             ORDER BY created_at ASC`,
            [id]
        );

        const orderRow = orderRes.rows[0];
        const totalAmount = Number(orderRow.total_amount || 0);
        const totalPaid = Number(orderRow.total_paid || 0);
        const balance = Math.max(totalAmount - totalPaid, 0);
        const paymentHistory = orderRow.order_status === 'completed'
            ? paymentsRes.rows.map((row) => ({
                id: row.id,
                amount: Number(row.amount || 0),
                payment_mode: row.payment_mode,
                created_at: row.created_at
            }))
            : [];
        let paymentAction = 'none';
        if (orderRow.order_status !== 'completed') {
            const mode = (orderRow.payment_mode || '').toLowerCase();
            paymentAction = mode === 'online' ? 'pay_online' : 'mark_paid';
        }

        let paymentStatus = 'unpaid';
        if (totalPaid === 0) {
            paymentStatus = 'unpaid';
        } else if (totalPaid < totalAmount) {
            paymentStatus = 'partial';
        } else {
            paymentStatus = 'paid';
        }

        const customerDetailsEnabled = Boolean(req.planFeatures?.customer_details_enabled);
        res.json({
            order: {
                id: orderRow.id,
                order_status: orderRow.order_status,
                customer: customerDetailsEnabled && orderRow.customer_id
                    ? {
                          id: orderRow.customer_id,
                          name: orderRow.customer_name,
                          mobile: orderRow.customer_mobile,
                          address: orderRow.customer_address
                      }
                    : null,
                items: orderItems.rows.map((row) => ({
                    product_id: row.product_id,
                    product_name: row.product_name,
                    quantity: Number(row.quantity || 0),
                    selling_price: Number(row.selling_price || 0),
                    line_total: Number(row.line_total || 0),
                    is_weight_based: row.is_weight_based
                })),
                payments: paymentHistory,
                payment_history: paymentHistory,
                total_amount: totalAmount,
                total_paid: totalPaid,
                balance,
                payment_status: paymentStatus,
                payment_mode: orderRow.payment_mode,
                payment_action: paymentAction,
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
                 GROUP BY o.id, o.total_price, o.order_status, o.created_at, o.product_count
                 ORDER BY o.created_at DESC
                 LIMIT $1 OFFSET $2`,
                [resolvedLimit, offset]
            );

            const totalRes = await requestPool.query(
                `SELECT COUNT(*)::int AS total
                 FROM orders
                 WHERE transaction_type = 'sale'`
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
        const sortKey = (sortByRaw || 'created_at').toLowerCase();
        const sortOrder = (sortOrderRaw || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
        const allowedSorts = new Set(['created_at', 'total_amount', 'total_paid', 'balance']);
        const resolvedSort = allowedSorts.has(sortKey) ? sortKey : 'created_at';
        const resolvedPage = Math.max(parseInt(page, 10) || 1, 1);
        const resolvedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
        const offset = (resolvedPage - 1) * resolvedLimit;

        const { start, end } = getDateRange(range, startDateRaw, endDateRaw);

        const searchValue = typeof search === 'string' && search.trim() ? `%${search.trim()}%` : null;
        const ordersRes = await requestPool.query(
            `WITH base AS (
               SELECT o.id,
                      o.total_price AS total_amount,
                      o.created_at,
                      o.order_status,
                      o.payment_mode,
                      o.customer_id,
                      COALESCE(o.product_count, 0)::int AS product_count,
                      COALESCE(o.product_summary, '') AS product_names,
                      COALESCE(o.total_paid, 0)::numeric AS total_paid
               FROM orders o
               LEFT JOIN customers c ON c.id = o.customer_id
               WHERE o.created_at BETWEEN $1 AND $2
                 AND (
                   $5::text IS NULL
                   OR o.id::text ILIKE $5
                   OR c.name ILIKE $5
                   OR o.product_summary ILIKE $5
                 )
               ORDER BY
                 CASE WHEN $6 = 'created_at' THEN o.created_at END ${sortOrder},
                 CASE WHEN $6 = 'total_amount' THEN o.total_price END ${sortOrder},
                 CASE WHEN $6 = 'total_paid' THEN COALESCE(o.total_paid, 0)::numeric END ${sortOrder},
                 CASE WHEN $6 = 'balance' THEN (o.total_price - COALESCE(o.total_paid, 0)::numeric) END ${sortOrder},
                 o.created_at DESC
               LIMIT $3 OFFSET $4
             )
             SELECT b.id,
                    b.total_amount,
                    b.created_at,
                    b.order_status,
                    b.payment_mode,
                    c.name AS customer_name,
                    b.product_count,
                    b.product_names,
                    b.total_paid
             FROM base b
             LEFT JOIN customers c ON c.id = b.customer_id
             ORDER BY
               CASE WHEN $6 = 'created_at' THEN b.created_at END ${sortOrder},
               CASE WHEN $6 = 'total_amount' THEN b.total_amount END ${sortOrder},
               CASE WHEN $6 = 'total_paid' THEN COALESCE(b.total_paid, 0)::numeric END ${sortOrder},
               CASE WHEN $6 = 'balance' THEN (b.total_amount - COALESCE(b.total_paid, 0)::numeric) END ${sortOrder},
               b.created_at DESC`,
            [start, end, resolvedLimit, offset, searchValue, resolvedSort]
        );

        if (ordersRes.rowCount === 0) {
            return res.status(200).json({ error: "No orders found" });
        }

          const customerDetailsEnabled = Boolean(req.planFeatures?.customer_details_enabled);
        const orders = ordersRes.rows.map((order) => {
            const totalAmount = Number(order.total_amount || 0);
            const totalPaid = Number(order.total_paid || 0);
            const balance = Math.max(totalAmount - totalPaid, 0);
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
        } else if (totalPaid < totalAmount) {
            paymentStatus = 'partial';
        } else {
            paymentStatus = 'paid';
        }
            let paymentAction = 'none';
            if (order.order_status !== 'completed') {
                const mode = (order.payment_mode || '').toLowerCase();
                paymentAction = mode === 'online' ? 'pay_online' : 'mark_paid';
            }
            return {
                id: order.id,
                products_summary: productsSummary || `${order.product_count || 0} items`,
                product_names: productList,
                product_count: Number(order.product_count || 0),
                customer_name: customerDetailsEnabled ? order.customer_name : null,
                total_amount: totalAmount,
                total_paid: totalPaid,
                balance,
                payment_status: paymentStatus,
                payment_mode: order.payment_mode,
                payment_action: paymentAction,
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

        res.json({
            orders,
            customer_details_enabled: customerDetailsEnabled,
            pagination: {
                page: resolvedPage,
                limit: resolvedLimit,
                total_records: totalRecords,
                total_pages: totalPages
            }
        });
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
          `SELECT stock_quantity, actual_price, selling_price, is_weight_based FROM products WHERE id = $1 FOR UPDATE`,
          [product_id]
        );

        if (productRows.length === 0) {
          throw buildValidationError(`Product ID ${product_id} not found or deleted.`);
        }

        const productInfo = productRows[0];
        validateQuantityForProduct(qty, productInfo, product_id);
        const resolvedSellingPrice = normalizeNumber(selling_price ?? productInfo.selling_price);

        // Insert into order_items
        await client.query(
          `INSERT INTO order_items (order_id, product_id, quantity, selling_price)
           VALUES ($1, $2, $3, $4)`,
          [orderId, product_id, qty, resolvedSellingPrice]
        );

        // Decrease stock quantity
        await client.query(
          `UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2`,
          [qty, product_id]
        );

        const actualPrice = normalizeNumber(productInfo.actual_price);

        newTotalPrice += resolvedSellingPrice * qty;
        newProfit += (resolvedSellingPrice - actualPrice) * qty;
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
                 COALESCE(SUM(oi.quantity * oi.selling_price), 0)::numeric AS items_total,
                 COALESCE(SUM((oi.selling_price - p.actual_price) * oi.quantity), 0)::numeric AS profit
               FROM order_items oi
               JOIN products p ON p.id = oi.product_id
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
      if (item.actual_price === undefined || item.actual_price === null) return 'actual_price is required for purchase items.';
      if (item.selling_price === undefined || item.selling_price === null) return 'selling_price is required for purchase items.';
    }
  } else if (type === 'personal') {
    if (!paymentMode) return 'payment_mode is required for personal.';
    if (order.total_amount === undefined || order.total_amount === null) return 'total_amount is required for personal.';
  } else {
    return 'transaction_type must be sale, purchase, or personal.';
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
    try {
      await client.query('BEGIN');

      const type = order.transaction_type;
      const paymentMode = normalizePaymentModeValue(normalizePaymentMode(order));
      const resolvedLocation = resolveOrderLocation(order);
      let orderId = null;
      let orderStatus = 'pending';

      if (type === 'sale') {
        const items = order.products;
        let totalPrice = 0;
        let totalProfit = 0;

        for (const item of items) {
          const { product_id, quantity } = item;
          const productRes = await client.query(
            'SELECT selling_price, actual_price, stock_quantity, is_weight_based FROM products WHERE id = $1 AND is_deleted = FALSE FOR UPDATE',
            [product_id]
          );

          if (productRes.rowCount === 0) {
            throw new Error(`Product ID ${product_id} not found or deleted.`);
          }

          const product = productRes.rows[0];
          const qty = normalizeNumber(quantity);
          validateQuantityForProduct(qty, product, product_id);
          const sellingPrice = normalizeNumber(item.selling_price ?? product.selling_price);

          totalPrice += sellingPrice * qty;
          totalProfit += (sellingPrice - normalizeNumber(product.actual_price)) * qty;
        }

        const orderDate = order.client_created_at ? new Date(order.client_created_at) : new Date();
        const orderResult = await client.query(
          'INSERT INTO orders (total_price, order_status, payment_mode, created_at, location, transaction_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
          [totalPrice, 'pending', paymentMode || null, orderDate, resolvedLocation, 'sale']
        );

        orderId = orderResult.rows[0].id;

        for (const item of items) {
          const { product_id, quantity } = item;
          const priceRes = await client.query('SELECT selling_price FROM products WHERE id = $1', [product_id]);
          const resolvedSellingPrice = normalizeNumber(item.selling_price ?? priceRes.rows[0].selling_price);
          const qty = normalizeNumber(quantity);

          await client.query(
            'INSERT INTO order_items (order_id, product_id, quantity, selling_price) VALUES ($1, $2, $3, $4)',
            [orderId, product_id, qty, resolvedSellingPrice]
          );

          await client.query(
            'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
            [qty, product_id]
          );
        }

        // Payment should be recorded only when payment is actually made (mark paid).
        orderStatus = 'pending';
      } else if (type === 'purchase') {
        const items = order.products;
        const totalAmount = order.total_amount;
        const orderDate = order.client_created_at ? new Date(order.client_created_at) : new Date();
        const orderResult = await client.query(
          'INSERT INTO orders (total_price, order_status, payment_mode, created_at, location, transaction_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
          [totalAmount, 'pending', paymentMode || null, orderDate, resolvedLocation, 'purchase']
        );

        orderId = orderResult.rows[0].id;

        for (const item of items) {
          const { product_name, company, quantity, actual_price, selling_price, category, time_for_delivery, is_weight_based } = item;
          const productQuery = 'SELECT * FROM products WHERE name ILIKE $1 AND company ILIKE $2;';
          const productResult = await client.query(productQuery, [product_name, company]);

          if (productResult.rows.length > 0) {
            const existingProduct = productResult.rows[0];
            const newQuantity = normalizeNumber(existingProduct.stock_quantity) + normalizeNumber(quantity);
            const totalActualPrice = normalizeNumber(existingProduct.actual_price) * normalizeNumber(existingProduct.stock_quantity) + normalizeNumber(actual_price) * normalizeNumber(quantity);
            const newActualPrice = normalizeNumber(totalActualPrice) / normalizeNumber(newQuantity);

            await client.query(
              'UPDATE products SET stock_quantity = $1, actual_price = $2, selling_price = $3, time_for_delivery = $4, is_weight_based = $5 WHERE id = $6',
              [newQuantity, newActualPrice, selling_price, time_for_delivery, is_weight_based ?? existingProduct.is_weight_based ?? 0, existingProduct.id]
            );
          } else {
            await client.query(
              'INSERT INTO products (name, company, stock_quantity, actual_price, selling_price, category, time_for_delivery, is_weight_based) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
              [product_name, company, quantity, actual_price, selling_price, category, time_for_delivery, is_weight_based ?? 0]
            );
          }
        }

        // Payment should be recorded only when payment is actually made (mark paid).
        orderStatus = 'pending';
      } else if (type === 'personal') {
        const totalAmount = order.total_amount;
        const orderDate = order.client_created_at ? new Date(order.client_created_at) : new Date();
        const orderResult = await client.query(
          'INSERT INTO orders (total_price, order_status, payment_mode, created_at, location, transaction_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
          [totalAmount, 'pending', paymentMode || null, orderDate, resolvedLocation, 'personal']
        );

        orderId = orderResult.rows[0].id;

        // Payment should be recorded only when payment is actually made (mark paid).
        orderStatus = 'pending';
      }

      await client.query('COMMIT');

      results.push({
        client_order_id: clientOrderId || null,
        status: 'created',
        order_id: orderId,
        order_status: orderStatus,
        payment_mode: paymentMode || null
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

 module.exports = {markOrderAsPaid, createOrder, getAllOrders, getOrderById, updateOrder, deleteOrder, getProfitByOrderId, getCategories, syncOfflineOrders}

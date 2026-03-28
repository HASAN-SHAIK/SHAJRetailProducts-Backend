const pool = require('../db'); // Database connection
const getRequestPool = (req) => req.tenantPool || pool;
const { getAuthUser } = require('../utils/auth');
const { getDateRange } = require('../utils/dateRange');
const { resolveBranchIdFromRequest } = require('../utils/branch');

// 💳 Create a Transaction (Payment Processing)
const createTransaction = async (req, res) => {
    const requestPool = getRequestPool(req);
    const client = await requestPool.connect();
    try {
        await client.query('BEGIN'); // Start transaction

        const { order_id, payment_method, payment_mode, amount_paid } = req.body;
        
        // 🔍 Check if order exists and fetch total selling_price
        const orderQuery = `SELECT total_price, returned_amount, order_status FROM orders WHERE id = $1 FOR UPDATE`;
        const orderRes = await client.query(orderQuery, [order_id]);

        if (orderRes.rows.length === 0) {
            throw new Error(`Order ID ${order_id} not found`);
        }

        const { total_price, returned_amount, order_status } = orderRes.rows[0];

        // 🚨 Prevent duplicate payments or processing canceled orders
        if (['completed', 'partially_returned', 'fully_returned'].includes(order_status)) {
            throw new Error(`Order ID ${order_id} is already paid`);
        } else if (order_status === 'canceled') {
            throw new Error("Cannot process payment for a canceled order");
        }

        // 🔍 Validate amount paid
        const netTotal = Number(total_price || 0) - Number(returned_amount || 0);
        if (amount_paid !== netTotal) {
            throw new Error(`Amount paid (${amount_paid}) does not match order total (${netTotal})`);
        }

        // 💾 Insert transaction
        const profitRes = await client.query(
            `SELECT COALESCE(SUM(
                CASE
                  WHEN oi.profit IS NOT NULL THEN oi.profit
                  ELSE (oi.selling_price - COALESCE(oi.purchase_price_snapshot, 0)) * oi.quantity
                END
             ), 0)::numeric AS profit
             FROM order_items oi
             WHERE oi.order_id = $1`,
            [order_id]
        );
        const resolvedProfit = Number(profitRes.rows[0]?.profit || 0);

        const transactionQuery = `
            INSERT INTO transactions (order_id, total_price, profit, payment_mode, created_at)
            VALUES ($1, $2, $3, $4, now()) RETURNING id;
        `;
        const resolvedPaymentModeRaw = (payment_mode || payment_method || 'cash').toLowerCase();
        const resolvedPaymentMode = resolvedPaymentModeRaw === 'upi' || resolvedPaymentModeRaw === 'online'
            ? 'online'
            : 'cash';
        const transactionRes = await client.query(transactionQuery, [order_id, total_price, resolvedProfit, resolvedPaymentMode]);
        const transactionId = transactionRes.rows[0].id;

        // ✅ Mark order as completed
        const updateOrderQuery = `UPDATE orders SET order_status = 'completed', payment_mode = $2 WHERE id = $1;`;
        await client.query(updateOrderQuery, [order_id, resolvedPaymentMode]);

        await client.query('COMMIT'); // Commit transaction
        res.status(201).json({ message: 'Payment successful', transactionId });

    } catch (error) {
        await client.query('ROLLBACK'); // Rollback on failure
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

// 📜 Get All Transactions
const getAllTransactions = async (req, res) => {
    try {
        const tenantId = req.user?.tenant_id;
        if (req.tenantPool && !tenantId) {
            return res.status(401).json({ message: "Missing tenant_id" });
        }
        const requestPool = getRequestPool(req);
        const { range, start_date: startDateRaw, end_date: endDateRaw, page, limit } = req.query || {};
        const resolvedPage = Math.max(parseInt(page, 10) || 1, 1);
        const resolvedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
        const offset = (resolvedPage - 1) * resolvedLimit;
        const { start, end } = getDateRange(range, startDateRaw, endDateRaw);
        const branchId = resolveBranchIdFromRequest(req);
                  
        // let {from_date, to_date} = req.query;
        // if(!to_date || !from_date){
        //     to_date = new Date().toISOString().split( "T" )[0];
        //     from_date = new Date();
        //     from_date.setDate(from_date.getDate()-30);
        //     from_date = from_date.toISOString().split( "T" )[0];
        // }

        // console.log(from_date, to_date)
        // const query = `
        //     SELECT top 20 t.*, o.user_id, o.order_status
        //     FROM transactions t
        //     JOIN orders o ON t.order_id = o.id
		// 	where t.transaction_date BETWEEN $1 and $2
        //     ORDER BY t.transaction_date DESC;
        // `;        
        const query = `
        SELECT t.*, o.order_status, o.branch_id
        FROM transactions t
        JOIN orders o ON t.order_id = o.id
        WHERE t.created_at BETWEEN $1 AND $2
          AND ($5::uuid IS NULL OR o.branch_id = $5)
        ORDER BY t.created_at DESC
        LIMIT $3 OFFSET $4;
        `;
        const query2 = `
        SELECT SUM(t.total_price) AS total_cash
        FROM transactions t
        JOIN orders o ON t.order_id = o.id
        WHERE t.payment_mode = 'cash'
          AND t.created_at BETWEEN $1 AND $2
          AND ($3::uuid IS NULL OR o.branch_id = $3)
        `;
        const query3 = `
        SELECT SUM(t.total_price) AS total_cash
        FROM transactions t
        JOIN orders o ON t.order_id = o.id
        WHERE t.payment_mode = 'online'
          AND t.created_at BETWEEN $1 AND $2
          AND ($3::uuid IS NULL OR o.branch_id = $3)
        `;
        const query4 = `
        SELECT SUM(t.profit) AS profit
        FROM transactions t
        JOIN orders o ON t.order_id = o.id
        WHERE t.created_at BETWEEN $1 AND $2
          AND ($3::uuid IS NULL OR o.branch_id = $3)
        `;
        const result = await requestPool.query(query, [start, end, resolvedLimit, offset, branchId]);
        const result2 = await requestPool.query(query2, [start, end, branchId]);
        const result3 = await requestPool.query(query3, [start, end, branchId]);
        const result4 = await requestPool.query(query4, [start, end, branchId]);
        // console.log(personalCashRes.rows[0].total_cash, typeof(personalCashRes.rows[0].total_cash));
        // const total_cash = parseFloat(result2.rows[0].total_cash) || 0 - parseFloat(personalCashRes.rows[0].total_cash) || 0;

        const total_cash = parseFloat(result2.rows[0].total_cash) || 0;
        const total_online = parseFloat(result3.rows[0].total_cash) || 0;
        const decoded = getAuthUser(req);
        if (!decoded) {
            return res.status(401).json({ message: "Access Denied" });
        }
        if(decoded.role !== 'admin')
            return res.json({
                transactions: result.rows,
                message: "Haha! You are not admin :)"
        }) 
        else
        return res.status(200).json({
            total_cash: total_cash,
            total_online: total_online,
            total_income: total_cash +total_online,
            profit: result4.rows[0].profit,
            transactions: result.rows,
            page: resolvedPage,
            limit: resolvedLimit
    });
    } catch (error) {
        if (error.message === 'INVALID_DATE_RANGE') {
            return res.status(400).json({ error: 'Invalid date range' });
        }
        res.status(500).json({ error: error.message });
    }
};

// 🛑 Rollback Transaction (In case of refund or failure)
const rollbackTransaction = async (req, res) => {
    const requestPool = getRequestPool(req);
    const client = await requestPool.connect();
    try {
        await client.query('BEGIN');

        const { transaction_id } = req.body;

        // Get transaction details
        const transactionQuery = `SELECT order_id, total_price FROM transactions WHERE id = $1 FOR UPDATE;`;
        const transactionRes = await client.query(transactionQuery, [transaction_id]);

        if (transactionRes.rows.length === 0) {
            throw new Error(`Transaction ID ${transaction_id} not found`);
        }

        const { order_id, total_price } = transactionRes.rows[0];

        // Delete the transaction row and mark order as pending
        await client.query(`DELETE FROM transactions WHERE id = $1`, [transaction_id]);
        const updateOrderQuery = `UPDATE orders SET order_status = 'pending' WHERE id = $1`;
        await client.query(updateOrderQuery, [order_id]);

        await client.query('COMMIT');
        res.status(200).json({ message: 'Transaction rolled back successfully' });

    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

// const withdrawMoney =async (req, res) => {
//     const {amount} = req.body;
//     try {
//         await pool.query(`INSERT into transactions `)
//     } catch (error) {
        
//     }
// }

module.exports = { createTransaction, getAllTransactions, rollbackTransaction };

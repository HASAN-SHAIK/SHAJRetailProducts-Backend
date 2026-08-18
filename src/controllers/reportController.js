const { getDaysInMonth } = require('../../utils/dateMethods');
const { getAuthUser } = require('../utils/auth');

const pool = require('../db');
const getRequestPool = (req) => req.tenantPool || pool;
const getReportBranchId = (req) => req.reportBranchId || null;
// 📊 **Total Sales Report**
//Today and LastMonth Review
const getPreviousMonthRangeUtc = () => {
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth(); // 0-based
    const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
    const start = new Date(Date.UTC(prevYear, prevMonth, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(prevYear, prevMonth + 1, 0, 23, 59, 59, 999));
    return { start, end };
};

const getLastNDaysRangeUtc = (days) => {
    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const start = new Date(todayUtc);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    const end = new Date(todayUtc);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start, end };
};

const formatDateUtc = (dateObj) => {
    const year = dateObj.getUTCFullYear();
    const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const SALES_STATUSES = ['completed', 'partially_returned', 'fully_returned'];

const getSalesReport = async (req, res) => {
   try {
        const requestPool = getRequestPool(req);
        const branchId = getReportBranchId(req);
        const decoded = getAuthUser(req);
        if (!decoded) {
            return res.status(401).json({ message: "Access Denied" });
        }
    
       let { from_date, to_date } = req.query;
       // If no dates are provided, use previous calendar month (UTC)
       if (!from_date || !to_date) {
        const { start, end } = getPreviousMonthRangeUtc();
        from_date = start;
        to_date = end;
       }
       // Fetch Total Revenue
       const revenueResult = await requestPool.query(
           `SELECT SUM(o.total_price - COALESCE(o.returned_amount, 0)) AS total_revenue
            FROM orders o
            WHERE o.order_status = ANY($3::text[])
              AND o.created_at BETWEEN $1 AND $2
              AND ($4::uuid IS NULL OR o.branch_id = $4::uuid);`,
           [from_date, to_date, SALES_STATUSES, branchId]
       );
       // Fetch Total Orders
       const ordersResult = await requestPool.query(
           `SELECT COUNT(*) AS total_orders
            FROM orders o
            WHERE o.order_status = ANY($3::text[])
              AND o.created_at BETWEEN $1 AND $2
              AND ($4::uuid IS NULL OR o.branch_id = $4::uuid);`,
           [from_date, to_date, SALES_STATUSES, branchId]
       );

        // Total Cost (How much we paid for sold products)
        const costResult = await requestPool.query(
                `SELECT SUM(GREATEST(oi.quantity - COALESCE(r.returned_qty, 0), 0) * COALESCE(oi.purchase_price_snapshot, 0)) AS total_cost
                 FROM order_items oi
                 JOIN orders o ON oi.order_id = o.id
                 LEFT JOIN (
                   SELECT r.order_id, ori.product_id, SUM(ori.quantity) AS returned_qty
                   FROM order_returns r
                   JOIN order_return_items ori ON ori.return_id = r.id
                   GROUP BY r.order_id, ori.product_id
                 ) r ON r.order_id = o.id AND r.product_id = oi.product_id
                 WHERE o.order_status = ANY($3::text[])
                   AND o.created_at BETWEEN $1 AND $2
                   AND ($4::uuid IS NULL OR o.branch_id = $4::uuid);`,
                 [from_date, to_date, SALES_STATUSES, branchId]
        );

        // const totalProfitRes = await pool.query('select sum(profit) as total_profit from transactions where transaction_date = $1', [to_date])
        const totalRevenue = revenueResult.rows[0].total_revenue || 0;
        const totalCost = costResult.rows[0].total_cost || 0;
        const profitResult = await requestPool.query(
            `SELECT COALESCE(SUM(
                GREATEST(oi.quantity - COALESCE(r.returned_qty, 0), 0)
                * (COALESCE(oi.profit, 0) / NULLIF(oi.quantity, 0))
             ), 0) AS total_profit
             FROM order_items oi
             JOIN orders o ON oi.order_id = o.id
             LEFT JOIN (
               SELECT r.order_id, ori.product_id, SUM(ori.quantity) AS returned_qty
               FROM order_returns r
               JOIN order_return_items ori ON ori.return_id = r.id
               GROUP BY r.order_id, ori.product_id
             ) r ON r.order_id = o.id AND r.product_id = oi.product_id
             WHERE o.order_status = ANY($3::text[])
               AND o.created_at BETWEEN $1 AND $2
               AND ($4::uuid IS NULL OR o.branch_id = $4::uuid);`,
            [from_date, to_date, SALES_STATUSES, branchId]
        );
        const totalProfit = profitResult.rows[0]?.total_profit || 0;
        const bestSellingProducts = await getBestSellingProducts(requestPool, from_date, to_date, branchId);
        const profitByProductResult = await getprofitByProductResult(requestPool, from_date, to_date, branchId);

       return res.json({
           total_revenue: revenueResult.rows[0].total_revenue || 0,
           total_orders: ordersResult.rows[0].total_orders || 0,
           totalProfit: totalProfit,
           bestSellingProducts: bestSellingProducts.rows,
           profitByProduct: profitByProductResult.rows,
       });}
 catch (error) {
       console.error("Error fetching sales report:", error);
       res.status(500).json({ message: "Internal server error" });
   }
};

const getBestSellingProducts = async (db, fromDate, toDate, branchId = null) =>{
    // Fetch Best-Selling Products
    const bestSellingResult = await db.query(
            `SELECT SUM(GREATEST(oi.quantity - COALESCE(r.returned_qty, 0), 0)) AS NoOfSold,
                    SUM(GREATEST(oi.quantity - COALESCE(r.returned_qty, 0), 0) * (COALESCE(oi.profit, 0) / NULLIF(oi.quantity, 0))) AS Profit,
                    p.name AS Name,
                    p.company AS Company
             FROM order_items oi
             JOIN products p ON p.id = oi.product_id
             JOIN orders o ON o.id = oi.order_id
             LEFT JOIN (
               SELECT r.order_id, ori.product_id, SUM(ori.quantity) AS returned_qty
               FROM order_returns r
               JOIN order_return_items ori ON ori.return_id = r.id
               GROUP BY r.order_id, ori.product_id
             ) r ON r.order_id = o.id AND r.product_id = oi.product_id
             WHERE o.order_status = ANY($3::text[])
               AND o.created_at BETWEEN $1 AND $2
               AND ($4::uuid IS NULL OR o.branch_id = $4::uuid)
             GROUP BY p.id
             ORDER BY NoOfSold DESC
             LIMIT 20`,
            [fromDate, toDate, SALES_STATUSES, branchId]
    );
    return bestSellingResult;
}

const getprofitByProductResult = async (db, fromDate, toDate, branchId = null) => {
    // Profit by Product
    const profitByProductResult = await db.query(
        `SELECT SUM(GREATEST(oi.quantity - COALESCE(r.returned_qty, 0), 0)) AS NoOfSold,
                SUM(GREATEST(oi.quantity - COALESCE(r.returned_qty, 0), 0) * (COALESCE(oi.profit, 0) / NULLIF(oi.quantity, 0))) AS Profit,
                p.name AS Name,
                p.company AS Company,
                p.selling_price AS Price
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         JOIN orders o ON o.id = oi.order_id
         LEFT JOIN (
           SELECT r.order_id, ori.product_id, SUM(ori.quantity) AS returned_qty
           FROM order_returns r
           JOIN order_return_items ori ON ori.return_id = r.id
           GROUP BY r.order_id, ori.product_id
         ) r ON r.order_id = o.id AND r.product_id = oi.product_id
         WHERE o.order_status = ANY($3::text[])
           AND o.created_at BETWEEN $1 AND $2
           AND ($4::uuid IS NULL OR o.branch_id = $4::uuid)
         GROUP BY p.id
         ORDER BY Profit DESC
         LIMIT 20`,
        [fromDate, toDate, SALES_STATUSES, branchId]
    );
    return profitByProductResult;
}
// 📦 **Inventory Stock Report**
const getInventoryReport = async (req, res) => {
    try {
        const requestPool = getRequestPool(req);
        const { threshold = 5 } = req.query; // Default threshold = 5
        // Total Stock Count
        const totalStockResult = await requestPool.query(
            "SELECT SUM(stock_quantity) AS total_stock FROM products WHERE is_deleted = FALSE;"
        );
        // Low Stock Products (Threshold based)
        const lowStockResult = await requestPool.query(
            `SELECT id as ProductId, name as Name, stock_quantity as Quantity, purchase_price as ActualPrice,
                    company as Seller, time_for_delivery as TimeForDelivery
             FROM products
             WHERE stock_quantity > 0 AND stock_quantity <= $1 AND is_deleted = FALSE
             ORDER BY stock_quantity
             LIMIT 500`,
            [threshold]
        );
        // Out of Stock Products
        const outOfStockResult = await requestPool.query(
            `SELECT id as ProductId, name as Name, purchase_price as ActualPrice,
                    company as Seller, time_for_delivery as TimeForDelivery
             FROM products
             WHERE stock_quantity = 0 AND is_deleted = FALSE
             ORDER BY name
             LIMIT 500`
        );
        // Total Inventory Value
        const stockValueResult = await requestPool.query(
            "SELECT SUM(stock_quantity * selling_price) AS total_inventory_value FROM products WHERE is_deleted = FALSE;"
        );
        // Estimated Profit
        const actual_stock_value = await requestPool.query(
            "SELECT SUM(stock_quantity * purchase_price) AS total_inventory_actual_value FROM products WHERE is_deleted = FALSE;"
        )
        const decoded = getAuthUser(req);
        if (!decoded) {
            return res.status(401).json({ message: "Access Denied" });
        }
        res.json({
            total_stock: totalStockResult.rows[0].total_stock || 0,
            low_stock_products: lowStockResult.rows,
            out_of_stock_products: outOfStockResult.rows,
            total_inventory_value: decoded.role === 'admin' ?stockValueResult.rows[0].total_inventory_value || 0 : null,
            total_inventory_actual_value: actual_stock_value.rows[0].total_inventory_actual_value, 
            estimatedProfit: decoded.role === 'admin'? stockValueResult.rows[0].total_inventory_value - actual_stock_value.rows[0].total_inventory_actual_value: null,
        });

    } catch (error) {
        console.error("Error fetching inventory report:", error);
        res.status(500).json({ message: "Internal server error" });
    }
 };

const getProfitReport = async (req, res) => {
    try {  
        const requestPool = getRequestPool(req);
        const branchId = getReportBranchId(req);
        const decoded = getAuthUser(req);
        if (!decoded) {
            return res.status(401).json({ message: "Access Denied" });
        }
        let { from_date, to_date } = req.query;
        let dateFilter = "";
        let dateFilterOrders = "";
        let values = [];
        if (!from_date || !to_date) {
            const { start, end } = getPreviousMonthRangeUtc();
            from_date = start;
            to_date = end;
        }
        if (from_date && to_date) {
            dateFilter = "AND t.created_at BETWEEN $1 AND $2";
            dateFilterOrders = "AND o.created_at BETWEEN $1 AND $2";
            values.push(from_date, to_date);
        }
        // Total Revenue (Completed Sales)
        const revenueResult = await requestPool.query(
            `SELECT SUM(o.total_price - COALESCE(o.returned_amount, 0)) AS total_revenue
             FROM orders o
             WHERE o.order_status = ANY($3::text[]) ${dateFilterOrders}
               AND ($4::uuid IS NULL OR o.branch_id = $4::uuid);`,
            [...values, SALES_STATUSES, branchId]
        );
        // Total Profit (How much we Got for sold products)
        const profitResult = await requestPool.query(
            `SELECT COALESCE(SUM(
                GREATEST(oi.quantity - COALESCE(r.returned_qty, 0), 0)
                * (COALESCE(oi.profit, 0) / NULLIF(oi.quantity, 0))
             ), 0) AS total_profit
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             LEFT JOIN (
               SELECT r.order_id, ori.product_id, SUM(ori.quantity) AS returned_qty
               FROM order_returns r
               JOIN order_return_items ori ON ori.return_id = r.id
               GROUP BY r.order_id, ori.product_id
             ) r ON r.order_id = o.id AND r.product_id = oi.product_id
             WHERE o.order_status = ANY($3::text[])
               AND o.created_at BETWEEN $1 AND $2
               AND ($4::uuid IS NULL OR o.branch_id = $4::uuid);`,
            [from_date, to_date, SALES_STATUSES, branchId]
        );

        const totalProductsRes = await requestPool.query(`select count(*) as total_products from products`);
       
        const totalRevenue = revenueResult.rows[0].total_revenue || 0;
        // const totalCost = costResult.rows[0].total_cost || 0;
        // const totalProfit = totalRevenue - totalCost;
        res.json({
            total_revenue: totalRevenue,
            total_profit: profitResult.rows[0].total_profit,
            total_products: totalProductsRes.rows[0].total_products,
            from_date,
            to_date
        });
    } catch (error) {
        console.error("Error fetching profit report:", error);
        res.status(500).json({ message: "Internal server error" });
    }
 };


const getDailySalesReport = async (req, res) => {
    try {  
        const requestPool = getRequestPool(req);
        const branchId = getReportBranchId(req);
        const decoded = getAuthUser(req);
        if (!decoded) {
            return res.status(401).json({ message: "Access Denied" });
        }
        const { date } = req.query;
        const salesDate = date ? new Date(date) : new Date();
        if (Number.isNaN(salesDate.getTime())) {
            return res.status(400).json({ message: "Invalid date. Use YYYY-MM-DD." });
        }
        salesDate.setHours(0, 0, 0, 0);
        let endOfDay = new Date(salesDate);
        endOfDay.setHours(23, 59, 59, 999);
        // Total Sales Revenue for the day
        const salesResult = await requestPool.query(
            `SELECT SUM(GREATEST(oi.quantity - COALESCE(r.returned_qty, 0), 0) * oi.selling_price - COALESCE(oi.discount_amount, 0)) AS total_revenue
             FROM orders o
             JOIN order_items oi on oi.order_id = o.id
             LEFT JOIN (
               SELECT r.order_id, ori.product_id, SUM(ori.quantity) AS returned_qty
               FROM order_returns r
               JOIN order_return_items ori ON ori.return_id = r.id
               GROUP BY r.order_id, ori.product_id
             ) r ON r.order_id = o.id AND r.product_id = oi.product_id
             WHERE o.order_status = ANY($3::text[])
               AND o.created_at >= $1 AND o.created_at <= $2
               AND ($4::uuid IS NULL OR o.branch_id = $4::uuid);`,
            [salesDate, endOfDay, SALES_STATUSES, branchId]
        );
        const totalOrderRes = await requestPool.query(
            `SELECT count(*) AS total_orders
             FROM orders o
             WHERE o.order_status = ANY($3::text[])
               AND o.created_at >= $1 AND o.created_at <= $2
               AND ($4::uuid IS NULL OR o.branch_id = $4::uuid)`,
            [salesDate, endOfDay, SALES_STATUSES, branchId]
        );
        // Best-Selling Products
        const bestSellingProducts = await requestPool.query(
            `SELECT p.name, SUM(GREATEST(oi.quantity - COALESCE(r.returned_qty, 0), 0)) AS total_sold
             FROM order_items oi
             JOIN products p ON oi.product_id = p.id
             JOIN orders o ON oi.order_id = o.id
             LEFT JOIN (
               SELECT r.order_id, ori.product_id, SUM(ori.quantity) AS returned_qty
               FROM order_returns r
               JOIN order_return_items ori ON ori.return_id = r.id
               GROUP BY r.order_id, ori.product_id
             ) r ON r.order_id = o.id AND r.product_id = oi.product_id
             WHERE o.order_status = ANY($1::text[])
               AND o.created_at >= $2 AND o.created_at <= $3
               AND ($4::uuid IS NULL OR o.branch_id = $4::uuid)
             GROUP BY p.name
             ORDER BY total_sold DESC;`,
            [SALES_STATUSES, salesDate, endOfDay, branchId]
        );
        const profitResult = await requestPool.query(
            `SELECT COALESCE(SUM(
                GREATEST(oi.quantity - COALESCE(r.returned_qty, 0), 0)
                * (COALESCE(oi.profit, 0) / NULLIF(oi.quantity, 0))
             ), 0) AS total_profit
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             LEFT JOIN (
               SELECT r.order_id, ori.product_id, SUM(ori.quantity) AS returned_qty
               FROM order_returns r
               JOIN order_return_items ori ON ori.return_id = r.id
               GROUP BY r.order_id, ori.product_id
             ) r ON r.order_id = o.id AND r.product_id = oi.product_id
             WHERE o.order_status = ANY($3::text[])
               AND o.created_at BETWEEN $1 AND $2
               AND ($4::uuid IS NULL OR o.branch_id = $4::uuid);`,
            [salesDate, endOfDay, SALES_STATUSES, branchId]
        );
        
        res.json({
            date: salesDate,
            total_revenue: salesResult.rows[0].total_revenue || 0,
            profit: profitResult.rows[0].total_profit || 0,
            total_orders: totalOrderRes.rows[0].total_orders || 0,
            best_selling_products: bestSellingProducts.rows,
        });
    } catch (error) {
        console.error("Error fetching daily sales report:", error);
        res.status(500).json({ message: "Internal server error" });
    }
 };
 

const getProfitGraph = async (req, res) => {
    try {
        const requestPool = getRequestPool(req);
        const branchId = getReportBranchId(req);
        const decoded = getAuthUser(req);
        if (!decoded) {
            return res.status(401).json({ message: "Access Denied" });
        }

        const range = req.query.range === '365' ? 365 : 30;
        const { start, end } = getLastNDaysRangeUtc(range);

        const profitRes = await requestPool.query(
            `SELECT DATE(o.created_at AT TIME ZONE 'UTC') AS day,
                    COALESCE(SUM(
                      GREATEST(oi.quantity - COALESCE(r.returned_qty, 0), 0)
                      * (COALESCE(oi.profit, 0) / NULLIF(oi.quantity, 0))
                    ), 0) AS profit
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             LEFT JOIN (
               SELECT r.order_id, ori.product_id, SUM(ori.quantity) AS returned_qty
               FROM order_returns r
               JOIN order_return_items ori ON ori.return_id = r.id
               GROUP BY r.order_id, ori.product_id
             ) r ON r.order_id = o.id AND r.product_id = oi.product_id
             WHERE o.order_status = ANY($3::text[])
               AND o.created_at >= $1
               AND o.created_at < $2
               AND ($4::uuid IS NULL OR o.branch_id = $4::uuid)
             GROUP BY day
             ORDER BY day ASC;`,
            [start, end, SALES_STATUSES, branchId]
        );

        const profitByDay = new Map(
            profitRes.rows.map((row) => [row.day.toISOString().split('T')[0], parseFloat(row.profit) || 0])
        );

        const labels = [];
        const data = [];
        for (let i = 0; i < range; i++) {
            const d = new Date(start);
            d.setUTCDate(start.getUTCDate() + i);
            const label = formatDateUtc(d);
            labels.push(label);
            data.push(profitByDay.get(label) || 0);
        }

        res.json({
            range_days: range,
            from_date: formatDateUtc(start),
            to_date: formatDateUtc(new Date(end.getTime() - 1)),
            labels,
            data
        });
    } catch (error) {
        console.error("Error fetching profit graph:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};


module.exports = { getSalesReport, getInventoryReport, getProfitReport, getDailySalesReport, getProfitGraph };

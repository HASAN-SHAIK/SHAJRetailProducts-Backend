const { getDaysInMonth } = require('../../utils/dateMethods');
const { getAuthUser } = require('../utils/auth');

const pool = require('../db');
const getRequestPool = (req) => req.tenantPool || pool;
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

const getSalesReport = async (req, res) => {
   try {
        const requestPool = getRequestPool(req);
        //Checking role
        const decoded = getAuthUser(req);
        if (!decoded) {
            return res.status(401).json({ message: "Access Denied" });
        }
        if(decoded.role !== 'admin')
            return res.json({
                message: "Haha! You are not admin :)"
            });
    
       let { from_date, to_date } = req.query;
       // If no dates are provided, use previous calendar month (UTC)
       if (!from_date || !to_date) {
        const { start, end } = getPreviousMonthRangeUtc();
        from_date = start;
        to_date = end;
       }
       // Fetch Total Revenue
       const revenueResult = await requestPool.query(
           "SELECT SUM(total_price) AS total_revenue FROM orders WHERE order_status = 'completed' AND created_at BETWEEN $1 AND $2;",
           [from_date, to_date]
       );
       // Fetch Total Orders
       const ordersResult = await requestPool.query(
           "SELECT COUNT(*) AS total_orders FROM orders WHERE order_status = 'completed' AND created_at BETWEEN $1 AND $2;",
           [from_date, to_date]
       );

        // Total Cost (How much we paid for sold products)
        const costResult = await requestPool.query(
                `SELECT SUM(oi.quantity * p.actual_price) AS total_cost
                 FROM order_items oi
                 JOIN products p ON oi.product_id = p.id
                 JOIN orders o ON oi.order_id = o.id
                 WHERE o.order_status = 'completed' and o.created_at BETWEEN $1 and $2;`,
                 [from_date, to_date]
        );

        // const totalProfitRes = await pool.query('select sum(profit) as total_profit from transactions where transaction_date = $1', [to_date])
        const totalRevenue = revenueResult.rows[0].total_revenue || 0;
        const totalCost = costResult.rows[0].total_cost || 0;
        const totalProfit = totalRevenue - totalCost;
        const bestSellingProducts = await getBestSellingProducts(requestPool);
        const profitByProductResult = await getprofitByProductResult(requestPool);

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

const getBestSellingProducts = async (db) =>{
    // Fetch Best-Selling Products
    const bestSellingResult = await db.query(
            `select  sum(t.profit) as Profit, p.name as Name,p.company as Company, sum(oi.quantity) as NoOfSold from order_items oi 
              join transactions t on t.order_id = oi.order_id
              join products p on p.id = oi.product_id
              group by p.id order by NoOfSold desc`
    );
    return bestSellingResult;
}

const getprofitByProductResult = async (db) => {
    // Profit by Product
    const profitByProductResult = await db.query(
        `select  sum(t.profit) as Profit, p.name as Name,p.company as Company, sum(oi.quantity) as NoOfSold, p.selling_price as Price from order_items oi 
        join transactions t on t.order_id = oi.order_id
        join products p on p.id = oi.product_id
        group by p.id order by Profit desc`
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
            "SELECT id as ProductId, name as Name,stock_quantity as Quantity, actual_price as ActualPrice , company as Seller,time_for_delivery as TimeForDelivery FROM products WHERE stock_quantity > 0 AND stock_quantity <= $1 AND is_deleted = FALSE order by stock_quantity",
            [threshold]
        );
        // Out of Stock Products
        const outOfStockResult = await requestPool.query(
            "SELECT id as ProductId, name as Name, actual_price as ActualPrice , company as Seller,time_for_delivery as TimeForDelivery FROM products WHERE stock_quantity = 0 AND is_deleted = FALSE;"
        );
        // Total Inventory Value
        const stockValueResult = await requestPool.query(
            "SELECT SUM(stock_quantity * selling_price) AS total_inventory_value FROM products WHERE is_deleted = FALSE;"
        );
        // Estimated Profit
        const actual_stock_value = await requestPool.query(
            "SELECT SUM(stock_quantity * actual_price) AS total_inventory_actual_value FROM products WHERE is_deleted = FALSE;"
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
        const decoded = getAuthUser(req);
        if (!decoded) {
            return res.status(401).json({ message: "Access Denied" });
        }
        if(decoded.role !== 'admin')
            return res.json({
                message: "Haha! You are not admin :)"
        })             
        let { from_date, to_date } = req.query;
        let dateFilter = "";
        let values = [];
        if (!from_date || !to_date) {
            const { start, end } = getPreviousMonthRangeUtc();
            from_date = start;
            to_date = end;
        }
        if (from_date && to_date) {
            dateFilter = "AND t.created_at BETWEEN $1 AND $2";
            values.push(from_date, to_date);
        }
        // Total Revenue (Completed Sales)
        const revenueResult = await requestPool.query(
            `SELECT SUM(o.total_price) AS total_revenue
             FROM orders o
             JOIN transactions t ON o.id = t.order_id
             WHERE o.order_status = 'completed' ${dateFilter};`,
            values
        );
        // Total Profit (How much we Got for sold products)
        const profitResult = await requestPool.query(
            `select sum(profit) as total_profit from transactions where created_at BETWEEN $1 and $2;`, [from_date, to_date]
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
        const decoded = getAuthUser(req);
        if (!decoded) {
            return res.status(401).json({ message: "Access Denied" });
        }
        if(decoded.role !== 'admin')
            return res.json({
                message: "Haha! You are not admin :)"
        })
        const { date } = req.query;
        const salesDate = date ? new Date(date) : new Date();
        if (Number.isNaN(salesDate.getTime())) {
            return res.status(400).json({ message: "Invalid date. Use YYYY-MM-DD." });
        }
        salesDate.setHours(0, 0, 0, 0);
        // Total Sales Revenue for the day
        const salesResult = await requestPool.query(
            `SELECT SUM(oi.quantity * oi.selling_price) AS total_revenue
             FROM orders o join order_items oi on oi.order_id = o.id
             WHERE o.order_status = 'completed'
             AND DATE(o.created_at) = $1;`,
            [salesDate]
        );
        const totalOrderRes = await requestPool.query(`select count(*) as total_orders from orders where order_status = 'completed' and Date(created_at) = $1`,[salesDate]);
        // Best-Selling Products
        const bestSellingProducts = await requestPool.query(
            `SELECT p.name, SUM(oi.quantity) AS total_sold
             FROM order_items oi
             JOIN products p ON oi.product_id = p.id
             JOIN orders o ON oi.order_id = o.id
             WHERE o.order_status = 'completed'
             GROUP BY p.name
             ORDER BY total_sold DESC;`
        );
        let endOfDay = new Date(salesDate);
        endOfDay.setHours(23, 59, 59, 999);
        const profitResult = await requestPool.query(
            `select sum(t.profit) as total_profit from transactions t join orders o on o.id = t.order_id where o.order_status = 'completed' and t.created_at between $1 and $2;`, [salesDate, endOfDay]
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
        const decoded = getAuthUser(req);
        if (!decoded) {
            return res.status(401).json({ message: "Access Denied" });
        }
        if (decoded.role !== 'admin') {
            return res.json({ message: "Haha! You are not admin :)" });
        }

        const range = req.query.range === '365' ? 365 : 30;
        const { start, end } = getLastNDaysRangeUtc(range);

        const profitRes = await requestPool.query(
            `SELECT DATE(t.created_at AT TIME ZONE 'UTC') AS day, SUM(t.profit) AS profit
             FROM transactions t
             JOIN orders o ON o.id = t.order_id
             WHERE o.order_status = 'completed'
               AND t.created_at >= $1
               AND t.created_at < $2
             GROUP BY day
             ORDER BY day ASC;`,
            [start, end]
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

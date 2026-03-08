// npm install pg dotenv

require("dotenv").config();
const { Client } = require("pg");

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function runTests() {
  try {
    await client.connect();
    console.log("✅ Connected to database");

    const tenantId = "test_tenant";

    // 1️⃣ Insert test product
    const product = await client.query(
      `INSERT INTO products 
      (name, selling_price, actual_price, stock_quantity, tenant_id)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING id, stock_quantity`,
      ["Test Saree", 2000, 1500, 10, tenantId]
    );

    const productId = product.rows[0].id;
    console.log("✅ Product created:", productId);

    // 2️⃣ Create sale
    const sale = await client.query(
      `INSERT INTO sales (tenant_id, total_amount, payment_method)
       VALUES ($1,$2,$3)
       RETURNING id`,
      [tenantId, 2000, "cash"]
    );

    const saleId = sale.rows[0].id;

    // 3️⃣ Insert sale item
    await client.query(
      `INSERT INTO sale_items (sale_id, product_id, quantity, price)
       VALUES ($1,$2,$3,$4)`,
      [saleId, productId, 2, 2000]
    );

    console.log("✅ Sale created:", saleId);

    // 4️⃣ Deduct stock
    await client.query(
      `UPDATE products
       SET stock_quantity = stock_quantity - 2
       WHERE id = $1`,
      [productId]
    );

    // 5️⃣ Verify stock
    const stock = await client.query(
      `SELECT stock_quantity FROM products WHERE id=$1`,
      [productId]
    );

    console.log("📦 Remaining Stock:", stock.rows[0].stock_quantity);

    // 6️⃣ Check negative stock
    const negative = await client.query(
      `SELECT * FROM products WHERE stock_quantity < 0`
    );

    if (negative.rows.length === 0) {
      console.log("✅ No negative stock found");
    } else {
      console.log("❌ Negative stock detected");
    }

    // 7️⃣ Cleanup test data
    await client.query(`DELETE FROM sale_items WHERE sale_id=$1`, [saleId]);
    await client.query(`DELETE FROM sales WHERE id=$1`, [saleId]);
    await client.query(`DELETE FROM products WHERE id=$1`, [productId]);

    console.log("🧹 Test data cleaned");

  } catch (err) {
    console.error("❌ Test failed:", err);
  } finally {
    await client.end();
    console.log("🔌 DB connection closed");
  }
}

runTests();
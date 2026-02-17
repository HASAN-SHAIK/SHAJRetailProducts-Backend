const request = require("supertest");
const app = require("../src/App"); // Adjust path based on your file structure
const pool = require("../src/db"); // Your PostgreSQL pool

describe("Order API", () => {
  const testRunId = Date.now();
  let orderId;
  let token;
  let deviceId;
  let userId;
  let productId;
  let testProducts;
  const createdOrderIds = [];
  const purchaseProductNames = [
    `TMT Steel Rod ${testRunId}`,
    `Cement Bag ${testRunId}`
  ];

  beforeAll(async () => {
    deviceId = `device-${testRunId}`;
    const testUser = {
      name: "Order Admin",
      email: `order_admin_${testRunId}@example.com`,
      password: "Admin@123",
      role: "admin"
    };

    const registerRes = await request(app).post("/api/auth/register").send(testUser);
    userId = registerRes.body.user?.id;

    const loginRes = await request(app).post("/api/auth/login").send({
      email: testUser.email,
      password: testUser.password,
      device_id: deviceId
    });
    token = loginRes.body.token;

    const productRes = await pool.query(
      "INSERT INTO products (name, category, selling_price, actual_price, company, stock_quantity, is_deleted, time_for_delivery, is_weight_based) VALUES ($1, $2, $3, $4, $5, $6, FALSE, $7, $8) RETURNING id",
      [`Test Product ${testRunId}`, "Test Category", 100, 60, "TestCo", 1000, 3, 0]
    );
    productId = productRes.rows[0].id;
    testProducts = [{ product_id: productId, quantity: 2 }];
  });

  afterAll(async () => {
    try {
      if (createdOrderIds.length > 0) {
        await pool.query("DELETE FROM orders WHERE id = ANY($1)", [createdOrderIds]);
      }
      if (productId) {
        await pool.query("DELETE FROM products WHERE id = $1", [productId]);
      }
      await pool.query("DELETE FROM products WHERE name = ANY($1)", [purchaseProductNames]);
      if (userId) {
        await pool.query("DELETE FROM users WHERE id = $1", [userId]);
      }
    } finally {
      await pool.end(); // Close DB pool after all tests
    }
  });

  test("Should create a sale order successfully", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set("Cookie", `token=${token}`)
      .set("x-device-id", deviceId)
      .send({
        transaction_type: "sale",
        payment_mode: "cash",
        user_id: userId,
        products: testProducts
      });
    orderId = res.body.order_id;
    createdOrderIds.push(orderId);
    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty("message", "Order created successfully");
    expect(res.body).toHaveProperty("order_id");
  });

  test("Mard as paid", async () => {
    const res = await request(app)
      .post("/api/orders/mark-paid")
      .set("Cookie", `token=${token}`)
      .set("x-device-id", deviceId)
      .send({
        order_id: orderId,
        type: "sale"
      });
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe("Order marked as paid successfully");
  });

  test("Should fail with missing user_id", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set("Cookie", `token=${token}`)
      .set("x-device-id", deviceId)
      .send({
        payment_mode: "cash",
        transaction_type: "sale",
        products: testProducts
      });

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  test("Should fail with empty product list", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set("Cookie", `token=${token}`)
      .set("x-device-id", deviceId)
      .send({
        payment_mode: "cash",
        transaction_type: "sale",
        user_id: userId,
        products: []
      });

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  test("Should fail if stock is insufficient", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set("Cookie", `token=${token}`)
      .set("x-device-id", deviceId)
      .send({
        payment_mode: "cash",
        transaction_type: "sale",
        user_id: userId,
        products: [{ product_id: productId, quantity: 100000 }]
      });

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty("error", expect.stringContaining("Insufficient stock"));
  });

  it("should create a personal order successfully", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set("Cookie", `token=${token}`)
      .set("x-device-id", deviceId)
      .send({
        user_id: userId,
        transaction_type: "personal",
        payment_mode: "cash",
        total_amount: 100
      });
    const delRes = await request(app)
      .delete(`/api/orders/${res.body.orderId}`)
      .set("Cookie", `token=${token}`)
      .set("x-device-id", deviceId);
    expect(delRes.statusCode).toBe(204);
    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty("orderId");
    expect(res.body.transaction_type).toBe("personal");
    createdOrderIds.push(res.body.orderId);
  });

  it("Delete the order", async () => {
    const res = await request(app)
      .delete(`/api/orders/${orderId}`)
      .set("Cookie", `token=${token}`)
      .set("x-device-id", deviceId);
    expect(res.statusCode).toBe(204);
  });

  it("should create a purchase order successfully", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set("Cookie", `token=${token}`)
      .set("x-device-id", deviceId)
      .send({
        user_id: userId,
        total_amount: 5600,
        payment_mode: "online",
        transaction_type: "purchase",
        products: [
          {
            product_name: purchaseProductNames[0],
            company: "JSW",
            quantity: 50,
            actual_price: 100,
            selling_price: 120,
            category: "construction",
            time_for_delivery: 3
          },
          {
            product_name: purchaseProductNames[1],
            company: "Ultratech",
            quantity: 30,
            actual_price: 200,
            selling_price: 250,
            category: "construction"
          }
        ]
      });

    const delRes = await request(app)
      .delete(`/api/orders/${res.body.orderId}`)
      .set("Cookie", `token=${token}`)
      .set("x-device-id", deviceId);

    expect(delRes.statusCode).toBe(204);
    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty("message");
    expect(res.body).toHaveProperty("orderId");
    expect(res.body.transaction_type).toBe("purchase");
    createdOrderIds.push(res.body.orderId);
  });

  it("should return 400 if required fields are missing", async () => {
    const res = await request(app)
      .post("/api/orders")
      .set("Cookie", `token=${token}`)
      .set("x-device-id", deviceId)
      .send({
        user_id: userId,
        // transaction_type missing
        payment_mode: "cash",
        products: [{ product_id: productId, quantity: 2 }]
      });

    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  describe("GET /orders/:id", () => {
    it("should fetch an order by ID", async () => {
      const saleRes = await request(app)
        .post("/api/orders")
        .set("Cookie", `token=${token}`)
        .set("x-device-id", deviceId)
        .send({
          transaction_type: "sale",
          payment_mode: "cash",
          user_id: userId,
          products: testProducts
        });
      const saleOrderId = saleRes.body.order_id;
      createdOrderIds.push(saleOrderId);
      const getRes = await request(app)
        .get(`/api/orders/${saleOrderId}`)
        .set("Cookie", `token=${token}`)
        .set("x-device-id", deviceId);

      expect(getRes.statusCode).toBe(200);
      expect(getRes.body).toHaveProperty("order");
      expect(getRes.body.order).toHaveProperty("id");
      expect(getRes.body).toHaveProperty("items");
    });

    it("should return 404 for non-existing order", async () => {
      const res = await request(app)
        .get("/api/orders/999999")
        .set("Cookie", `token=${token}`)
        .set("x-device-id", deviceId);

      expect(res.statusCode).toBe(404);
      expect(res.body).toHaveProperty("error", "Order not found");
    });
  });

  describe("GET /orders", () => {
    it("should fetch all orders", async () => {
      const res = await request(app)
        .get("/api/orders")
        .set("Cookie", `token=${token}`)
        .set("x-device-id", deviceId);
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty("completedOrders");
      expect(res.body).toHaveProperty("orders");
    });
  });
});

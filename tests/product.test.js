const request = require("supertest");
const app = require("../src/App"); // Adjust path based on your file structure
const pool = require("../src/db"); // Your PostgreSQL pool

describe("product API", () => {
  const testRunId = Date.now();
  let adminToken;
  let productId;
  const deviceId = `device-${testRunId}`;
  const adminUser = {
    name: "Product Admin",
    email: `product_admin_${testRunId}@example.com`,
    password: "Admin@123",
    role: "admin"
  };

  beforeAll(async () => {
    await request(app).post("/api/auth/register").send(adminUser);
    const loginRes = await request(app).post("/api/auth/login").send({
      email: adminUser.email,
      password: adminUser.password,
      device_id: deviceId
    });
    adminToken = loginRes.body.token;
  });

  afterAll(async () => {
    try {
      if (productId) {
        await pool.query("DELETE FROM products WHERE id = $1", [productId]);
      }
      await pool.query("DELETE FROM users WHERE email = $1", [adminUser.email]);
    } finally {
      await pool.end(); // Close DB pool after all tests
    }
  });

  it("Get all Products", async () => {
    const productRes = await request(app)
      .get("/api/products")
      .set("Cookie", `token=${adminToken}`)
      .set("x-device-id", deviceId);
    expect(productRes.statusCode).toBe(200);
  });

  it("add product", async () => {
    const uniqueName = `cement_${testRunId}`;
    const res = await request(app)
      .post("/api/products")
      .set("Cookie", `token=${adminToken}`)
      .set("x-device-id", deviceId)
      .send({
        product_name: uniqueName,
        company: "Sagar Cements",
        stock_quantity: 50,
        actual_price: 200,
        selling_price: 250,
        category: "construction"
      });
    expect([200, 201]).toContain(res.statusCode);
    expect(res.body).toHaveProperty("product");
    expect(res.body.product).toHaveProperty("id");
    productId = res.body.product.id;
  });

  it("Search the Product", async () => {
    const productRes = await request(app)
      .get("/api/products/search?name=sagar")
      .set("Cookie", `token=${adminToken}`)
      .set("x-device-id", deviceId);

    expect(productRes.statusCode).toBe(200);
    expect(productRes.body).toHaveProperty("products");
  });

  it("Update product", async () => {
    const res = await request(app)
      .put(`/api/products/${productId}`)
      .set("Cookie", `token=${adminToken}`)
      .set("x-device-id", deviceId)
      .send({
        name: "cement",
        company: "Sagar Cements",
        stock_quantity: 50,
        actual_price: 200,
        selling_price: 260,
        category: "construction"
      });
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("name");
  });

  it("Delete product", async () => {
    const res = await request(app)
      .delete(`/api/products/${productId}`)
      .set("Cookie", `token=${adminToken}`)
      .set("x-device-id", deviceId);

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe("Product deleted");
  });
});

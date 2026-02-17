const request = require("supertest");
const app = require("../src/App");
const pool = require("../src/db");

describe("product API", () => {
  const testRunId = Date.now();
  let adminToken;
  const deviceId = `device-${testRunId}`;
  const adminUser = {
    name: "Admin User",
    email: `admin_${testRunId}@example.com`,
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
      await pool.query("DELETE FROM users WHERE email = $1", [adminUser.email]);
    } finally {
      await pool.end(); // Close DB pool after all tests
    }
  });

  it("get Sales Report with from and to date", async () => {
    const salesRes = await request(app)
      .get("/api/reports/sales?from_date=2020-01-01&to_date=2025-01-01")
      .set("Cookie", `token=${adminToken}`)
      .set("x-device-id", deviceId);
    expect(salesRes.statusCode).toBe(200);
    expect(salesRes.body).toHaveProperty("total_revenue");
    expect(salesRes.body).toHaveProperty("total_orders");
  });

  it("GetSales without date", async () => {
    const salesRes = await request(app)
      .get("/api/reports/sales")
      .set("Cookie", `token=${adminToken}`)
      .set("x-device-id", deviceId);
    expect(salesRes.statusCode).toBe(200);
    expect(salesRes.body).toHaveProperty("total_revenue");
    expect(salesRes.body).toHaveProperty("total_orders");
  });

  it("Get Inventory Report", async () => {
    const salesRes = await request(app)
      .get("/api/reports/inventory")
      .set("Cookie", `token=${adminToken}`)
      .set("x-device-id", deviceId);
    expect(salesRes.statusCode).toBe(200);
    expect(salesRes.body).toHaveProperty("total_stock");
    expect(salesRes.body).toHaveProperty("low_stock_products");
  });

  it("Get Profit Report", async () => {
    const salesRes = await request(app)
      .get("/api/reports/profit")
      .set("Cookie", `token=${adminToken}`)
      .set("x-device-id", deviceId);
    expect(salesRes.statusCode).toBe(200);
    expect(salesRes.body).toHaveProperty("to_date");
  });

  it("Get Daily Sales Report", async () => {
    const salesRes = await request(app)
      .get("/api/reports/daily")
      .set("Cookie", `token=${adminToken}`)
      .set("x-device-id", deviceId);
    expect(salesRes.statusCode).toBe(200);
    expect(salesRes.body).toHaveProperty("total_revenue");
    expect(salesRes.body).toHaveProperty("date");
  });
});

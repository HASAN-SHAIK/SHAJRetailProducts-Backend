const request = require("supertest");
const app = require("../src/App");
const pool = require("../src/db");

describe("Transaction API", () => {
  const testRunId = Date.now();
  let adminToken;
  const deviceId = `device-${testRunId}`;
  const adminUser = {
    name: "Txn Admin",
    email: `txn_admin_${testRunId}@example.com`,
    password: "Admin@123",
    role: "admin"
  };

  beforeAll(async () => {
    await request(app).post("/api/auth/register").send(adminUser);
    const res = await request(app).post("/api/auth/login").send({
      email: adminUser.email,
      password: adminUser.password,
      device_id: deviceId
    });
    adminToken = res.body.token;
  });

  afterAll(async () => {
    try {
      await pool.query("DELETE FROM users WHERE email = $1", [adminUser.email]);
    } finally {
      await pool.end(); // Close DB pool after all tests
    }
  });

  it("Login for Token", async () => {
    expect(adminToken).toBeTruthy();
  });

  it("Get All Transactions", async () => {
    const res = await request(app)
      .get("/api/transactions/")
      .set("Cookie", `token=${adminToken}`)
      .set("x-device-id", deviceId);
    expect(res.statusCode).toBe(200);
    expect(res.body.total_cash + res.body.total_online == res.body.total_income).toBe(true);
    expect(res.body.transactions.length).toBeGreaterThan(-1);
  });
});

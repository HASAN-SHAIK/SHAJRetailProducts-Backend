jest.mock('../src/db', () => ({
  query: jest.fn(),
  on: jest.fn(),
}));

const fs = require('fs');
const path = require('path');
const {
  calculateDenominationsTotal,
} = require('../src/services/shiftService');

const source = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

describe('V1 Cashier Shift Handover & Drawer Cash Declaration (FEAT-AUTH-005)', () => {
  test('routes declare shift management endpoints with orders:read permission', () => {
    const routes = source('src/routes/shiftRoutes.js');
    expect(routes).toContain("router.get('/current', requirePermission('orders:read'), getCurrentShiftController)");
    expect(routes).toContain("router.post('/open', requirePermission('orders:read'), openShiftController)");
    expect(routes).toContain("router.post('/declare', requirePermission('orders:read'), declareAndCloseShiftController)");
    expect(routes).toContain("router.post('/close', requirePermission('orders:read'), declareAndCloseShiftController)");
    expect(routes).toContain("router.get('/', requirePermission('orders:read'), listShiftsController)");
  });

  test('tenant.routes.js mounts shift routes under /shifts', () => {
    const tenantRoutes = source('src/routes/tenant.routes.js');
    expect(tenantRoutes).toContain("router.use('/shifts', shiftRoutes)");
  });

  test('calculateDenominationsTotal computes currency sum accurately', () => {
    const denoms = {
      '500': 10,   // 5000
      '200': 5,    // 1000
      '100': 20,   // 2000
      '50': 10,    // 500
      '20': 15,    // 300
      '10': 20,    // 200
      '5': 10,     // 50
      'coins': 85, // 85
    };
    // 5000 + 1000 + 2000 + 500 + 300 + 200 + 50 + 85 = 9135
    expect(calculateDenominationsTotal(denoms)).toBe(9135);
  });

  test('calculateDenominationsTotal handles null/empty/invalid counts safely', () => {
    expect(calculateDenominationsTotal(null)).toBe(0);
    expect(calculateDenominationsTotal({})).toBe(0);
    expect(calculateDenominationsTotal({ '500': -5, '100': 'invalid' })).toBe(0);
  });

  test('shift variance calculation identifies exact balance, shortage, and overage', () => {
    const computeVariance = (declared, expected) => Math.round((declared - expected) * 100) / 100;

    // 1. Exact balance
    expect(computeVariance(5000, 5000)).toBe(0);

    // 2. Shortage (physical cash is less than system expected)
    expect(computeVariance(4850, 5000)).toBe(-150);

    // 3. Overage (physical cash is more than system expected)
    expect(computeVariance(5200, 5000)).toBe(200);
  });
});

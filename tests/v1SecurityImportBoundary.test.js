const fs = require('fs');
const path = require('path');

jest.mock('../src/db', () => ({
  connect: jest.fn(),
  query: jest.fn(),
}));

const {
  importOfflineItems,
  MAX_OFFLINE_IMPORT_ITEMS,
} = require('../src/services/imports.service');

describe('V1 import input boundary', () => {
  test('offline import rejects oversized batches before opening a tenant DB connection', async () => {
    const connect = jest.fn();
    const req = { tenantPool: { connect } };
    const items = Array.from({ length: MAX_OFFLINE_IMPORT_ITEMS + 1 }, (_, index) => ({
      name: `Product ${index + 1}`,
      purchase_price: 10,
      selling_price: 12,
      quantity: 1,
    }));

    await expect(importOfflineItems(req, { items })).rejects.toMatchObject({
      status: 413,
      code: 'IMPORT_BATCH_TOO_LARGE',
      message: `Import batch exceeds the ${MAX_OFFLINE_IMPORT_ITEMS}-item limit.`,
    });
    expect(connect).not.toHaveBeenCalled();
  });

  test('empty offline imports still fail before DB work', async () => {
    const connect = jest.fn();
    const req = { tenantPool: { connect } };

    await expect(importOfflineItems(req, { items: [] })).rejects.toMatchObject({ status: 400 });
    expect(connect).not.toHaveBeenCalled();
  });

  test('the HTTP JSON parser retains a bounded request-body limit', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '../src/App.js'), 'utf8');
    expect(appSource).toContain("app.use(express.json({ limit: '5mb' }))");
  });
});

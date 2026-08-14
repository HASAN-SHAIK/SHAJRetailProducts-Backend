jest.mock('../db', () => ({}));
jest.mock('./hsnGst.service', () => ({
  resolveGstPercentage: jest.fn(async () => 5),
  upsertHsnGst: jest.fn(async () => {}),
}));
jest.mock('../utils/branch', () => ({
  resolveBranchIdFromRequest: jest.fn(() => '11111111-1111-1111-1111-111111111111'),
}));

const { importProductsFromRows } = require('./productImport.service');

describe('V1 Products/Catalog import acceptance', () => {
  test('Frontend import-row shape becomes one branch-scoped canonical product and batch transaction', async () => {
    const queries = [];
    const client = {
      query: jest.fn(async (sql, params = []) => {
        const text = String(sql).replace(/\s+/g, ' ').trim();
        queries.push({ text, params });
        if (text.includes('SELECT COALESCE(is_opening_completed')) {
          return { rows: [{ is_opening_completed: false }], rowCount: 1 };
        }
        if (text.startsWith('INSERT INTO products')) {
          return { rows: [{ id: 101 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: jest.fn(),
    };
    const tenantPool = {
      query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
      connect: jest.fn(async () => client),
    };
    const req = { tenantPool };

    const summary = await importProductsFromRows(req, [{
      name: 'Imported Milk 1L',
      company: 'Dairy Co',
      category: 'Dairy',
      barcode: '8901234567001',
      stock_quantity: 12,
      purchase_price: 45,
      mrp: 60,
      hsn_code: '0401',
      gst_percentage: 5,
      batch_number: 'IMP-001',
      expiry_date: '2026-09-30',
      is_weight_based: 0,
      selling_price: 55,
    }]);

    expect(summary).toMatchObject({ total: 1, inserted: 1, updated: 0, skipped: 0 });
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);

    const productInsert = queries.find(({ text }) => text.startsWith('INSERT INTO products'));
    expect(productInsert).toBeTruthy();
    expect(productInsert.text).toContain('selling_price');
    expect(productInsert.text).toContain('branch_id');
    expect(productInsert.params).toEqual([
      'Imported Milk 1L',
      'Dairy Co',
      'Dairy',
      55,
      45,
      60,
      '0401',
      5,
      '8901234567001',
      12,
      '2026-09-30',
      true,
      '11111111-1111-1111-1111-111111111111',
      false,
      0,
    ]);

    const batchInsert = queries.find(({ text }) => text.startsWith('INSERT INTO batches'));
    expect(batchInsert).toBeTruthy();
    expect(batchInsert.params).toEqual([
      101,
      '11111111-1111-1111-1111-111111111111',
      'IMP-001',
      '2026-09-30',
      45,
      55,
      12,
    ]);
  });

  test('existing barcode import updates canonical selling price instead of creating a duplicate product', async () => {
    const queries = [];
    const client = {
      query: jest.fn(async (sql, params = []) => {
        const text = String(sql).replace(/\s+/g, ' ').trim();
        queries.push({ text, params });
        if (text.includes('SELECT COALESCE(is_opening_completed')) {
          return { rows: [{ is_opening_completed: true }], rowCount: 1 };
        }
        if (text.startsWith('UPDATE products p')) {
          return { rows: [{ id: 202 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: jest.fn(),
    };
    const tenantPool = {
      query: jest.fn(async () => ({ rows: [{ barcode: '8901234567002' }], rowCount: 1 })),
      connect: jest.fn(async () => client),
    };

    const summary = await importProductsFromRows({ tenantPool }, [{
      name: 'Imported Rice 1kg',
      barcode: '8901234567002',
      purchase_price: 70,
      selling_price: 95,
      stock_quantity: 0,
    }]);

    expect(summary).toMatchObject({ total: 1, inserted: 0, updated: 1, skipped: 0 });
    const update = queries.find(({ text }) => text.startsWith('UPDATE products p'));
    expect(update).toBeTruthy();
    expect(update.text).toContain('selling_price = $4');
    expect(update.text).toContain('p.branch_id = $14');
    expect(update.params[3]).toBe(95);
    expect(queries.some(({ text }) => text.startsWith('INSERT INTO products'))).toBe(false);
  });
});

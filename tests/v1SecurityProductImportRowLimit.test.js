jest.mock('../src/services/productImport.service', () => ({
  importProducts: jest.fn(async () => ({ total: 1 })),
  importProductsFromRows: jest.fn(async (_req, rows) => ({ total: rows.length })),
}));

const productImportService = require('../src/services/productImport.service');
const {
  importProducts,
  importProductsFromRows,
  MAX_PRODUCT_IMPORT_ROWS,
} = require('../src/controllers/productImport.controller');

const response = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('V1 product import row admission and error hygiene', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    productImportService.importProducts.mockImplementation(async () => ({ total: 1 }));
    productImportService.importProductsFromRows.mockImplementation(async (_req, rows) => ({ total: rows.length }));
  });

  test('rejects oversized row imports before database/service work', async () => {
    const req = {
      body: {
        rows: Array.from({ length: MAX_PRODUCT_IMPORT_ROWS + 1 }, (_, index) => ({
          name: `Product ${index + 1}`,
        })),
      },
    };
    const res = response();

    await importProductsFromRows(req, res);

    expect(productImportService.importProductsFromRows).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      code: 'PRODUCT_IMPORT_ROW_LIMIT_EXCEEDED',
    }));
  });

  test('allows the documented maximum row count through to canonical import handling', async () => {
    const rows = Array.from({ length: MAX_PRODUCT_IMPORT_ROWS }, (_, index) => ({
      name: `Product ${index + 1}`,
    }));
    const req = { body: { rows } };
    const res = response();

    await importProductsFromRows(req, res);

    expect(productImportService.importProductsFromRows).toHaveBeenCalledTimes(1);
    expect(productImportService.importProductsFromRows).toHaveBeenCalledWith(req, rows);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('redacts internal database errors from row-import responses', async () => {
    productImportService.importProductsFromRows.mockRejectedValueOnce(
      Object.assign(new Error('postgres connection failed password=secret'), { code: 'XX000' })
    );
    const req = { body: { rows: [{ name: 'Milk' }] } };
    const res = response();

    await importProductsFromRows(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Internal Server Error',
      code: 'INTERNAL_ERROR',
    });
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('password=secret');
  });

  test('redacts internal parser/database errors from uploaded-file responses', async () => {
    productImportService.importProducts.mockRejectedValueOnce(
      Object.assign(new Error('internal parser path /srv/private/import.xlsx'), { code: 'EIO' })
    );
    const req = {
      file: {
        originalname: 'products.csv',
        mimetype: 'text/csv',
        buffer: Buffer.from('name,price\nMilk,50\n'),
      },
    };
    const res = response();

    await importProducts(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Internal Server Error',
      code: 'INTERNAL_ERROR',
    });
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('/srv/private');
  });
});

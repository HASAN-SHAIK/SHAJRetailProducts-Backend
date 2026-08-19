const { validateProductImportFile } = require('../src/security/productImportUploadPolicy');

const file = (name, mimetype, bytes) => ({
  originalname: name,
  mimetype,
  buffer: Buffer.from(bytes),
});

describe('V1 product import upload content policy', () => {
  test('accepts supported formats only when their bytes match the declared format', () => {
    expect(validateProductImportFile(file(
      'products.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]
    )).extension).toBe('.xlsx');

    expect(validateProductImportFile(file(
      'products.xls',
      'application/vnd.ms-excel',
      [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]
    )).extension).toBe('.xls');

    expect(validateProductImportFile(file(
      'products.pdf',
      'application/pdf',
      Buffer.from('%PDF-1.7\n')
    )).extension).toBe('.pdf');

    expect(validateProductImportFile(file(
      'products.csv',
      'text/csv',
      Buffer.from('name,price\nMilk,50\n')
    )).extension).toBe('.csv');
  });

  test('rejects spoofed extensions, binary CSV and unsupported content', () => {
    const invalid = [
      file('products.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', Buffer.from('not a zip')),
      file('products.pdf', 'application/pdf', Buffer.from('not a pdf')),
      file('products.csv', 'text/csv', [0x00, 0x01, 0x02, 0x03]),
      file('products.exe', 'application/octet-stream', Buffer.from('MZ')),
    ];

    for (const candidate of invalid) {
      try {
        validateProductImportFile(candidate);
        throw new Error('expected product import admission to fail');
      } catch (error) {
        expect(error.status).toBe(415);
        expect(error.code).toBe('UNSUPPORTED_PRODUCT_IMPORT_CONTENT');
      }
    }
  });

  test('rejects MIME and extension disagreement before parser work', () => {
    expect(() => validateProductImportFile(file(
      'products.xlsx',
      'application/pdf',
      [0x50, 0x4b, 0x03, 0x04, 0x14]
    ))).toThrow('Product import content does not match its declared format');
  });
});

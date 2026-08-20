const {
  isSupportedInvoiceUpload,
  hasSupportedInvoiceSignature,
  assertSupportedInvoiceContent,
  invoiceUploadFileFilter,
} = require('../src/security/invoiceUploadPolicy');

describe('V1 purchase-invoice upload boundary', () => {
  test.each([
    ['application/pdf', 'invoice.pdf'],
    ['image/png', 'invoice.png'],
    ['image/jpeg', 'invoice.jpg'],
    ['image/jpeg', 'invoice.jpeg'],
  ])('accepts supported MIME and extension pairs: %s %s', (mimetype, originalname) => {
    expect(isSupportedInvoiceUpload({ mimetype, originalname })).toBe(true);
  });

  test.each([
    ['application/pdf', 'invoice.exe'],
    ['image/png', 'invoice.pdf'],
    ['application/octet-stream', 'invoice.pdf'],
    ['text/html', 'invoice.jpg'],
    ['', 'invoice.pdf'],
  ])('rejects mismatched or unsupported upload identity: %s %s', (mimetype, originalname) => {
    expect(isSupportedInvoiceUpload({ mimetype, originalname })).toBe(false);
  });

  test.each([
    ['application/pdf', Buffer.from('%PDF-1.7\ninvoice')],
    ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01])],
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])],
  ])('accepts supported file signatures: %s', (mimetype, buffer) => {
    expect(hasSupportedInvoiceSignature({ mimetype, buffer })).toBe(true);
    expect(() => assertSupportedInvoiceContent({ mimetype, buffer })).not.toThrow();
  });

  test.each([
    ['application/pdf', Buffer.from('<html>not a pdf</html>')],
    ['image/png', Buffer.from('%PDF-1.7\nspoofed')],
    ['image/jpeg', Buffer.from([0x89, 0x50, 0x4e, 0x47])],
    ['application/pdf', Buffer.alloc(0)],
  ])('rejects content that does not match the declared type before parser work: %s', (mimetype, buffer) => {
    expect(hasSupportedInvoiceSignature({ mimetype, buffer })).toBe(false);
    expect(() => assertSupportedInvoiceContent({ mimetype, buffer })).toThrow(
      expect.objectContaining({
        status: 415,
        code: 'UNSUPPORTED_INVOICE_CONTENT',
      })
    );
  });

  test('file filter returns a stable 415 error before parser work', () => {
    const callback = jest.fn();
    invoiceUploadFileFilter(null, {
      mimetype: 'application/pdf',
      originalname: 'invoice.jpg',
    }, callback);

    expect(callback).toHaveBeenCalledTimes(1);
    const error = callback.mock.calls[0][0];
    expect(error).toMatchObject({
      status: 415,
      code: 'UNSUPPORTED_INVOICE_FILE_TYPE',
    });
  });
});

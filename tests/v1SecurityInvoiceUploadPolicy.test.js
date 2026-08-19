const {
  isSupportedInvoiceUpload,
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

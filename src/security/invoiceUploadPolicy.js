const MIME_EXTENSIONS = Object.freeze({
  'application/pdf': new Set(['.pdf']),
  'image/png': new Set(['.png']),
  'image/jpeg': new Set(['.jpg', '.jpeg']),
  'image/jpg': new Set(['.jpg', '.jpeg']),
});

const FILE_SIGNATURES = Object.freeze({
  'application/pdf': [Buffer.from('%PDF-', 'ascii')],
  'image/png': [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  'image/jpeg': [Buffer.from([0xff, 0xd8, 0xff])],
  'image/jpg': [Buffer.from([0xff, 0xd8, 0xff])],
});

const getExtension = (filename) => {
  const normalized = String(filename || '').trim().toLowerCase();
  const dot = normalized.lastIndexOf('.');
  return dot >= 0 ? normalized.slice(dot) : '';
};

const isSupportedInvoiceUpload = (file) => {
  const mime = String(file?.mimetype || '').trim().toLowerCase();
  const allowedExtensions = MIME_EXTENSIONS[mime];
  if (!allowedExtensions) return false;
  return allowedExtensions.has(getExtension(file?.originalname));
};

const hasSupportedInvoiceSignature = (file) => {
  const mime = String(file?.mimetype || '').trim().toLowerCase();
  const signatures = FILE_SIGNATURES[mime];
  const buffer = file?.buffer;
  if (!signatures || !Buffer.isBuffer(buffer) || buffer.length === 0) return false;
  return signatures.some((signature) =>
    buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature)
  );
};

const assertSupportedInvoiceContent = (file) => {
  if (hasSupportedInvoiceSignature(file)) return;
  const error = new Error('Uploaded invoice content does not match its declared file type.');
  error.status = 415;
  error.code = 'UNSUPPORTED_INVOICE_CONTENT';
  throw error;
};

const invoiceUploadFileFilter = (_req, file, callback) => {
  if (isSupportedInvoiceUpload(file)) {
    callback(null, true);
    return;
  }

  const error = new Error('Unsupported invoice file type. Upload PDF, PNG, JPG, or JPEG only.');
  error.status = 415;
  error.code = 'UNSUPPORTED_INVOICE_FILE_TYPE';
  callback(error);
};

module.exports = {
  isSupportedInvoiceUpload,
  hasSupportedInvoiceSignature,
  assertSupportedInvoiceContent,
  invoiceUploadFileFilter,
};

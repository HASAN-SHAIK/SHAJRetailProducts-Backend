const MIME_EXTENSIONS = Object.freeze({
  'application/pdf': new Set(['.pdf']),
  'image/png': new Set(['.png']),
  'image/jpeg': new Set(['.jpg', '.jpeg']),
  'image/jpg': new Set(['.jpg', '.jpeg']),
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
  invoiceUploadFileFilter,
};

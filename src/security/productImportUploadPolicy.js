const path = require('path');

const MIME_BY_EXTENSION = {
  '.xlsx': new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
    'application/octet-stream',
  ]),
  '.xls': new Set([
    'application/vnd.ms-excel',
    'application/octet-stream',
  ]),
  '.csv': new Set([
    'text/csv',
    'text/plain',
    'application/csv',
    'application/vnd.ms-excel',
    'application/octet-stream',
  ]),
  '.pdf': new Set([
    'application/pdf',
    'application/octet-stream',
  ]),
};

const startsWith = (buffer, bytes) => (
  Buffer.isBuffer(buffer) &&
  buffer.length >= bytes.length &&
  bytes.every((value, index) => buffer[index] === value)
);

const looksLikeTextCsv = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  // CSV has no reliable magic number. Reject binary/NUL-heavy payloads and
  // require a delimiter/newline signal before handing the bytes to XLSX.
  if (sample.includes(0x00)) return false;
  const text = sample.toString('utf8');
  return /[,;\t]/.test(text) && /\r?\n/.test(text);
};

const contentMatchesExtension = (extension, buffer) => {
  switch (extension) {
    case '.xlsx':
      return startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) ||
        startsWith(buffer, [0x50, 0x4b, 0x05, 0x06]) ||
        startsWith(buffer, [0x50, 0x4b, 0x07, 0x08]);
    case '.xls':
      return startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case '.pdf':
      return startsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case '.csv':
      return looksLikeTextCsv(buffer);
    default:
      return false;
  }
};

const validateProductImportFile = (file) => {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    const error = new Error('Unsupported or empty product import content');
    error.status = 415;
    error.code = 'UNSUPPORTED_PRODUCT_IMPORT_CONTENT';
    throw error;
  }

  const extension = path.extname(String(file.originalname || '')).toLowerCase();
  const allowedMimes = MIME_BY_EXTENSION[extension];
  if (!allowedMimes) {
    const error = new Error('Unsupported product import format');
    error.status = 415;
    error.code = 'UNSUPPORTED_PRODUCT_IMPORT_CONTENT';
    throw error;
  }

  const mime = String(file.mimetype || 'application/octet-stream').toLowerCase();
  if (!allowedMimes.has(mime) || !contentMatchesExtension(extension, file.buffer)) {
    const error = new Error('Product import content does not match its declared format');
    error.status = 415;
    error.code = 'UNSUPPORTED_PRODUCT_IMPORT_CONTENT';
    throw error;
  }

  return { extension, mime };
};

module.exports = {
  validateProductImportFile,
};

const sendSuccess = (res, data, meta = null, statusCode = 200) => {
  const payload = { success: true, data };
  if (meta) payload.meta = meta;
  return res.status(statusCode).json(payload);
};

const sendCreated = (res, data, meta = null) => sendSuccess(res, data, meta, 201);

const sendNoContent = (res) => res.status(204).send();

const sendError = (res, statusCode, code, message, details = null) => {
  const payload = {
    success: false,
    error: { code, message },
  };
  if (details) payload.error.details = details;
  return res.status(statusCode).json(payload);
};

const buildPaginationMeta = ({ page, limit, total }) => ({
  page,
  limit,
  total,
  total_pages: limit > 0 ? Math.ceil(total / limit) : 0,
});

module.exports = {
  sendSuccess,
  sendCreated,
  sendNoContent,
  sendError,
  buildPaginationMeta,
};

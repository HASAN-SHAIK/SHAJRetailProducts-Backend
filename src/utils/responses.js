const jsonError = (res, status, code, message, details) => {
  const payload = { success: false, code, message };
  if (details) payload.details = details;
  return res.status(status).json(payload);
};

const jsonOk = (res, data, message, meta) => {
  const payload = { success: true, data };
  if (message) payload.message = message;
  if (meta) payload.meta = meta;
  return res.status(200).json(payload);
};

module.exports = {
  jsonError,
  jsonOk
};

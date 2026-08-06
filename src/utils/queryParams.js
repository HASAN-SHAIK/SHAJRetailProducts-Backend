const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
};

const parsePagination = (req, { defaultPage = 1, defaultLimit = 20, maxLimit = 200 } = {}) => {
  const page = parsePositiveInt(req.query?.page, defaultPage);
  const limit = Math.min(parsePositiveInt(req.query?.limit, defaultLimit), maxLimit);
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

const buildPaginationMeta = ({ page, limit, total }) => ({
  page,
  limit,
  total,
  total_pages: limit > 0 ? Math.ceil(Number(total || 0) / limit) : 0,
});

const pickQueryValue = (query = {}, keys = []) => {
  for (const key of keys) {
    const value = query[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return undefined;
};

module.exports = {
  parsePositiveInt,
  parsePagination,
  buildPaginationMeta,
  pickQueryValue,
};

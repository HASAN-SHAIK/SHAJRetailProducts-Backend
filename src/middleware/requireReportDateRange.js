const { jsonError } = require('../utils/responses');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_REPORT_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

const parseUtcDate = (value) => {
  if (!DATE_RE.test(String(value || ''))) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
};

const requireReportDateRange = (req, res, next) => {
  const query = req.query || {};
  const hasFrom = query.from_date !== undefined && query.from_date !== null && query.from_date !== '';
  const hasTo = query.to_date !== undefined && query.to_date !== null && query.to_date !== '';

  // Existing V1 default remains the previous calendar month when neither bound is supplied.
  if (!hasFrom && !hasTo) return next();

  if (!hasFrom || !hasTo) {
    return jsonError(
      res,
      400,
      'REPORT_DATE_RANGE_REQUIRED',
      'from_date and to_date must be supplied together as YYYY-MM-DD.'
    );
  }

  const from = parseUtcDate(query.from_date);
  const to = parseUtcDate(query.to_date);
  if (!from || !to) {
    return jsonError(
      res,
      400,
      'REPORT_DATE_RANGE_INVALID',
      'Report dates must be valid YYYY-MM-DD values.'
    );
  }

  if (to < from) {
    return jsonError(
      res,
      400,
      'REPORT_DATE_RANGE_INVALID',
      'to_date must be on or after from_date.'
    );
  }

  const rangeDays = Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1;
  if (rangeDays > MAX_REPORT_RANGE_DAYS) {
    return jsonError(
      res,
      400,
      'REPORT_DATE_RANGE_TOO_LARGE',
      `Report date range cannot exceed ${MAX_REPORT_RANGE_DAYS} days.`
    );
  }

  const endOfDay = new Date(to.getTime() + DAY_MS - 1);
  req.query = { ...query, from_date: from, to_date: endOfDay };
  req.reportDateRange = { from, to, rangeDays };
  return next();
};

module.exports = {
  MAX_REPORT_RANGE_DAYS,
  parseUtcDate,
  requireReportDateRange,
};

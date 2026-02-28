const toUtcStartOfDay = (date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0));

const toUtcEndOfDay = (date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));

const getDateRange = (range, startDateRaw, endDateRaw) => {
  const now = new Date();
  const normalized = (range || 'today').toLowerCase();

  const buildCustom = () => {
    if (!startDateRaw || !endDateRaw) {
      throw new Error('INVALID_DATE_RANGE');
    }
    const startDate = new Date(startDateRaw);
    const endDate = new Date(endDateRaw);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new Error('INVALID_DATE_RANGE');
    }
    const start = toUtcStartOfDay(startDate);
    const end = toUtcEndOfDay(endDate);
    if (start > end) {
      throw new Error('INVALID_DATE_RANGE');
    }
    return { start, end, range: 'custom' };
  };

  switch (normalized) {
    case 'today': {
      const start = toUtcStartOfDay(now);
      const end = toUtcEndOfDay(now);
      return { start, end, range: 'today' };
    }
    case 'this_week': {
      const todayStart = toUtcStartOfDay(now);
      const day = now.getUTCDay() || 7;
      const monday = new Date(todayStart);
      monday.setUTCDate(todayStart.getUTCDate() - (day - 1));
      return { start: toUtcStartOfDay(monday), end: toUtcEndOfDay(now), range: 'this_week' };
    }
    case 'this_month': {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
      return { start, end: toUtcEndOfDay(now), range: 'this_month' };
    }
    case 'last_month': {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
      return { start, end, range: 'last_month' };
    }
    case 'last_30_days': {
      const start = toUtcStartOfDay(now);
      start.setUTCDate(start.getUTCDate() - 30);
      return { start, end: toUtcEndOfDay(now), range: 'last_30_days' };
    }
    case 'custom':
      return buildCustom();
    default:
      throw new Error('INVALID_DATE_RANGE');
  }
};

module.exports = { getDateRange };

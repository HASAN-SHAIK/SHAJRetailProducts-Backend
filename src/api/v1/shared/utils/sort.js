const parseSort = (query = {}, allowed = {}, fallback = { column: 'created_at', order: 'DESC' }) => {
  const sortKey = String(query.sort_by || query.sortBy || fallback.column).toLowerCase();
  const sortOrderRaw = String(query.sort_order || query.sortOrder || fallback.order).toLowerCase();
  const order = sortOrderRaw === 'asc' ? 'ASC' : 'DESC';
  const column = allowed[sortKey] || fallback.column;
  return { column, order };
};

module.exports = { parseSort };

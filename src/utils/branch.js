const isUuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const normalizeBranchId = (raw) => {
  const text = String(raw || '').trim();
  if (!text || text.toLowerCase() === 'all') return null;
  return isUuid(text) ? text : null;
};

const resolveBranchIdFromRequest = (req) =>
  normalizeBranchId(req?.headers?.['x-branch-id'] || req?.query?.branch_id || req?.body?.branch_id);

module.exports = { isUuid, normalizeBranchId, resolveBranchIdFromRequest };

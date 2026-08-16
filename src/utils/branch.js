const isUuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const normalizeBranchId = (raw) => {
  const text = String(raw || '').trim();
  if (!text || text.toLowerCase() === 'all') return null;
  return isUuid(text) ? text : null;
};

const resolveBranchIdFromRequest = (req) => {
  const requestedBranchId = normalizeBranchId(
    req?.headers?.['x-branch-id'] || req?.query?.branch_id || req?.body?.branch_id
  );
  const user = req?.user || {};
  const userAllBranchAccess =
    user?.all_branch_access === undefined || user?.all_branch_access === null
      ? true
      : user?.all_branch_access === true ||
        user?.all_branch_access === 1 ||
        String(user?.all_branch_access).toLowerCase() === 'true';
  const userBranchId = normalizeBranchId(user?.branch_id);

  // Any tenant user explicitly restricted to one branch is pinned to that
  // authoritative assignment regardless of role. This covers cashier/manager
  // as well as the transitional staff role and prevents caller-selected branch
  // headers/query/body values from widening Central access.
  if (!userAllBranchAccess && userBranchId) {
    return userBranchId;
  }

  return requestedBranchId;
};

module.exports = { isUuid, normalizeBranchId, resolveBranchIdFromRequest };

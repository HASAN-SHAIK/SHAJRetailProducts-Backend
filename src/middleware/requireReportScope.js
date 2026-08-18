const { jsonError } = require('../utils/responses');
const { resolveBranchIdFromRequest } = require('../utils/branch');

const requireReportScope = (req, res, next) => {
  const user = req.user;
  if (!user || user.type !== 'tenant') {
    return jsonError(res, 401, 'UNAUTHORIZED', 'Unauthorized');
  }

  const reportBranchId = resolveBranchIdFromRequest(req);
  const hasAllBranchAccess = user.all_branch_access === true;
  const isBranchRestricted = !hasAllBranchAccess;

  if (isBranchRestricted && !reportBranchId) {
    return jsonError(
      res,
      403,
      'REPORT_BRANCH_SCOPE_REQUIRED',
      'This reporting user does not have a trusted Central branch assignment.'
    );
  }

  // Product stock is still represented by the legacy tenant-level products stock
  // projection in this report. Do not pretend that projection is safely branch
  // scoped until the report moves to the certified branch inventory truth.
  if (reportBranchId && req.path === '/inventory') {
    return jsonError(
      res,
      403,
      'REPORT_INVENTORY_BRANCH_SCOPE_REQUIRED',
      'Branch-scoped inventory reporting is not yet available.'
    );
  }

  req.reportBranchId = reportBranchId;
  return next();
};

module.exports = { requireReportScope };

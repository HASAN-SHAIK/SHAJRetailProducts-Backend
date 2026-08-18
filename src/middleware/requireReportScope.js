const { jsonError } = require('../utils/responses');

const requireReportScope = (req, res, next) => {
  const user = req.user;
  if (!user || user.type !== 'tenant') {
    return jsonError(res, 401, 'UNAUTHORIZED', 'Unauthorized');
  }

  // V1 report queries are not yet uniformly branch-scoped. Until the query layer
  // applies the trusted Central branch resolver to every report, fail closed for
  // branch-restricted users instead of exposing tenant-wide aggregates.
  if (user.all_branch_access !== true) {
    return jsonError(
      res,
      403,
      'REPORT_BRANCH_SCOPE_REQUIRED',
      'Branch-scoped reporting is not yet available for this user.'
    );
  }

  return next();
};

module.exports = { requireReportScope };

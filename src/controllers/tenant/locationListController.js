const { jsonError, jsonOk } = require('../../utils/responses');

const getLocationsList = async (req, res) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) {
      return jsonError(res, 401, 'UNAUTHORIZED', 'Missing tenant_id');
    }

    const result = await req.tenantPool.query(
      `SELECT DISTINCT location
       FROM orders
       WHERE location IS NOT NULL AND TRIM(location) <> ''
       ORDER BY location ASC`
    );

    const locations = result.rows.map((row) => row.location);
    return jsonOk(res, { locations, data: locations });
  } catch (error) {
    return jsonError(res, 500, 'LOCATIONS_LIST_FAILED', 'Failed to load locations');
  }
};

module.exports = { getLocationsList };

const { jsonError, jsonOk } = require('../../utils/responses');

const updateUserRole = async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!userId) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'Invalid user id');
    }

    const { role } = req.body || {};
    if (!role) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'role is required');
    }

    const normalizedRole = role.toString().trim().toLowerCase();
    if (!['admin', 'staff'].includes(normalizedRole)) {
      return jsonError(res, 400, 'VALIDATION_ERROR', 'role must be admin or staff');
    }

    const result = await req.tenantPool.query(
      `UPDATE users
       SET role = $1
       WHERE id = $2
       RETURNING id, name, email, role, created_at`,
      [normalizedRole, userId]
    );

    if (result.rowCount === 0) {
      return jsonError(res, 404, 'USER_NOT_FOUND', 'User not found');
    }

    return jsonOk(res, { user: result.rows[0] }, 'User role updated');
  } catch (error) {
    return jsonError(res, 500, 'USER_ROLE_UPDATE_FAILED', error.message);
  }
};

module.exports = { updateUserRole };

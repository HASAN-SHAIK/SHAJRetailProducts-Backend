const staffService = require('../../../../services/staffService');
const { AppError } = require('../../shared/errors/AppError');

class StaffRepository {
  constructor(req) {
    this.req = req;
  }

  list(query) {
    return staffService.getStaff(this.req, query);
  }

  async findById(id) {
    const rows = await staffService.getStaff(this.req, {});
    const row = rows.find((entry) => String(entry.staffId) === String(id));
    if (!row) throw AppError.notFound('Staff not found');
    return row;
  }

  create(body) {
    return staffService.addStaff(this.req, body);
  }

  update(id, body) {
    return staffService.updateStaff(this.req, id, body);
  }

  remove(id) {
    return staffService.deleteStaff(this.req, id);
  }
}

module.exports = { StaffRepository };

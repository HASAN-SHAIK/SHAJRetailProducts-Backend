const { StaffRepository } = require('./staff.repository');

class StaffService {
  constructor(req) {
    this.repo = new StaffRepository(req);
  }

  list(query) {
    return this.repo.list(query);
  }

  getById(id) {
    return this.repo.findById(id);
  }

  create(body) {
    return this.repo.create(body);
  }

  update(id, body) {
    return this.repo.update(id, body);
  }

  remove(id) {
    return this.repo.remove(id);
  }
}

const createStaffService = (req) => new StaffService(req);

module.exports = { StaffService, createStaffService };

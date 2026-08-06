const { ExpenseRepository } = require('./expense.repository');

class ExpenseService {
  constructor(req) {
    this.repo = new ExpenseRepository(req);
  }

  list(query) {
    return this.repo.list(query);
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

const createExpenseService = (req) => new ExpenseService(req);

module.exports = { ExpenseService, createExpenseService };

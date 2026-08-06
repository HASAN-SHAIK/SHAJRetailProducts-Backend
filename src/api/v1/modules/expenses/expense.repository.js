const expenseService = require('../../../../services/expenseService');
const { AppError } = require('../../shared/errors/AppError');

class ExpenseRepository {
  constructor(req) {
    this.req = req;
    this.pool = req.tenantPool;
  }

  async list(query) {
    return expenseService.getExpenses(this.req, query);
  }

  async create(body) {
    return expenseService.addExpense(this.req, body);
  }

  async update(id, body) {
    return expenseService.addExpense(this.req, { ...body, expenseId: id });
  }

  async remove(id) {
    const res = await this.pool.query('DELETE FROM expenses WHERE id = $1 RETURNING id', [id]);
    if (res.rowCount === 0) throw AppError.notFound('Expense not found');
    return { id };
  }
}

module.exports = { ExpenseRepository };

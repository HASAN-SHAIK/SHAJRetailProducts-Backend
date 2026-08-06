const { asyncHandler } = require('../../shared/errors/asyncHandler');
const { sendSuccess, sendCreated, sendNoContent } = require('../../shared/dto/apiResponse');
const { validateRequest } = require('../../shared/middleware/validateRequest');
const { requireTenantUser } = require('../../shared/middleware/authorizeRoles');
const { createExpenseService } = require('./expense.service');
const {
  listExpensesQuerySchema,
  expenseIdParamSchema,
  expenseBodySchema,
  expenseUpdateSchema,
} = require('./expense.validation');

const listExpenses = asyncHandler(async (req, res) => {
  const expenses = await createExpenseService(req).list(req.query);
  return sendSuccess(res, { expenses, total: expenses.length });
});

const createExpense = asyncHandler(async (req, res) => {
  const expense = await createExpenseService(req).create(req.body);
  return sendCreated(res, { expense });
});

const updateExpense = asyncHandler(async (req, res) => {
  const expense = await createExpenseService(req).update(req.params.id, req.body);
  return sendSuccess(res, { expense });
});

const deleteExpense = asyncHandler(async (req, res) => {
  await createExpenseService(req).remove(req.params.id);
  return sendNoContent(res);
});

module.exports = {
  listExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  validateListExpenses: validateRequest(listExpensesQuerySchema, 'query'),
  validateExpenseId: validateRequest(expenseIdParamSchema, 'params'),
  validateCreateExpense: validateRequest(expenseBodySchema, 'body'),
  validateUpdateExpense: validateRequest(expenseUpdateSchema, 'body'),
  requireTenantUser,
};

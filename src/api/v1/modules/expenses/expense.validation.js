const Joi = require('joi');

const listExpensesQuerySchema = Joi.object({
  type: Joi.string().valid('staff', 'shop').allow(''),
  category: Joi.string().trim().allow(''),
  staff_id: Joi.string().allow(''),
  from: Joi.date().iso().allow(''),
  to: Joi.date().iso().allow(''),
  branch_id: Joi.string().uuid().allow(''),
});

const expenseIdParamSchema = Joi.object({
  id: Joi.string().required(),
});

const expenseBodySchema = Joi.object({
  expenseId: Joi.string().allow(null),
  type: Joi.string().valid('staff', 'shop').required(),
  category: Joi.string().trim().min(1).required(),
  amount: Joi.number().positive().required(),
  staffId: Joi.string().when('type', { is: 'staff', then: Joi.required(), otherwise: Joi.allow(null) }),
  paymentMethod: Joi.string().allow('', null),
  notes: Joi.string().allow('', null),
  date: Joi.date().iso().allow(null),
  branch_id: Joi.string().uuid().allow(null),
});

const expenseUpdateSchema = expenseBodySchema.fork(['type', 'category', 'amount'], (s) => s.optional());

module.exports = {
  listExpensesQuerySchema,
  expenseIdParamSchema,
  expenseBodySchema,
  expenseUpdateSchema,
};

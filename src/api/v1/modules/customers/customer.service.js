const { AppError } = require('../../shared/errors/AppError');
const { parsePagination } = require('../../shared/utils/pagination');
const { parseSort } = require('../../shared/utils/sort');
const { CustomerRepository } = require('./customer.repository');
const { toCustomerDto, toCustomerDetailDto } = require('./customer.dto');

const SORTABLE = {
  name: 'name',
  created_at: 'created_at',
  current_balance: 'current_balance',
};

class CustomerService {
  constructor(req) {
    this.repo = new CustomerRepository(req.tenantPool);
  }

  async list(query) {
    const { page, limit, offset } = parsePagination(query, { defaultLimit: 50, maxLimit: 500 });
    const { column, order } = parseSort(query, SORTABLE, { column: 'name', order: 'ASC' });
    const { rows, total } = await this.repo.findMany({
      search: query.search,
      offset,
      limit,
      sortColumn: column,
      sortOrder: order,
    });
    return { items: rows.map(toCustomerDto), page, limit, total };
  }

  async getById(id) {
    const detail = await this.repo.findById(id);
    if (!detail) throw AppError.notFound('Customer not found');
    return toCustomerDetailDto(detail);
  }

  async create(body) {
    const row = await this.repo.create(body);
    return toCustomerDto(row);
  }

  async update(id, body) {
    const row = await this.repo.update(id, body);
    if (!row) throw AppError.notFound('Customer not found');
    return toCustomerDto(row);
  }

  async remove(id) {
    const deleted = await this.repo.deactivate(id);
    if (!deleted) throw AppError.notFound('Customer not found');
    return { id };
  }
}

const createCustomerService = (req) => new CustomerService(req);

module.exports = { CustomerService, createCustomerService };

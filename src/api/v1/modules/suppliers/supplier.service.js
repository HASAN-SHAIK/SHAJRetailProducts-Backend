const { AppError } = require('../../shared/errors/AppError');
const { parsePagination } = require('../../shared/utils/pagination');
const { parseSort } = require('../../shared/utils/sort');
const { createSupplierRepository } = require('./supplier.repository');
const { toSupplierDto } = require('./supplier.dto');
const { resolveBranchIdFromRequest } = require('../../../../utils/branch');

const SORTABLE = { name: 'name', created_at: 'created_at', current_balance: 'current_balance' };

class SupplierService {
  constructor(req) {
    this.req = req;
    this.repo = createSupplierRepository(req);
  }

  async list(query) {
    const { page, limit, offset } = parsePagination(query, { defaultLimit: 50, maxLimit: 200 });
    const { column, order } = parseSort(query, SORTABLE, { column: 'name', order: 'ASC' });
    const { rows, total } = await this.repo.findMany({ search: query.search, offset, limit, sortColumn: column, sortOrder: order });
    return { items: rows.map(toSupplierDto), page, limit, total };
  }

  async getById(id) {
    const row = await this.repo.findById(id);
    if (!row) throw AppError.notFound('Supplier not found');
    return toSupplierDto(row);
  }

  async create(body) {
    const row = await this.repo.create({
      ...body,
      branch_id: body.branch_id || resolveBranchIdFromRequest(this.req),
    });
    return toSupplierDto(row);
  }

  async update(id, body) {
    const row = await this.repo.update(id, body);
    if (!row) throw AppError.notFound('Supplier not found');
    return toSupplierDto(row);
  }

  async remove(id) {
    const deleted = await this.repo.softDelete(id);
    if (!deleted) throw AppError.notFound('Supplier not found');
    return { id };
  }
}

const createSupplierService = (req) => new SupplierService(req);

module.exports = { SupplierService, createSupplierService };

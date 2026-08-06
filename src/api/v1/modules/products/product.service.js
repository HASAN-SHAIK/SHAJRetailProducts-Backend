const { AppError } = require('../../shared/errors/AppError');
const { parsePagination } = require('../../shared/utils/pagination');
const { parseSort } = require('../../shared/utils/sort');
const { createProductRepository, resolveBranch } = require('./product.repository');
const { toProductDto } = require('./product.dto');

const SORTABLE = {
  name: 'name',
  selling_price: 'selling_price',
  stock_quantity: 'stock_quantity',
  created_at: 'created_at',
};

class ProductService {
  constructor(req) {
    this.req = req;
    this.repo = createProductRepository(req);
    this.branchId = resolveBranch(req);
  }

  async list(query) {
    const { page, limit, offset } = parsePagination(query);
    const { column, order } = parseSort(query, SORTABLE);
    const { rows, total } = await this.repo.findMany({
      branchId: this.branchId,
      search: query.search || '',
      category: query.category || '',
      offset,
      limit,
      sortColumn: column,
      sortOrder: order,
    });
    return {
      items: rows.map(toProductDto),
      page,
      limit,
      total,
    };
  }

  async getById(id) {
    const row = await this.repo.findById(id);
    if (!row) throw AppError.notFound('Product not found');
    return toProductDto(row);
  }

  async getByBarcode(barcode) {
    const row = await this.repo.findByBarcode(barcode, this.branchId);
    if (!row) throw AppError.notFound('Product not found for barcode');
    return toProductDto(row);
  }

  async create(body) {
    if (!body.name) throw AppError.badRequest('Product name is required');
    const row = await this.repo.create({ ...body, branch_id: body.branch_id || this.branchId });
    return toProductDto(row);
  }

  async update(id, body) {
    const row = await this.repo.update(id, body);
    if (!row) throw AppError.notFound('Product not found');
    return toProductDto(row);
  }

  async remove(id) {
    const deleted = await this.repo.softDelete(id);
    if (!deleted) throw AppError.notFound('Product not found');
    return { id };
  }
}

const createProductService = (req) => new ProductService(req);

module.exports = { ProductService, createProductService };

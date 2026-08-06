const { AppError } = require('../../shared/errors/AppError');
const { SaleRepository } = require('./sale.repository');

class SaleService {
  constructor(req) {
    this.repo = new SaleRepository(req);
  }

  async list(query) {
    return this.repo.findManyPaginated(query);
  }

  async getById(id) {
    const detail = await this.repo.findById(id);
    if (!detail) throw AppError.notFound('Sale not found');
    return detail;
  }

  async create(body) {
    try {
      return await this.repo.create(body);
    } catch (error) {
      throw new AppError(error.message, error.status || 500, 'SALE_CREATE_FAILED');
    }
  }

  async update(id, body) {
    try {
      return await this.repo.update(id, body);
    } catch (error) {
      throw new AppError(error.message, error.status || 500, 'SALE_UPDATE_FAILED');
    }
  }

  async remove(id) {
    try {
      return await this.repo.remove(id);
    } catch (error) {
      throw new AppError(error.message, error.status || 500, 'SALE_DELETE_FAILED');
    }
  }
}

const createSaleService = (req) => new SaleService(req);

module.exports = { SaleService, createSaleService };

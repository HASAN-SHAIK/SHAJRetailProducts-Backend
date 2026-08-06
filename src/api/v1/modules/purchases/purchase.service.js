const { AppError } = require('../../shared/errors/AppError');
const { PurchaseRepository } = require('./purchase.repository');

class PurchaseService {
  constructor(req) {
    this.repo = new PurchaseRepository(req);
  }

  async list(query) {
    return this.repo.findManyPaginated(query);
  }

  async getById(id) {
    const detail = await this.repo.getById(id);
    if (!detail) throw AppError.notFound('Purchase not found');
    return detail;
  }

  async create(body) {
    try {
      return await this.repo.create(body);
    } catch (error) {
      throw new AppError(error.message, error.status || 500, 'PURCHASE_CREATE_FAILED');
    }
  }
}

const createPurchaseService = (req) => new PurchaseService(req);

module.exports = { PurchaseService, createPurchaseService };

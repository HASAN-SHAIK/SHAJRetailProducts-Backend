const legacyPurchaseReturnService = require('../../../../services/purchaseReturnService');
const { AppError } = require('../../shared/errors/AppError');

class PurchaseReturnService {
  constructor(req) {
    this.req = req;
  }

  async list(query) {
    return legacyPurchaseReturnService.listPurchaseReturns(this.req, query);
  }

  async create(body) {
    try {
      return await legacyPurchaseReturnService.createPurchaseReturn(this.req, body);
    } catch (error) {
      throw new AppError(error.message, error.status || 500, 'PURCHASE_RETURN_CREATE_FAILED');
    }
  }
}

const createPurchaseReturnService = (req) => new PurchaseReturnService(req);

module.exports = { PurchaseReturnService, createPurchaseReturnService };

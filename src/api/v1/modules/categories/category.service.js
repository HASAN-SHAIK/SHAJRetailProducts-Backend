const { AppError } = require('../../shared/errors/AppError');
const { parsePagination } = require('../../shared/utils/pagination');
const { CategoryRepository } = require('./category.repository');

class CategoryService {
  constructor(req) {
    this.repo = new CategoryRepository(req.tenantPool);
  }

  async list(query) {
    const { page, limit, offset } = parsePagination(query, { defaultLimit: 50, maxLimit: 200 });
    const { rows, total } = await this.repo.findMany({ search: query.search, offset, limit });
    return { items: rows, page, limit, total };
  }

  async getProducts(name, query) {
    const { page, limit, offset } = parsePagination(query);
    const { rows, total } = await this.repo.findProductsByCategory(name, offset, limit);
    if (total === 0) throw AppError.notFound('Category not found');
    return { category: name, products: rows, page, limit, total };
  }

  async rename(oldName, newName) {
    const updated = await this.repo.renameCategory(oldName, newName);
    if (!updated) throw AppError.notFound('Category not found');
    return { old_name: oldName, new_name: newName, updated_products: updated };
  }

  async remove(name) {
    const updated = await this.repo.deleteCategory(name);
    if (!updated) throw AppError.notFound('Category not found');
    return { name, updated_products: updated };
  }
}

const createCategoryService = (req) => new CategoryService(req);

module.exports = { CategoryService, createCategoryService };

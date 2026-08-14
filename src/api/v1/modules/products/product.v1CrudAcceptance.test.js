const mockRepo = {
  findMany: jest.fn(),
  findById: jest.fn(),
  findByBarcode: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  softDelete: jest.fn(),
};

jest.mock('./product.repository', () => ({
  createProductRepository: jest.fn(() => mockRepo),
  resolveBranch: jest.fn(() => 'branch-a'),
}));

const { ProductService } = require('./product.service');

describe('V1 Central product CRUD authority', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('lists and barcode-resolves through the request branch authority', async () => {
    mockRepo.findMany.mockResolvedValue({ rows: [], total: 0 });
    mockRepo.findByBarcode.mockResolvedValue({ id: 101, name: 'Milk', barcode: '890101', branch_id: 'branch-a' });

    const service = new ProductService({ tenantPool: {} });
    await service.list({ page: '1', limit: '25' });
    await service.getByBarcode('890101');

    expect(mockRepo.findMany).toHaveBeenCalledWith(expect.objectContaining({ branchId: 'branch-a' }));
    expect(mockRepo.findByBarcode).toHaveBeenCalledWith('890101', 'branch-a');
  });

  test('creates products in the resolved branch by default and preserves an explicit admin branch target', async () => {
    mockRepo.create
      .mockResolvedValueOnce({ id: 101, name: 'Milk', branch_id: 'branch-a' })
      .mockResolvedValueOnce({ id: 102, name: 'Rice', branch_id: 'branch-b' });

    const service = new ProductService({ tenantPool: {} });
    await service.create({ name: 'Milk', selling_price: 55 });
    await service.create({ name: 'Rice', selling_price: 100, branch_id: 'branch-b' });

    expect(mockRepo.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ name: 'Milk', branch_id: 'branch-a' }));
    expect(mockRepo.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ name: 'Rice', branch_id: 'branch-b' }));
  });

  test('updates and soft-deletes only through the canonical Central repository', async () => {
    mockRepo.update.mockResolvedValue({ id: 101, name: 'Milk 1L', branch_id: 'branch-a' });
    mockRepo.softDelete.mockResolvedValue(true);

    const service = new ProductService({ tenantPool: {} });
    const updated = await service.update('101', { name: 'Milk 1L' });
    const removed = await service.remove('101');

    expect(mockRepo.update).toHaveBeenCalledWith('101', { name: 'Milk 1L' });
    expect(updated.name).toBe('Milk 1L');
    expect(mockRepo.softDelete).toHaveBeenCalledWith('101');
    expect(removed).toEqual({ id: '101' });
  });
});

const mockRepo = {
  findMany: jest.fn(),
  findBranchInventoryFacts: jest.fn(),
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
    mockRepo.findBranchInventoryFacts.mockResolvedValue([]);
  });

  test('lists and barcode-resolves through the request branch authority', async () => {
    mockRepo.findMany.mockResolvedValue({ rows: [], total: 0 });
    mockRepo.findByBarcode.mockResolvedValue({ id: 101, name: 'Milk', barcode: '890101', branch_id: 'branch-a' });

    const service = new ProductService({ tenantPool: {} });
    await service.list({ page: '1', limit: '25' });
    await service.getByBarcode('890101');

    expect(mockRepo.findMany).toHaveBeenCalledWith(expect.objectContaining({ branchId: 'branch-a' }));
    expect(mockRepo.findByBarcode).toHaveBeenCalledWith('890101', 'branch-a');
    expect(mockRepo.findBranchInventoryFacts).toHaveBeenCalledWith({ branchId: 'branch-a', productIds: [101] });
  });

  test('attaches canonical branch inventory facts to catalog rows in one page-level lookup', async () => {
    mockRepo.findMany.mockResolvedValue({
      rows: [
        { id: 101, name: 'Milk', stock_quantity: 10, branch_id: 'branch-a', is_batch_enabled: false },
        { id: 102, name: 'Curd', stock_quantity: 99, branch_id: 'branch-a', is_batch_enabled: true },
      ],
      total: 2,
    });
    mockRepo.findBranchInventoryFacts.mockResolvedValue([
      {
        product_id: 101,
        physical_quantity: '10',
        sellable_quantity: '10',
        expired_quantity: '0',
        provisional_deficit: '2',
        projected_net_quantity: '8',
      },
      {
        product_id: 102,
        physical_quantity: '12',
        sellable_quantity: '7',
        expired_quantity: '5',
        provisional_deficit: '0',
        projected_net_quantity: '7',
      },
    ]);

    const service = new ProductService({ tenantPool: {} });
    const result = await service.list({ page: '1', limit: '25' });

    expect(mockRepo.findBranchInventoryFacts).toHaveBeenCalledTimes(1);
    expect(mockRepo.findBranchInventoryFacts).toHaveBeenCalledWith({ branchId: 'branch-a', productIds: [101, 102] });
    expect(result.items[0].inventory).toEqual(expect.objectContaining({
      branch_id: 'branch-a',
      projected_net_quantity: 8,
      provisional_deficit: 2,
      is_low_stock: true,
      is_out_of_stock: false,
    }));
    expect(result.items[1].inventory).toEqual(expect.objectContaining({
      physical_quantity: 12,
      sellable_quantity: 7,
      expired_quantity: 5,
    }));
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

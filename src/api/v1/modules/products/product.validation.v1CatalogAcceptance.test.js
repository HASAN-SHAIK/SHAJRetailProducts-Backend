const { listProductsQuerySchema } = require('./product.validation');

describe('V1 product catalog branch query validation', () => {
  test('preserves a valid branch_id so request scope reaches canonical inventory resolution', () => {
    const branchId = '11111111-1111-4111-8111-111111111111';
    const { error, value } = listProductsQuerySchema.validate({
      branch_id: branchId,
      search: 'milk',
      page: '1',
      limit: '25',
    }, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    expect(error).toBeUndefined();
    expect(value.branch_id).toBe(branchId);
    expect(value.search).toBe('milk');
    expect(value.page).toBe(1);
    expect(value.limit).toBe(25);
  });

  test('rejects malformed branch ids instead of silently widening catalog scope', () => {
    const { error } = listProductsQuerySchema.validate({ branch_id: 'not-a-branch' }, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    expect(error).toBeDefined();
    expect(error.details.some((detail) => detail.path.join('.') === 'branch_id')).toBe(true);
  });
});

const { bindCanonicalOrderBranch } = require('./posEvent.processor');

describe('V1 Reporting/Admin canonical POS branch provenance', () => {
  test('binds a canonical POS order to the trusted active-device branch', async () => {
    const query = jest.fn().mockResolvedValue({ rowCount: 1, rows: [{ branch_id: '11111111-1111-1111-1111-111111111111' }] });

    await bindCanonicalOrderBranch(
      { query },
      { central_order_id: 42 },
      { branchId: '11111111-1111-1111-1111-111111111111' }
    );

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('SET branch_id=$2');
    expect(query.mock.calls[0][0]).toContain('branch_id IS NULL OR branch_id=$2::uuid');
    expect(query.mock.calls[0][1]).toEqual([42, '11111111-1111-1111-1111-111111111111']);
  });

  test('fails closed when trusted device branch provenance is absent', async () => {
    await expect(
      bindCanonicalOrderBranch({ query: jest.fn() }, { central_order_id: 42 }, null)
    ).rejects.toMatchObject({ code: 'INVALID_SALE_COMPLETED_PAYLOAD' });
  });

  test('rejects rebinding an existing canonical sale to another branch', async () => {
    const query = jest.fn().mockResolvedValue({ rowCount: 0, rows: [] });

    await expect(
      bindCanonicalOrderBranch(
        { query },
        { central_order_id: 42 },
        { branchId: '22222222-2222-2222-2222-222222222222' }
      )
    ).rejects.toMatchObject({ code: 'INVALID_SALE_COMPLETED_PAYLOAD' });
  });
});

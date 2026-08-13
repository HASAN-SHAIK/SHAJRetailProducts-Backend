const {
  validateSettingValue,
  buildNestedConfig,
  mergeLayers,
} = require('../src/configuration/validation');

 describe('effective configuration validation', () => {
  test('coerces supported values and rejects invalid ranges', () => {
    expect(validateSettingValue('billing.allow_discount', 'true')).toBe(true);
    expect(validateSettingValue('inventory.weight_precision', '3')).toBe(3);
    expect(validateSettingValue('printer.receipt_paper_width_mm', 80)).toBe(80);
    expect(() => validateSettingValue('inventory.weight_precision', 9)).toThrow(/<= 6/);
    expect(() => validateSettingValue('unknown.value', true)).toThrow(/Unknown configuration key/);
  });

  test('builds nested runtime configuration from flat keys', () => {
    expect(buildNestedConfig({
      'billing.allow_negative_stock': false,
      'offline.sync_interval_seconds': 60,
    })).toEqual({
      billing: { allow_negative_stock: false },
      offline: { sync_interval_seconds: 60 },
    });
  });

  test('resolves later scopes over earlier scopes and records source', () => {
    const result = mergeLayers([
      {
        scopeType: 'system',
        scopeId: 'default',
        values: { 'billing.allow_discount': true, 'receipt.copies': 1 },
        revisions: { 'billing.allow_discount': 0, 'receipt.copies': 0 },
      },
      {
        scopeType: 'tenant',
        scopeId: 'tenant-1',
        values: { 'billing.allow_discount': false },
        revisions: { 'billing.allow_discount': 2 },
      },
      {
        scopeType: 'device',
        scopeId: 'pos-1',
        values: { 'billing.allow_discount': true },
        revisions: { 'billing.allow_discount': 4 },
      },
    ]);

    expect(result.values['billing.allow_discount']).toBe(true);
    expect(result.values['receipt.copies']).toBe(1);
    expect(result.sources['billing.allow_discount']).toEqual({
      scope_type: 'device',
      scope_id: 'pos-1',
      revision: 4,
    });
  });
});

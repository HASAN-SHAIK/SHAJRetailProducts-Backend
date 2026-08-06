const { OrderingGate } = require('../../src/messaging/sync/orderingGate');

describe('OrderingGate', () => {
  test('runs tasks for the same key sequentially', async () => {
    const gate = new OrderingGate();
    const events = [];

    await Promise.all([
      gate.run('tenant:sales:order:1', async () => {
        events.push('a-start');
        await new Promise((resolve) => setTimeout(resolve, 20));
        events.push('a-end');
      }),
      gate.run('tenant:sales:order:1', async () => {
        events.push('b-start');
        events.push('b-end');
      }),
    ]);

    expect(events).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  test('allows parallel execution across different keys', async () => {
    const gate = new OrderingGate();
    const events = [];

    await Promise.all([
      gate.run('key-1', async () => {
        events.push('1-start');
        await new Promise((resolve) => setTimeout(resolve, 20));
        events.push('1-end');
      }),
      gate.run('key-2', async () => {
        events.push('2-start');
        events.push('2-end');
      }),
    ]);

    expect(events.indexOf('2-end')).toBeLessThan(events.indexOf('1-end'));
  });
});

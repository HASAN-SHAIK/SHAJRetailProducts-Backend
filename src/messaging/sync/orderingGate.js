/**
 * Serializes sync processing per ordering key to preserve per-entity ordering.
 */
class OrderingGate {
  constructor() {
    this.tails = new Map();
  }

  run(orderingKey, task) {
    const key = orderingKey || '__default__';
    const previous = this.tails.get(key) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => task());
    this.tails.set(
      key,
      next.finally(() => {
        if (this.tails.get(key) === next) {
          this.tails.delete(key);
        }
      })
    );
    return next;
  }

  size() {
    return this.tails.size;
  }
}

const orderingGate = new OrderingGate();

module.exports = {
  OrderingGate,
  orderingGate,
};

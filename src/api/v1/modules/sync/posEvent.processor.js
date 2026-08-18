const { processSaleCompleted } = require('./saleCompleted.processor');
const { processSaleReturned } = require('./saleReturned.processor');
const { processSalePartialReturned } = require('./salePartialReturned.processor');
const { processPaymentRecorded } = require('./paymentRecorded.processor');
const { processInventoryMovementRecorded } = require('./inventoryMovementRecorded.processor');
const { processReceiptIssued } = require('./receiptIssued.processor');
const { processCustomerChanged } = require('./customerChanged.processor');

const bindCanonicalOrderBranch = async (client, projection, syncDevice) => {
  const centralOrderId = Number(projection?.central_order_id);
  const branchId = String(syncDevice?.branchId || '').trim();
  if (!Number.isSafeInteger(centralOrderId) || centralOrderId <= 0 || !branchId) {
    const error = new Error('trusted POS device branch is required for canonical sale projection');
    error.code = 'INVALID_SALE_COMPLETED_PAYLOAD';
    throw error;
  }

  const updated = await client.query(
    `UPDATE orders
     SET branch_id=$2
     WHERE id=$1
       AND (branch_id IS NULL OR branch_id=$2::uuid)
     RETURNING branch_id`,
    [centralOrderId, branchId]
  );
  if (updated.rowCount !== 1) {
    const error = new Error('canonical sale is already bound to a different branch');
    error.code = 'INVALID_SALE_COMPLETED_PAYLOAD';
    throw error;
  }
};

const processPosEvent = async (client, event, context = {}) => {
  switch (event.event_type) {
    case 'sale.completed': {
      if (event.schema_version !== 1) {
        const error = new Error('unsupported sale.completed schema_version');
        error.code = 'INVALID_SALE_COMPLETED_PAYLOAD';
        throw error;
      }
      const projection = await processSaleCompleted(client, event);
      await bindCanonicalOrderBranch(client, projection, context.syncDevice || null);
      return projection;
    }
    case 'sale.returned':
      return processSaleReturned(client, event);
    case 'sale.partial_returned':
      return processSalePartialReturned(client, event);
    case 'payment.recorded':
      return processPaymentRecorded(client, event);
    case 'inventory.movement.recorded':
      return processInventoryMovementRecorded(client, event, context.inventoryDevice || null);
    case 'receipt.issued':
      return processReceiptIssued(client, event);
    case 'customer.changed':
      return processCustomerChanged(client, event);
    default: {
      const error = new Error(`unsupported POS event_type: ${event.event_type}`);
      error.code = 'UNSUPPORTED_POS_EVENT';
      throw error;
    }
  }
};

module.exports = { processPosEvent, bindCanonicalOrderBranch };

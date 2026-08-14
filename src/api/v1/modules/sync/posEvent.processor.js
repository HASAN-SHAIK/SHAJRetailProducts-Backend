const { processSaleCompleted } = require('./saleCompleted.processor');
const { processSaleReturned } = require('./saleReturned.processor');
const { processSalePartialReturned } = require('./salePartialReturned.processor');
const { processPaymentRecorded } = require('./paymentRecorded.processor');
const { processInventoryMovementRecorded } = require('./inventoryMovementRecorded.processor');
const { processReceiptIssued } = require('./receiptIssued.processor');
const { processCustomerChanged } = require('./customerChanged.processor');

const processPosEvent = async (client, event, context = {}) => {
  switch (event.event_type) {
    case 'sale.completed':
      if (event.schema_version !== 1) {
        const error = new Error('unsupported sale.completed schema_version');
        error.code = 'INVALID_SALE_COMPLETED_PAYLOAD';
        throw error;
      }
      return processSaleCompleted(client, event);
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

module.exports = { processPosEvent };

const { processSaleCompleted } = require('./saleCompleted.processor');
const { processPaymentRecorded } = require('./paymentRecorded.processor');

const processPosEvent = async (client, event) => {
  switch (event.event_type) {
    case 'sale.completed':
      if (event.schema_version !== 1) {
        const error = new Error('unsupported sale.completed schema_version');
        error.code = 'INVALID_SALE_COMPLETED_PAYLOAD';
        throw error;
      }
      return processSaleCompleted(client, event);
    case 'payment.recorded':
      return processPaymentRecorded(client, event);
    default: {
      const error = new Error(`unsupported POS event_type: ${event.event_type}`);
      error.code = 'UNSUPPORTED_POS_EVENT';
      throw error;
    }
  }
};

module.exports = { processPosEvent };

const { jsonError, jsonOk } = require('../../utils/responses');
const {
  createCustomer,
  updateCustomer,
  listCustomers,
  getCustomerById,
  addPayment,
  getLedger
} = require('./service');

const requireNamePhone = (payload) => {
  const name = String(payload?.name || payload?.customer_name || '').trim();
  const phone = String(payload?.phone || payload?.mobile || payload?.customer_phone || '').trim();
  if (!name) return 'name is required';
  if (!phone) return 'phone is required';
  return null;
};

const handleCreateCustomer = async (req, res) => {
  try {
    const validation = requireNamePhone(req.body || {});
    if (validation) {
      return jsonError(res, 400, 'VALIDATION_ERROR', validation);
    }
    const customer = await createCustomer(req.tenantPool, req.body);
    return jsonOk(res, { customer });
  } catch (error) {
    return jsonError(res, 500, 'CUSTOMER_CREATE_FAILED', error.message || 'Failed to create customer');
  }
};

const handleUpdateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const customer = await updateCustomer(req.tenantPool, id, req.body);
    if (!customer) return jsonError(res, 404, 'NOT_FOUND', 'Customer not found');
    return jsonOk(res, { customer });
  } catch (error) {
    return jsonError(res, 500, 'CUSTOMER_UPDATE_FAILED', error.message || 'Failed to update customer');
  }
};

const handleGetCustomers = async (req, res) => {
  try {
    const search = req.query.search || req.query.q || req.query.name || req.query.phone || '';
    const limit = req.query.limit;
    const customers = await listCustomers(req.tenantPool, { search, limit });
    return jsonOk(res, { customers });
  } catch (error) {
    return jsonError(res, 500, 'CUSTOMER_LIST_FAILED', 'Failed to load customers');
  }
};

const handleSearchCustomers = async (req, res) => {
  try {
    const term = req.query.q || req.query.name || req.query.phone || '';
    if (!term) return jsonError(res, 400, 'VALIDATION_ERROR', 'Search term is required');
    const customers = await listCustomers(req.tenantPool, { search: term, limit: req.query.limit || 10 });
    return res.status(200).json({
      success: true,
      data: { customers },
      customers
    });
  } catch (error) {
    return jsonError(res, 500, 'CUSTOMER_SEARCH_FAILED', 'Failed to search customers');
  }
};

const handleGetCustomerById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await getCustomerById(req.tenantPool, id);
    if (!result) return jsonError(res, 404, 'NOT_FOUND', 'Customer not found');
    return jsonOk(res, result);
  } catch (error) {
    return jsonError(res, 500, 'CUSTOMER_FETCH_FAILED', 'Failed to load customer');
  }
};

const handleAddPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await addPayment(req.tenantPool, id, req.body || {});
    return jsonOk(res, result);
  } catch (error) {
    const status = error.status || 500;
    return jsonError(res, status, 'PAYMENT_CREATE_FAILED', error.message || 'Failed to add payment');
  }
};

const handleLedger = async (req, res) => {
  try {
    const { id } = req.params;
    const ledger = await getLedger(req.tenantPool, id);
    return jsonOk(res, { ledger });
  } catch (error) {
    return jsonError(res, 500, 'LEDGER_FETCH_FAILED', 'Failed to load ledger');
  }
};

module.exports = {
  handleCreateCustomer,
  handleUpdateCustomer,
  handleGetCustomers,
  handleSearchCustomers,
  handleGetCustomerById,
  handleAddPayment,
  handleLedger
};

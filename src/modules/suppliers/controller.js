const {
  createSupplier,
  updateSupplier,
  listSuppliers,
  getSupplierById,
  getLedger,
  addPayment
} = require('./service');

const getPool = (req) => req.tenantPool;

const create = async (req, res) => {
  try {
    const supplier = await createSupplier(getPool(req), req.body || {});
    return res.status(201).json({ success: true, data: { supplier } });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Failed to create supplier' });
  }
};

const update = async (req, res) => {
  try {
    const supplier = await updateSupplier(getPool(req), req.params.id, req.body || {});
    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }
    return res.status(200).json({ success: true, data: { supplier } });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Failed to update supplier' });
  }
};

const list = async (req, res) => {
  try {
    const suppliers = await listSuppliers(getPool(req), {
      search: req.query?.search,
      limit: req.query?.limit,
      branch_id: req.query?.branch_id || req.query?.branchId || null
    });
    return res.status(200).json({ success: true, data: { suppliers }, suppliers });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to load suppliers' });
  }
};

const getById = async (req, res) => {
  try {
    const supplier = await getSupplierById(getPool(req), req.params.id);
    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }
    return res.status(200).json({ success: true, data: { supplier }, supplier });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to load supplier' });
  }
};

const ledger = async (req, res) => {
  try {
    const supplier = await getSupplierById(getPool(req), req.params.id);
    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }
    const entries = await getLedger(getPool(req), req.params.id);
    return res.status(200).json({ success: true, data: { supplier, ledger: entries } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to load ledger' });
  }
};

const addPaymentEntry = async (req, res) => {
  try {
    const supplier = await getSupplierById(getPool(req), req.params.id);
    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }
    const result = await addPayment(getPool(req), req.params.id, req.body || {});
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message || 'Failed to add payment' });
  }
};

module.exports = {
  create,
  update,
  list,
  getById,
  ledger,
  addPaymentEntry
};

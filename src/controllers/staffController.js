const staffService = require('../services/staffService');

const createStaff = async (req, res) => {
  try {
    const created = await staffService.addStaff(req, req.body || {});
    return res.status(201).json({ success: true, staff: created });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const listStaff = async (req, res) => {
  try {
    const list = await staffService.getStaff(req, req.query || {});
    return res.status(200).json({ success: true, staff: list });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const updateStaff = async (req, res) => {
  try {
    const updated = await staffService.updateStaff(req, req.params.id, req.body || {});
    return res.status(200).json({ success: true, staff: updated });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const deleteStaff = async (req, res) => {
  try {
    await staffService.deleteStaff(req, req.params.id);
    return res.status(200).json({ success: true });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

module.exports = { createStaff, listStaff, updateStaff, deleteStaff };

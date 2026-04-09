const { importOfflineItems } = require('../services/imports.service');

const importOffline = async (req, res) => {
  try {
    const payload = req.body || {};
    const result = await importOfflineItems(req, payload);
    return res.status(200).json({
      success: true,
      summary: result.summary,
      id_map: result.mappings,
      mappings: result.mappings
    });
  } catch (error) {
    const status = error.status || 500;
    const message = error.message || 'Import failed';
    return res.status(status).json({ success: false, message });
  }
};

module.exports = { importOffline };

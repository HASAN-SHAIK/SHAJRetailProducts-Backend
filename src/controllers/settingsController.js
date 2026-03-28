const settingsService = require('../services/settings.service');

const getSettings = async (req, res) => {
  try {
    const result = await settingsService.getSettings(req);
    return res.status(200).json(result);
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      error: error.message || 'Internal Server Error'
    });
  }
};

module.exports = {
  getSettings
};

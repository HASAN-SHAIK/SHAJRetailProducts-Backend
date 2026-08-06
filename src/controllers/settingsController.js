const settingsService = require('../services/settings.service');
const applicationSettingsService = require('../services/applicationSettings.service');
const { jsonError, jsonOk } = require('../utils/responses');

const getSettings = async (req, res) => {
  try {
    const result = await settingsService.getSettings(req);
    return jsonOk(res, result);
  } catch (error) {
    const status = error.status || 500;
    return jsonError(res, status, 'SETTINGS_FAILED', error.message || 'Internal Server Error');
  }
};

const getApplicationSettings = async (req, res) => {
  try {
    const settings = await applicationSettingsService.getApplicationSettings(req);
    return jsonOk(res, { settings });
  } catch (error) {
    const status = error.status || 500;
    return jsonError(res, status, 'APPLICATION_SETTINGS_FAILED', error.message || 'Internal Server Error');
  }
};

const updateApplicationSettings = async (req, res) => {
  try {
    const settings = await applicationSettingsService.updateApplicationSettings(req, req.body || {});
    return jsonOk(res, { settings });
  } catch (error) {
    const status = error.status || 500;
    return jsonError(res, status, 'APPLICATION_SETTINGS_UPDATE_FAILED', error.message || 'Internal Server Error');
  }
};

module.exports = {
  getSettings,
  getApplicationSettings,
  updateApplicationSettings,
};

const { resolveDevice } = require('../../../../configuration/targets');

const unavailable = (message) => {
  const error = new Error(message);
  error.code = 'POS_SYNC_DEVICE_NOT_REGISTERED';
  return error;
};

const resolvePosInventoryDeviceContext = async (requestPool, deviceId) => {
  const requestedDeviceId = String(deviceId || '').trim();
  if (!requestedDeviceId) throw unavailable('POS device identity is required for inventory synchronization');
  const device = await resolveDevice(requestPool, requestedDeviceId, { requireActive: true });
  if (!device || !device.branchId) {
    throw unavailable('POS device must be actively registered to a Central branch for inventory synchronization');
  }
  return { requestedDeviceId, deviceId: device.deviceId, registrationId: device.id, branchId: device.branchId };
};

module.exports = { resolvePosInventoryDeviceContext };

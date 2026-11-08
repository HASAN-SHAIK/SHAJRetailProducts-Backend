const shiftService = require('../services/shiftService');
const { resolveBranchIdFromRequest } = require('../utils/branch');
const { parsePagination, buildPaginationMeta } = require('../utils/queryParams');

const getRequestPool = (req) => req.tenantPool;

const getCurrentShiftController = async (req, res) => {
  try {
    const tenantPool = getRequestPool(req);
    const branchId = resolveBranchIdFromRequest(req);
    const userId = req.user?.id || req.user?.user_id;

    const shift = await shiftService.getCurrentShift({ tenantPool, branchId, userId });
    return res.status(200).json({ success: true, shift });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const openShiftController = async (req, res) => {
  try {
    const tenantPool = getRequestPool(req);
    const branchId = resolveBranchIdFromRequest(req);
    const userId = req.user?.id || req.user?.user_id;
    const cashierName = req.user?.name || req.user?.username || 'Cashier';
    const { opening_cash, terminal_id, notes } = req.body || {};

    const shift = await shiftService.openShift({
      tenantPool,
      branchId,
      userId,
      cashierName,
      terminalId: terminal_id || req.headers['x-device-id'] || 'POS-1',
      openingCash: opening_cash || 0,
      notes,
    });

    return res.status(200).json({ success: true, shift });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const declareAndCloseShiftController = async (req, res) => {
  try {
    const tenantPool = getRequestPool(req);
    const branchId = resolveBranchIdFromRequest(req);
    const userId = req.user?.id || req.user?.user_id;
    const { shift_id, declared_cash, denominations, notes } = req.body || {};

    const shift = await shiftService.declareAndCloseShift({
      tenantPool,
      shiftId: shift_id,
      branchId,
      userId,
      declaredCash: declared_cash,
      denominations,
      notes,
    });

    return res.status(200).json({
      success: true,
      message: 'Shift closed and drawer cash declared successfully',
      shift,
    });
  } catch (error) {
    if (error.message === 'NO_ACTIVE_SHIFT') {
      return res.status(404).json({ success: false, error: 'No active open shift found for declaration' });
    }
    return res.status(500).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

const listShiftsController = async (req, res) => {
  try {
    const tenantPool = getRequestPool(req);
    const branchId = resolveBranchIdFromRequest(req);
    const { from, to } = req.query || {};
    const { page, limit, offset } = parsePagination(req, { defaultLimit: 50, maxLimit: 200 });

    const shifts = await shiftService.listShifts({
      tenantPool,
      branchId,
      limit,
      offset,
      from,
      to,
    });

    return res.status(200).json({
      success: true,
      shifts,
      pagination: buildPaginationMeta({ page, limit, total: shifts.length }),
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Internal Server Error' });
  }
};

module.exports = {
  getCurrentShiftController,
  openShiftController,
  declareAndCloseShiftController,
  listShiftsController,
};

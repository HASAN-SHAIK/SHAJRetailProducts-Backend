const { lookupGstByHsn, searchHsn } = require('../services/hsnGst.service');

const searchHsnCodes = async (req, res) => {
  try {
    const query = req.query?.q || '';
    const results = await searchHsn(req, query);
    return res.status(200).json({ success: true, results });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to search HSN codes' });
  }
};

const lookupHsn = async (req, res) => {
  try {
    const hsn = req.query?.hsn || '';
    if (!hsn) {
      return res.status(400).json({ success: false, message: 'hsn is required' });
    }
    const row = await lookupGstByHsn(req.tenantPool || req.pool, hsn);
    if (!row) {
      return res.status(200).json({ success: true, result: null });
    }
    return res.status(200).json({
      success: true,
      result: {
        hsn: row.hsn_code,
        gst_percentage: Number(row.gst_percentage),
        description: row.description || null
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to lookup HSN code' });
  }
};

module.exports = { searchHsnCodes, lookupHsn };

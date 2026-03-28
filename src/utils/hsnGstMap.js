const HSN_GST_MAP = {
  // Lighting
  "9405": 18,
  "9405.10": 18,
  "9405.20": 18,
  "8539": 12,
  "8513": 12,

  // Oil
  "2710.19": 18,
  "2710.20": 18,
  "3403": 18,
  "3403.19": 18,

  // Automobile
  "8708": 28,
  "8409": 28,
  "8413": 18,
  "8421": 18,
  "8483": 18,

  //Books
  "4901" : 18
};

const resolveGstPercentage = (hsnCode) => {
  if (!hsnCode) return null;
  const normalized = String(hsnCode).trim();
  if (!Object.prototype.hasOwnProperty.call(HSN_GST_MAP, normalized)) {
    return null;
  }
  return HSN_GST_MAP[normalized];
};

module.exports = {
  HSN_GST_MAP,
  resolveGstPercentage
};

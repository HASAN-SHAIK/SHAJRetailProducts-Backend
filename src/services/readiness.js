const createReadinessHandler = (masterPool) => async (_req, res) => {
  try {
    await masterPool.query('SELECT 1');
    return res.status(200).json({ status: 'ready' });
  } catch (_error) {
    return res.status(503).json({ status: 'not_ready', reason: 'database_unavailable' });
  }
};

module.exports = {
  createReadinessHandler,
};

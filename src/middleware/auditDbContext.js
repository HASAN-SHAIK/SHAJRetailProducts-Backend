const setActorContext = async (queryFn, req) => {
  await queryFn(
    `SELECT
        set_config('app.actor_user_id', $1, false),
        set_config('app.actor_role', $2, false),
        set_config('app.actor_name', $3, false)`,
    [
      req?.user?.id ? String(req.user.id) : '',
      req?.user?.role || '',
      req?.user?.name || req?.user?.username || ''
    ]
  );
};

const withAuditContext = async (client, req, fn) => {
  const originalQuery = client.query.bind(client);
  await setActorContext(originalQuery, req);
  return fn();
};

const attachAuditDbContext = (req, _res, next) => {
  const basePool = req.tenantPool;
  if (!basePool || !req.user) return next();

  req.tenantPool = {
    ...basePool,
    async query(text, params) {
      const client = await basePool.connect();
      try {
        return await withAuditContext(client, req, () => client.query(text, params));
      } finally {
        client.release();
      }
    },
    async connect() {
      const client = await basePool.connect();
      const originalQuery = client.query.bind(client);
      let initialized = false;
      const ensure = async () => {
        if (initialized) return;
        await setActorContext(originalQuery, req);
        initialized = true;
      };
      client.query = async (...args) => {
        await ensure();
        return originalQuery(...args);
      };
      return client;
    }
  };
  return next();
};

module.exports = { attachAuditDbContext };

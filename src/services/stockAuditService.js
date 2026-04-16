const safeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const resolveActor = (req = {}, fallbackUserId = null) => {
  const userId = req?.user?.id ?? fallbackUserId ?? null;
  const role = req?.user?.role || null;
  const actorName = req?.user?.name || req?.user?.username || null;
  return { userId, role, actorName };
};

const writeStockAudit = async (client, payload = {}) => {
  const {
    productId,
    batchId = null,
    branchId = null,
    reason = 'correction',
    sourceType = 'system',
    referenceId = null,
    deltaQty = 0,
    beforeQty = null,
    afterQty = null,
    deltaPurchasePrice = 0,
    beforePurchasePrice = null,
    afterPurchasePrice = null,
    deltaSellingPrice = 0,
    beforeSellingPrice = null,
    afterSellingPrice = null,
    note = null,
    metadata = null,
    actorUserId = null,
    actorRole = null,
    actorName = null
  } = payload;

  if (!productId) return;

  await client.query(
    `INSERT INTO stock_audit_logs (
        product_id,
        batch_id,
        branch_id,
        actor_user_id,
        actor_role,
        actor_name,
        reason,
        source_type,
        reference_id,
        delta_quantity,
        before_quantity,
        after_quantity,
        delta_purchase_price,
        before_purchase_price,
        after_purchase_price,
        delta_selling_price,
        before_selling_price,
        after_selling_price,
        note,
        metadata
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,
        $10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
      )`,
    [
      productId,
      batchId,
      branchId,
      actorUserId,
      actorRole,
      actorName,
      reason,
      sourceType,
      referenceId,
      safeNumber(deltaQty),
      beforeQty === null || beforeQty === undefined ? null : safeNumber(beforeQty),
      afterQty === null || afterQty === undefined ? null : safeNumber(afterQty),
      safeNumber(deltaPurchasePrice),
      beforePurchasePrice === null || beforePurchasePrice === undefined ? null : safeNumber(beforePurchasePrice),
      afterPurchasePrice === null || afterPurchasePrice === undefined ? null : safeNumber(afterPurchasePrice),
      safeNumber(deltaSellingPrice),
      beforeSellingPrice === null || beforeSellingPrice === undefined ? null : safeNumber(beforeSellingPrice),
      afterSellingPrice === null || afterSellingPrice === undefined ? null : safeNumber(afterSellingPrice),
      note,
      metadata ? JSON.stringify(metadata) : null
    ]
  );
};

const recordProductStockDelta = async (client, req, payload = {}) => {
  const actor = resolveActor(req, payload.actorUserId || null);
  await writeStockAudit(client, {
    ...payload,
    actorUserId: actor.userId,
    actorRole: actor.role,
    actorName: actor.actorName
  });
};

const setStockAuditContext = async (client, req = {}, details = {}) => {
  const actor = resolveActor(req);
  await client.query(
    `SELECT
        set_config('app.actor_user_id', $1, false),
        set_config('app.actor_role', $2, false),
        set_config('app.actor_name', $3, false),
        set_config('app.stock_reason', $4, false),
        set_config('app.stock_source', $5, false),
        set_config('app.stock_reference', $6, false)`,
    [
      actor.userId ? String(actor.userId) : '',
      actor.role || '',
      actor.actorName || '',
      details.reason || '',
      details.source || '',
      details.reference ? String(details.reference) : ''
    ]
  );
};

module.exports = {
  resolveActor,
  writeStockAudit,
  recordProductStockDelta,
  setStockAuditContext
};

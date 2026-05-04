const buildValidationError = (message) => {
  const err = new Error(message);
  err.status = 400;
  return err;
};

const normalizeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizePartyType = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'customer' || raw === 'supplier' || raw === 'expense') return raw;
  return null;
};

const resolveCashBankLedgerName = (paymentMode) => {
  const mode = String(paymentMode || '').trim().toLowerCase();
  if (mode === 'bank' || mode === 'online' || mode === 'upi') return 'Bank Account';
  if (mode === 'cash' || mode === 'card') return 'Cash in Hand';
  throw buildValidationError(`Invalid payment_mode for cash/bank posting: ${paymentMode}`);
};

const getLedgerIdByName = async (client, name) => {
  const res = await client.query(
    `SELECT id
     FROM ledgers
     WHERE LOWER(name) = LOWER($1)
     ORDER BY branch_id NULLS FIRST, created_at ASC
     LIMIT 1`,
    [name]
  );
  if (res.rowCount === 0) {
    throw buildValidationError(`Ledger not found: ${name}`);
  }
  return res.rows[0].id;
};

const assertBalanced = (lines = []) => {
  const totalDebit = lines.reduce((sum, line) => sum + normalizeNumber(line.debit), 0);
  const totalCredit = lines.reduce((sum, line) => sum + normalizeNumber(line.credit), 0);
  if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100)) {
    throw buildValidationError(`Double-entry mismatch: debit ${totalDebit}, credit ${totalCredit}`);
  }
};

const getExistingTxnByClientTxnId = async (client, clientTxnId) => {
  if (!clientTxnId) return null;
  const res = await client.query(
    `SELECT id, created_at, txn_type
     FROM transactions
     WHERE client_txn_id = $1
     LIMIT 1`,
    [clientTxnId]
  );
  return res.rows[0] || null;
};

const insertLedgerEntries = async ({
  client,
  lines,
  transactionId = null,
  referenceId = null,
  referenceType,
  description = null,
  date = null,
  branchId = null,
  clientTxnId = null,
  syncStatus = 'SYNCED',
  partyType = null,
  partyId = null,
}) => {
  assertBalanced(lines);
  const resolvedPartyType = normalizePartyType(partyType);
  const resolvedPartyId = Number.isFinite(Number(partyId)) ? Number(partyId) : null;
  if (!resolvedPartyType) {
    throw buildValidationError('party_type and party_id are required for ledger posting.');
  }
  if (resolvedPartyType === 'customer' && resolvedPartyId) {
    const partyRes = await client.query('SELECT id FROM customers WHERE id = $1 LIMIT 1', [resolvedPartyId]);
    if (partyRes.rowCount === 0) throw buildValidationError('Invalid customer party_id for ledger posting.');
  } else if (resolvedPartyType === 'supplier' && resolvedPartyId) {
    const partyRes = await client.query('SELECT id FROM suppliers WHERE id = $1 LIMIT 1', [resolvedPartyId]);
    if (partyRes.rowCount === 0) throw buildValidationError('Invalid supplier party_id for ledger posting.');
  }
  const sourceEventKey = clientTxnId ? `manual:${clientTxnId}` : `manual:${Date.now()}`;
  let lineNo = 0;
  for (const line of lines) {
    const debit = normalizeNumber(line.debit);
    const credit = normalizeNumber(line.credit);
    if ((debit <= 0 && credit <= 0) || (debit > 0 && credit > 0)) {
      throw buildValidationError('Each ledger line must have either debit or credit amount.');
    }
    const ledgerId = await getLedgerIdByName(client, line.ledger);
    lineNo += 1;
    await client.query(
      `INSERT INTO ledger_entries (
         ledger_id, debit, credit, transaction_id, reference_id, reference_type, description, date, branch_id, sync_status, source_event_key, line_no, client_txn_id, party_type, party_id
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, COALESCE($8, NOW()), $9, $10, $11, $12, $13, $14, $15
       )
       ON CONFLICT (source_event_key, line_no) DO NOTHING`,
      [
        ledgerId,
        debit,
        credit,
        transactionId,
        referenceId,
        referenceType,
        description,
        date,
        branchId,
        syncStatus,
        sourceEventKey,
        lineNo,
        clientTxnId,
        resolvedPartyType,
        resolvedPartyId,
      ]
    );
  }
};

module.exports = {
  buildValidationError,
  normalizeNumber,
  resolveCashBankLedgerName,
  getLedgerIdByName,
  assertBalanced,
  getExistingTxnByClientTxnId,
  insertLedgerEntries,
};

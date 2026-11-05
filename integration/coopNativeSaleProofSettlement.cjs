'use strict';
// Settle a boot-reconciled market fill THROUGH the L9-A sale ledger, never around it.
//
// Measured live 2026-11-03 (world m003s1, image evejs-m003:l9a-5f2ac6b): the market boot
// reconciler proved a fill of 4620 units from the market's own order row, wrote
// coop-native-market/reconciled/coop-pilot-012.json, paid the pilot 24 041 094 ISK and took
// the cargo off the hull - and left the sale journal at `phase: UNKNOWN, fills: []` with no
// receipt in coop-native-warehouse/receipts/. Money had moved and the row that says why was
// empty. This module is the missing bridge, and the operator's decision (DECISION.md, run 3)
// fixes the order: the warehouse RECEIPT is written first, then the sale attempt is settled
// with fills that cover it, and only then may the pilot ledger move.
//
// A receipt is the warehouse's acknowledgement of what actually left the hull; the market's
// reconciled/ proof is the market's statement that a fill happened. The manifest gate reads
// receipts/ only: if it ever accepted reconciled/, the receipt requirement would become
// optional and the exact defect this cycle exists to catch would pass the gate.
//
// All-or-nothing: a receipt whose journal row could not be settled is rolled back, so the
// ledger move in the caller can never happen without both.
//
// ONE BID PAYS ONCE (decision-of-record, run 5). Measured live 2026-11-03 (world m003s2):
// a single 5000-unit bid with `vol_entered 5000, vol_remaining 0` paid two pilots
// 26 018 500 ISK each, because every journal that could quote the order row proved its own
// fill against the same row. The bid is a finite resource: the units it absorbed are
// `vol_entered - vol_remaining`, and the pilot claims recorded in
// `<warehouse>/order-claims/<orderID>.json` may never sum past that number. The claim is
// written BEFORE the receipt (it is the gate, the receipt is the proof); a claim whose
// receipt failed holds no money and is re-used, not re-created, by the retry.
const fs = require('node:fs');
const path = require('node:path');
const {createSaleLedger} = require('./coopNativeSaleLedger');

const pos = x => Number.isSafeInteger(Number(x)) && Number(x) > 0 ? Number(x) : 0;
const at0 = x => Number.isSafeInteger(Number(x)) && Number(x) >= 0 ? Number(x) : 0;

function readJSON(io, file) {
  try {
    return {status: 'READY', value: JSON.parse(io.readFileSync(file, 'utf8'))};
  } catch (error) {
    if (error && error.code === 'ENOENT') return {status: 'MISSING'};
    return {status: 'UNREADABLE'};
  }
}

function writeReceipt(io, dir, file, record) {
  try {
    io.mkdirSync(dir, {recursive: true});
    const temp = file + '.tmp-' + process.pid;
    const fd = io.openSync(temp, 'w', 0o600);
    try {
      io.writeFileSync(fd, JSON.stringify(record));
      if (typeof io.fsyncSync === 'function') io.fsyncSync(fd);
    } finally {
      try {
        io.closeSync(fd);
      } catch (_error) {
        /* the rename below is the real commit */
      }
    }
    io.renameSync(temp, file);
    return true;
  } catch (_error) {
    return false;
  }
}

// `sale` carries the identity the row was opened under (from the sale attempt or the market
// journal), the quantity the market actually paid for, the ISK it paid, and the order
// volume the market itself proved (`orderFilled = vol_entered - vol_remaining`).
function claimOrderFill({io, dir, orderID, orderFilled, raiseToClaimed, cargoID, quantity, at}) {
  const file = path.join(dir, orderID + '.json');
  const prior = readJSON(io, file);
  if (prior.status === 'UNREADABLE') return {status: 'SALE_ORDER_CLAIM_UNREADABLE'};
  const record = prior.status === 'READY' && prior.value &&
    Number(prior.value.version) === 1 ? prior.value : {version: 1, orderID, claims: []};
  const claims = Array.isArray(record.claims) ? record.claims : [];
  const same = x => Number(x && x.cargoID) === cargoID &&
    Number(x && x.quantity) === quantity && Number(x && x.at) === at;
  if (claims.some(same)) return {status: 'SALE_ORDER_FILL_ALREADY_CLAIMED'};
  const total = claims.reduce((sum, x) => sum + (pos(x && x.quantity) || 0), 0);
  // A caller that read a SETTLED market answer (the arrival) knows the units left the
  // order, so its own claim raises the ceiling to what it has now provably claimed. The
  // boot reconciler only quotes the order row and may never raise it.
  const cap = raiseToClaimed ? Math.max(orderFilled, total + quantity) : orderFilled;
  if (total + quantity > cap)
    return {status: 'SALE_ORDER_OVERFILLED', claimed: total, quantity, orderFilled: cap};
  const next = {...record, version: 1, orderID, orderFilled: cap,
    claims: [...claims, {cargoID, quantity, at}], updatedAt: at};
  if (!writeReceipt(io, dir, file, next)) return {status: 'SALE_ORDER_CLAIM_UNWRITTEN'};
  return {status: 'SALE_ORDER_FILL_CLAIMED', claimed: total + quantity, orderFilled: cap};
}

function settleMarketProofSale({root, io = fs, clock = () => Date.now(), sale} = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root))
    return {status: 'SALE_SETTLEMENT_ROOT_REQUIRED'};
  const s = sale || {};
  const cargoID = pos(s.cargoID);
  if (![cargoID, s.haulerID, s.typeID, s.stationID, s.systemID, s.fleetID, s.corporationID]
    .every(pos))
    return {status: 'SALE_SETTLEMENT_IDENTITY_UNPROVEN'};
  const orderID = String(s.orderID || '');
  if (!orderID) return {status: 'SALE_ORDER_ID_UNPROVEN'};
  const orderFilled = pos(s.orderFilled);
  if (!orderFilled) return {status: 'SALE_ORDER_VOLUME_UNPROVEN'};
  const quantity = pos(s.quantity), declared = pos(s.declaredQuantity);
  // The market can take less than the row declared (measured: 4620 of 7495). It can never
  // take more: that would be a fill this row cannot account for.
  if (!quantity || !declared || quantity > declared)
    return {status: 'SALE_SETTLEMENT_QUANTITY_UNPROVEN'};

  const ledger = createSaleLedger({root, io, clock});
  const attempt = ledger.read(cargoID);
  if (attempt.status === 'SALE_ATTEMPT_INVALID')
    return {status: 'SALE_ATTEMPT_UNRESOLVED'};
  if (attempt.status === 'SALE_ATTEMPT_MISSING') {
    // A row the journal never opened is created here, not skipped: the reconciler's proof
    // is only usable if the journal then carries it.
    const intent = ledger.intend({
      cargoID, haulerID: pos(s.haulerID), typeID: pos(s.typeID), quantity: declared,
      stationID: pos(s.stationID), corporationID: pos(s.corporationID),
      fleetID: pos(s.fleetID), systemID: pos(s.systemID),
      at: at0(s.at) || clock(),
    });
    if (intent.status !== 'SALE_INTENT_RECORDED')
      return {status: 'SALE_ATTEMPT_UNRESOLVED'};
  } else if (attempt.record.phase === 'REFUSED') {
    // The arrival told the journal the market definitely refused; a proof of a fill
    // contradicts that, and money must not move on a contradiction.
    return {status: 'SALE_PROOF_CONTRADICTS_REFUSAL'};
  }

  const dir = path.join(root, 'receipts');
  const file = path.join(dir, cargoID + '.json');
  const prior = readJSON(io, file);
  if (prior.status === 'UNREADABLE') return {status: 'SALE_RECEIPT_UNREADABLE'};
  if (prior.status === 'READY' && (pos(prior.value && prior.value.cargoID) !== cargoID ||
    String(prior.value && prior.value.source) !== 'NPC_MARKET_FILL'))
    return {status: 'SALE_RECEIPT_FOREIGN'};

  const at = at0(s.at) || clock();
  const fill = {stationID: pos(s.stationID), quantity, at};
  const priorFills = Array.isArray(prior.value && prior.value.fills)
    ? prior.value.fills.filter(x => pos(x && x.stationID) && pos(x && x.quantity))
      .map(x => ({stationID: pos(x.stationID), quantity: pos(x.quantity), at: at0(x.at)}))
    : [];
  const alreadyPaid = priorFills.some(x => x.stationID === fill.stationID &&
    x.quantity === fill.quantity && x.at === fill.at);

  // The bid is claimed BEFORE anything durable is written: a second pilot quoting the same
  // order may only spend what that order has left. An over-claim returns here, so no
  // receipt exists and the caller cannot move money.
  const claim = claimOrderFill({io, dir: path.join(root, 'order-claims'),
    orderID, orderFilled, cargoID, quantity, at});
  if (claim.status !== 'SALE_ORDER_FILL_CLAIMED' &&
      claim.status !== 'SALE_ORDER_FILL_ALREADY_CLAIMED')
    return {...claim, cargoID, quantity};

  // Idempotent by (cargoID, fill): a replay finds its own receipt and writes nothing. The
  // journal is still checked, so a receipt whose row was never settled is repaired, never
  // re-paid.
  if (!alreadyPaid) {
    const record = {
      version: 1,
      phase: 'COMMITTED',
      source: 'NPC_MARKET_FILL',
      provenance: 'market-proof',
      sequence: (Number(prior.value && prior.value.sequence) || 0) + 1,
      cargoID,
      haulerID: pos(s.haulerID),
      typeID: pos(s.typeID),
      quantity: (Number(prior.value && prior.value.quantity) || 0) + quantity,
      fills: [...priorFills, fill],
      systemID: pos(s.systemID),
      fleetID: pos(s.fleetID),
      stationID: pos(s.stationID),
      corporationID: pos(s.corporationID),
      marketQuantity: quantity,
      isk: (Number(prior.value && prior.value.isk) || 0) +
        (Number.isFinite(Number(s.isk)) ? Math.max(0, Number(s.isk)) : 0),
      proof: {status: 'SETTLED_BY_MARKET_PROOF', orderID: String(s.orderID || '')},
      at,
    };
    if (!writeReceipt(io, dir, file, record))
      return {status: 'SALE_RECEIPT_UNWRITTEN'};
  }

  const resolved = ledger.resolve({
    cargoID,
    fills: [{stationID: fill.stationID, quantity, at,
      ...(Number.isFinite(Number(s.isk)) ? {isk: Math.max(0, Number(s.isk))} : {})}],
    at,
    proof: {status: 'SETTLED_BY_MARKET_PROOF', orderID: s.orderID, at},
  });
  if (resolved.status !== 'SALE_SETTLED' && resolved.status !== 'SALE_PARTIAL') {
    // Roll the receipt back so the caller cannot move money against a receipt whose
    // journal row is empty: the illegal state is made impossible, not merely visible.
    if (!alreadyPaid) {
      try {
        if (prior.status === 'READY') writeReceipt(io, dir, file, prior.value);
        else io.unlinkSync(file);
      } catch (_error) {
        return {status: 'SALE_PROOF_UNRECORDED', detail: resolved.status};
      }
    }
    return {status: 'SALE_PROOF_UNRECORDED', detail: resolved.status};
  }
  return {
    status: alreadyPaid ? 'SALE_ALREADY_COMMITTED' : 'SALE_PROOF_SETTLED',
    cargoID,
    quantity,
    covered: resolved.covered,
    declared: resolved.declared,
    phase: resolved.phase,
    isk: Number.isFinite(Number(s.isk)) ? Math.max(0, Number(s.isk)) : 0,
    receiptPath: file,
  };
}

module.exports = {settleMarketProofSale, claimOrderFill};

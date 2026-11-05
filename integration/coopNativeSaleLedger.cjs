'use strict';
// Durable journal of one sale attempt per manifest cargo row.
//
// A manifest declares exactly which cargo rows a trip carries. A settled market fill removes a
// row from the hull and never leaves a station item, so the sale receipt written at the station is
// the only durable proof that the row was sold. If the process dies (or the reconciliation fails)
// between the settlement and that receipt, the row is gone, the money moved, and nothing in the
// world records why: the trip then sits in "loaded" for ever and every reconcile beat reports a
// missing warehouse receipt. This journal is written BEFORE the market is asked to sell and is only
// closed by evidence, so a missing receipt becomes a named integrity error and an unknown outcome
// is never retried.
//
// Authored by DeepSeek (DEEPSEEK_RESCUED): three Ornith attempts did not reach the pinned contract.
const fs = require('node:fs');
const path = require('node:path');

const VERSION = 1;
const PHASE = {
  REQUESTED: 'REQUESTED',
  SETTLED: 'SETTLED',
  PARTIAL: 'PARTIAL',
  REFUSED: 'REFUSED',
  UNKNOWN: 'UNKNOWN',
  // An UNKNOWN row that the hull itself proves was never sold: the stack is still aboard
  // in exactly the quantity the attempt declared, and the market's call window has closed.
  // A fill removes the stack, so an intact stack is positive proof that no fill happened;
  // the row may then be deposited (or, if it somehow stays aboard, offered again) without
  // ever re-sending the RPC that produced the doubt.
  VOID: 'VOID',
};
// The market call an UNKNOWN row recorded may still land after the journal was written.
// Until that window closes, an intact hull is NOT proof of "no fill" - it is only the
// state before the answer. 120 s mirrors the reconciler's proof tolerance.
const NO_FILL_GRACE_MS = 120000;
const PHASES = new Set(Object.values(PHASE));
const pos = value => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const nonNegative = value =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
// A timestamp (`at`) is a whole millisecond, but a fill's ISK is money and the market pays
// whole ISK cents. Demanding a safe integer for it silently drops 19 327 820.4 and leaves
// the journal at `isk: 0` while the receipt and the ledger wallet hold the money - measured
// live 2026-11-03 in m003s9 (sale-attempts/980200000683.json had no isk on a SETTLED fill,
// receipts/980200000683.json and the treasury line had 19 327 820.4).
const nonNegativeAmount = value =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

function createSaleLedger({root, io = fs, clock = () => Date.now()} = {}) {
  if (typeof root !== 'string' || !root)
    throw Error('SALE_LEDGER_ROOT_REQUIRED');
  if (!io || typeof io.readFileSync !== 'function')
    throw Error('SALE_LEDGER_IO_REQUIRED');
  const dir = path.join(root, 'sale-attempts');
  const file = cargoID => path.join(dir, cargoID + '.json');
  const stamp = value => (nonNegative(value) ? value : clock());

  // Atomic: a torn journal would be read as INVALID, which is a different fact from "absent".
  function write(record) {
    io.mkdirSync(dir, {recursive: true});
    const target = file(record.cargoID);
    const tmp = target + '.tmp-' + process.pid;
    const fd = io.openSync(tmp, 'w', 0o600);
    try {
      io.writeFileSync(fd, JSON.stringify(record));
      io.fsyncSync(fd);
    } finally {
      try {
        io.closeSync(fd);
      } catch (_error) {
        /* the descriptor is already gone; the rename below is the real commit */
      }
    }
    io.renameSync(tmp, target);
  }

  function load(cargoID) {
    if (!pos(cargoID)) return {status: 'SALE_ATTEMPT_INVALID'};
    let raw;
    try {
      raw = io.readFileSync(file(cargoID), 'utf8');
    } catch (error) {
      return {status: error && error.code === 'ENOENT'
        ? 'SALE_ATTEMPT_MISSING' : 'SALE_ATTEMPT_INVALID'};
    }
    let record;
    try {
      record = JSON.parse(raw);
    } catch (_error) {
      return {status: 'SALE_ATTEMPT_INVALID'};
    }
    if (!record || record.version !== VERSION || record.cargoID !== cargoID ||
        !pos(record.declaredQuantity) || !Array.isArray(record.fills) ||
        !PHASES.has(record.phase))
      return {status: 'SALE_ATTEMPT_INVALID'};
    return {status: 'SALE_ATTEMPT_READY', record};
  }

  // A row's total obligation is every unit already sold plus the units the hull still
  // carries. Measured live 2026-11-03: a trip declared 7495, the market paid for 4620,
  // and the hull held 2875 - the residue must be re-declared as the PHYSICAL 2875, never
  // as the remembered 7495, or the next attempt sells a quantity the hull does not hold.
  const coveredOf = record =>
    record.fills.reduce((sum, fill) => sum + fill.quantity, 0);

  function intend(args) {
    const {cargoID, haulerID, typeID, quantity, stationID, corporationID, fleetID,
      systemID, at} = args || {};
    if (![cargoID, haulerID, typeID, quantity, stationID, corporationID, fleetID, systemID]
      .every(pos))
      return {status: 'SALE_INTENT_INVALID'};
    const loaded = load(cargoID);
    if (loaded.status === 'SALE_ATTEMPT_INVALID')
      return {status: 'SALE_ATTEMPT_UNRESOLVED'};   // never overwrite an unreadable record
    if (loaded.status === 'SALE_ATTEMPT_READY') {
      const record = loaded.record;
      // Only a row that is provably still on the hull (partly sold, refused, or a doubt
      // whose intact hull closed it) may be attempted again, and only under the identity
      // it was declared under.
      if (![PHASE.PARTIAL, PHASE.REFUSED, PHASE.VOID].includes(record.phase))
        return {status: 'SALE_ATTEMPT_UNRESOLVED'};
      if (record.haulerID !== haulerID || record.typeID !== typeID)
        return {status: 'SALE_ATTEMPT_UNRESOLVED'};
      // A caller that knows the PHYSICAL hull (the arrival does, from the store) declares the
      // residue and the record keeps the row's whole obligation: sold + aboard. Measured live
      // 2026-11-03: 7495 declared, 4620 paid, hull 2875 - the row must never re-declare 7495.
      const aboard = pos(args && args.hullQuantity) ? Number(args.hullQuantity) : 0;
      if (aboard) {
        record.hullQuantity = aboard;
        record.declaredQuantity = coveredOf(record) + aboard;
      } else if (record.declaredQuantity !== quantity) {
        return {status: 'SALE_ATTEMPT_UNRESOLVED'};
      }
      record.updatedAt = stamp(at);
      try {
        write(record);
      } catch (_error) {
        return {status: 'SALE_INTENT_UNWRITTEN'};
      }
      return {status: 'SALE_INTENT_RECORDED'};
    }
    const record = {
      version: VERSION,
      cargoID,
      haulerID,
      typeID,
      declaredQuantity: quantity,
      hullQuantity: quantity,
      stationID,
      corporationID,
      fleetID,
      systemID,
      phase: PHASE.REQUESTED,
      fills: [],
      reason: '',
      openedAt: stamp(at),
      updatedAt: stamp(at),
    };
    try {
      write(record);
    } catch (_error) {
      return {status: 'SALE_INTENT_UNWRITTEN'};
    }
    return {status: 'SALE_INTENT_RECORDED'};
  }

  function applyFills(record, fills) {
    const added = [];
    for (const fill of Array.isArray(fills) ? fills : []) {
      if (!pos(fill && fill.stationID) || !pos(fill && fill.quantity) ||
          !nonNegative(fill && fill.at))
        return {error: 'SALE_SETTLE_INVALID'};
      const same = row => row.stationID === fill.stationID &&
        row.quantity === fill.quantity && row.at === fill.at;
      if (record.fills.some(same) || added.some(same)) continue;
      added.push({
        stationID: fill.stationID,
        quantity: fill.quantity,
        at: fill.at,
        ...(nonNegativeAmount(fill.isk) ? {isk: fill.isk} : {}),
      });
    }
    record.fills = record.fills.concat(added);
    return {added, covered: coveredOf(record)};
  }

  function close(record, at, unwritten) {
    record.phase = record.fills.reduce((sum, fill) => sum + fill.quantity, 0) >=
      record.declaredQuantity ? PHASE.SETTLED : PHASE.PARTIAL;
    record.updatedAt = stamp(at);
    try {
      write(record);
    } catch (_error) {
      return {status: unwritten};
    }
    return {
      status: record.phase === PHASE.SETTLED ? 'SALE_SETTLED' : 'SALE_PARTIAL',
      covered: coveredOf(record),
      declared: record.declaredQuantity,
      phase: record.phase,
    };
  }

  function settle(args) {
    const {cargoID, fills, at} = args || {};
    const loaded = load(cargoID);
    if (loaded.status === 'SALE_ATTEMPT_INVALID')
      return {status: 'SALE_ATTEMPT_UNRESOLVED'};
    if (loaded.status !== 'SALE_ATTEMPT_READY')
      return {status: 'SALE_ATTEMPT_MISSING'};
    const record = loaded.record;
    // An unknown outcome may already have moved money: recording a fill afterwards would
    // turn a doubt into an invented proof. Only resolve() may close it, and only against
    // the market's own proof of the fill.
    if (record.phase === PHASE.UNKNOWN)
      return {status: 'SALE_ATTEMPT_UNRESOLVED'};
    const applied = applyFills(record, fills);
    if (applied.error) return {status: applied.error};
    return close(record, at, 'SALE_SETTLE_UNWRITTEN');
  }

  // The boot reconciler proved the fill from the market's own order row. That is the one
  // authority allowed to turn an UNKNOWN attempt into a settled one, and it says exactly
  // which units and which order: a proof that is missing, or contradicts a definite
  // refusal, resolves nothing.
  function resolve(args) {
    const {cargoID, fills, at, proof} = args || {};
    const loaded = load(cargoID);
    if (loaded.status === 'SALE_ATTEMPT_INVALID')
      return {status: 'SALE_ATTEMPT_UNRESOLVED'};
    if (loaded.status !== 'SALE_ATTEMPT_READY')
      return {status: 'SALE_ATTEMPT_MISSING'};
    if (!proof || proof.status !== 'SETTLED_BY_MARKET_PROOF' ||
        !Array.isArray(fills) || !fills.length)
      return {status: 'SALE_PROOF_INVALID'};
    const record = loaded.record;
    if (record.phase === PHASE.REFUSED || record.phase === PHASE.VOID)
      return {status: 'SALE_PROOF_CONTRADICTS_REFUSAL'};
    const applied = applyFills(record, fills);
    if (applied.error) return {status: applied.error};
    record.proof = {
      status: 'SETTLED_BY_MARKET_PROOF',
      orderID: String(proof.orderID || ''),
      at: nonNegative(proof.at) ? proof.at : stamp(at),
    };
    return close(record, at, 'SALE_SETTLE_UNWRITTEN');
  }

  function unknown(args) {
    const {cargoID, reason, at} = args || {};
    const loaded = load(cargoID);
    if (loaded.status !== 'SALE_ATTEMPT_READY') return {status: 'SALE_ATTEMPT_MISSING'};
    const record = loaded.record;
    if (record.phase === PHASE.SETTLED) return {status: 'SALE_ALREADY_SETTLED'};
    record.phase = PHASE.UNKNOWN;
    record.reason = String(reason || '');
    record.updatedAt = stamp(at);
    try {
      write(record);
    } catch (_error) {
      return {status: 'SALE_UNKNOWN_UNWRITTEN'};
    }
    return {status: 'SALE_OUTCOME_UNKNOWN'};
  }

  // The one way a doubt becomes a known no-sale. `proof.hullQuantity` is the quantity the
  // caller read off the hauler's own hold; it must equal the quantity the row declared, so
  // a row that lost even one unit (a fill may have landed) is never closed as VOID. The
  // market call must also be older than NO_FILL_GRACE_MS, so a still-in-flight RPC cannot
  // be mistaken for a no-op. No fill, no receipt, no money: VOID owns only the hull fact.
  function resolveNoFill(args) {
    const {cargoID, proof, at} = args || {};
    const loaded = load(cargoID);
    if (loaded.status === 'SALE_ATTEMPT_INVALID')
      return {status: 'SALE_ATTEMPT_UNRESOLVED'};
    if (loaded.status !== 'SALE_ATTEMPT_READY')
      return {status: 'SALE_ATTEMPT_MISSING'};
    const record = loaded.record;
    if (record.phase !== PHASE.UNKNOWN)
      return {status: 'SALE_NO_FILL_NOT_A_DOUBT'};
    if (!proof || proof.status !== 'NO_FILL_PROVEN_BY_INTACT_HULL' ||
        !pos(Number(proof.hullQuantity)))
      return {status: 'SALE_NO_FILL_PROOF_INVALID'};
    if (Number(proof.hullQuantity) !== Number(record.hullQuantity))
      return {status: 'SALE_NO_FILL_HULL_MISMATCH'};
    const now = stamp(at);
    if (now - stamp(record.updatedAt) < NO_FILL_GRACE_MS)
      return {status: 'SALE_NO_FILL_TOO_EARLY'};
    record.phase = PHASE.VOID;
    record.reason = 'NO_FILL_PROVEN_BY_INTACT_HULL';
    record.proof = {
      status: 'NO_FILL_PROVEN_BY_INTACT_HULL',
      hullQuantity: Number(proof.hullQuantity),
      at: now,
    };
    record.updatedAt = now;
    try {
      write(record);
    } catch (_error) {
      return {status: 'SALE_NO_FILL_UNWRITTEN'};
    }
    return {status: 'SALE_NO_FILL_RESOLVED', phase: PHASE.VOID,
      quantity: Number(record.hullQuantity)};
  }

  function refuse(args) {
    const {cargoID, reason, at} = args || {};
    const loaded = load(cargoID);
    if (loaded.status !== 'SALE_ATTEMPT_READY') return {status: 'SALE_ATTEMPT_MISSING'};
    const record = loaded.record;
    if ([PHASE.SETTLED, PHASE.PARTIAL, PHASE.UNKNOWN].includes(record.phase))
      return {status: 'SALE_ALREADY_SETTLED'};
    record.phase = PHASE.REFUSED;
    record.reason = String(reason || '');
    record.updatedAt = stamp(at);
    try {
      write(record);
    } catch (_error) {
      return {status: 'SALE_REFUSAL_UNWRITTEN'};
    }
    return {status: 'SALE_REFUSED'};
  }

  function read(cargoID) {
    return load(cargoID);
  }

  function classify(args) {
    const {cargoID, declaredQuantity, stationID, startedAt} = args || {};
    const loaded = load(cargoID);
    if (loaded.status === 'SALE_ATTEMPT_MISSING') return 'NO_SALE_ATTEMPT';
    if (loaded.status !== 'SALE_ATTEMPT_READY') return 'SALE_ATTEMPT_INVALID';
    const record = loaded.record;
    if (record.declaredQuantity !== declaredQuantity) return 'SALE_ATTEMPT_INVALID';
    if (record.phase === PHASE.REQUESTED || record.phase === PHASE.UNKNOWN)
      return 'SALE_OUTCOME_UNKNOWN';
    if (record.phase === PHASE.REFUSED || record.phase === PHASE.VOID)
      return 'SALE_REFUSED';
    const covered = record.fills
      .filter(fill => fill.stationID === stationID && fill.at >= Number(startedAt || 0))
      .reduce((sum, fill) => sum + fill.quantity, 0);
    if (record.phase === PHASE.SETTLED && covered >= declaredQuantity)
      return 'SALE_RECEIPT_MISSING';
    if (record.phase === PHASE.PARTIAL && covered > 0 && covered < declaredQuantity)
      return 'SALE_PARTIAL_FILL_REMAINS';
    return 'SALE_OUTCOME_UNKNOWN';
  }

  return {intend, settle, unknown, refuse, resolveNoFill, read, classify, resolve};
}

module.exports = {createSaleLedger};

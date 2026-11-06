import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// Measured live 2026-11-05 (three times: 12:15Z, 12:44Z, 13:14Z): a post-commit readback found no
// destination row (`destination_rows=0`) and parked the whole mining fleet, because nothing in the
// engine clears `coopHaulCargoNeedsOperatorRepair` - only a restart did. The transaction had
// committed (the row and its receipt are written together); the readback reads the store's cache.
// The doubt is now resolved by evidence: one row with that cargoID means the transfer really
// happened. A missing row keeps the flag.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const {healReadbackRepair, READBACK_REPAIR} =
  require(path.join(forkRoot, "Code/server/src/space/coopNativeHaulTransferAtomic.js"));

const REASON = "ALIFE10_POSTCOMMIT_CUSTODY_READBACK_FAILED:destination_rows=0:cargo=980200387963";

function actors() {
  return {
    miner: {itemID: 980000073502, coopHaulNeedsOperatorRepair: REASON,
      coopHaulCargoNeedsOperatorRepair: REASON, coopMiningCargoNeedsOperatorRepair: REASON},
    hauler: {itemID: 980000027001, coopHaulNeedsOperatorRepair: REASON,
      coopHaulCargoNeedsOperatorRepair: REASON},
    fleet: {fleetID: 960004610, coopHaulNeedsOperatorRepair: REASON,
      coopHaulCargoNeedsOperatorRepair: REASON},
  };
}

test("the readback reason carries the cargo it is about", () => {
  const match = READBACK_REPAIR.exec(REASON);
  assert.ok(match, "the reason is parseable");
  assert.equal(Number(match[1]), 980200387963);
});

test("a row that exists exactly once clears the doubt on every actor", () => {
  const a = actors();
  const seen = [];
  const nativeStore = {listNativeCargoForEntity: (id) => (Number(id) === 980000027001
    ? [{cargoID: 980200387963, typeID: 1228, quantity: 1249}]
    : [])};
  const healed = healReadbackRepair({...a, nativeStore,
    observe: (event, _id, _space, fields) => seen.push({event, fields})});
  assert.equal(healed.status, "HEALED");
  assert.equal(healed.cargoID, 980200387963);
  for (const actor of [a.miner, a.hauler, a.fleet]) {
    assert.equal(actor.coopHaulNeedsOperatorRepair, undefined);
    assert.equal(actor.coopHaulCargoNeedsOperatorRepair, undefined);
    assert.equal(actor.coopMiningCargoNeedsOperatorRepair, undefined);
  }
  const event = seen.find((e) => e.event === "living-haul-repair-healed");
  assert.ok(event, seen.map((e) => e.event).join(","));
  assert.equal(event.fields.proof, "DESTINATION_ROW_EXISTS_ONCE");
});

test("a row that is still missing keeps the fleet parked", () => {
  const a = actors();
  const healed = healReadbackRepair({...a, nativeStore: {listNativeCargoForEntity: () => []}});
  assert.equal(healed, null);
  assert.equal(a.fleet.coopHaulNeedsOperatorRepair, REASON, "no evidence, no repair");
});

test("an ambiguity (two rows with one cargo id) is not proof either", () => {
  const a = actors();
  const row = {cargoID: 980200387963, typeID: 1228, quantity: 1249};
  const healed = healReadbackRepair({...a, nativeStore: {listNativeCargoForEntity: () => [row, row]}});
  assert.equal(healed, null);
  assert.equal(a.miner.coopHaulNeedsOperatorRepair, REASON);
});


test("a committed transfer receipt heals a destination row that was already consumed", () => {
  // Measured live 2026-11-06 16:33-17:18: the fleet was parked again with destination_rows=0 and
  // the row-only proof could not fire, because the cargo had already been sold or moved.
  const a = actors();
  const seen = [];
  const receipt = { version: 1, status: "COMMITTED", cargoID: 980200387963,
    minerID: 980000073502, haulerID: 980000027001, typeID: 1228, quantity: 1249 };
  const healed = healReadbackRepair({ ...a,
    nativeStore: { listNativeCargoForEntity: () => [] },
    readReceipt: (cargoID) => (Number(cargoID) === 980200387963 ? receipt : null),
    observe: (event, _id, _space, fields) => seen.push({ event, fields }) });
  assert.equal(healed.status, "HEALED");
  assert.equal(healed.proof, "TRANSFER_RECEIPT_COMMITTED");
  assert.equal(a.fleet.coopHaulNeedsOperatorRepair, undefined);
  const event = seen.find((e) => e.event === "living-haul-repair-healed");
  assert.equal(event.fields.proof, "TRANSFER_RECEIPT_COMMITTED");
});

test("a receipt that names another hauler proves nothing", () => {
  const a = actors();
  const healed = healReadbackRepair({ ...a,
    nativeStore: { listNativeCargoForEntity: () => [] },
    readReceipt: () => ({ status: "COMMITTED", cargoID: 980200387963,
      minerID: 980000073502, haulerID: 999 }) });
  assert.equal(healed, null);
  assert.equal(a.miner.coopHaulNeedsOperatorRepair, REASON);
});

test("no row and no receipt still keeps the fleet parked", () => {
  const a = actors();
  const healed = healReadbackRepair({ ...a,
    nativeStore: { listNativeCargoForEntity: () => [] }, readReceipt: () => null });
  assert.equal(healed, null);
  assert.equal(a.fleet.coopHaulNeedsOperatorRepair, REASON);
});
test("a flag from any other failure is never healed by this path", () => {
  const a = actors();
  for (const actor of [a.miner, a.hauler, a.fleet]) {
    actor.coopHaulNeedsOperatorRepair = "HAUL_SOURCE_MOVE_UNCERTAIN";
    actor.coopHaulCargoNeedsOperatorRepair = "HAUL_SOURCE_MOVE_UNCERTAIN";
  }
  const healed = healReadbackRepair({...a,
    nativeStore: {listNativeCargoForEntity: () => [{cargoID: 980200387963}]}});
  assert.equal(healed, null);
  assert.equal(a.miner.coopHaulNeedsOperatorRepair, "HAUL_SOURCE_MOVE_UNCERTAIN");
});

test("a doubled ALIFE10_ prefix still names its cargo (the reason the heal never fired)", () => {
  // Measured live 2026-11-06 15:42:34Z, fleet 960004610: the stored reason was
  // "ALIFE10_ALIFE10_POSTCOMMIT_CUSTODY_READBACK_FAILED:destination_rows=0:cargo=980200450759" because
  // the caller prefixed a reason that already carried the prefix. The matcher expected a single one,
  // so it never recognised its own doubt and the fleet stayed parked for two days.
  const doubled = "ALIFE10_ALIFE10_POSTCOMMIT_CUSTODY_READBACK_FAILED:destination_rows=0:cargo=980200450759";
  const match = READBACK_REPAIR.exec(doubled);
  assert.ok(match, "a doubled prefix is still parseable");
  assert.equal(Number(match[1]), 980200450759);
  const a = actors();
  for (const actor of [a.miner, a.hauler, a.fleet]) {
    actor.coopHaulNeedsOperatorRepair = doubled;
    actor.coopHaulCargoNeedsOperatorRepair = doubled;
  }
  const healed = healReadbackRepair({...a, nativeStore: {listNativeCargoForEntity: (id) =>
    (Number(id) === 980000027001 ? [{cargoID: 980200450759, typeID: 1228, quantity: 1249}] : [])}});
  assert.equal(healed.status, "HEALED");
  assert.equal(a.miner.coopHaulNeedsOperatorRepair, undefined);
});

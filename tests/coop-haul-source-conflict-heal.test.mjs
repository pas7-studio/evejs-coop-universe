import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

// The other doubt that parked a fleet for two days.
//
// Measured live 2026-11-06: fleet 960004610 was blocked from 2026-11-04 19:27 (1 378
// HAUL_SOURCE_CARGO_IDENTITY_CONFLICT events, then 639 attestation events) and nothing in the engine
// clears coopHaulNeedsOperatorRepair - only a restart did. The conflict is a statement about the
// miner's cargo rows, so it can be answered with the same evidence it was raised from: every row must
// name this miner as its entity and owner, be durable, carry a positive quantity, be ore, and have a
// globally unique cargoID. A row that is still wrong keeps the fleet parked.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const { healSourceCargoConflict, healCustodyRepair, SOURCE_CONFLICT_REPAIR, READBACK_REPAIR } =
  require(path.join(forkRoot, "Code/server/src/space/coopNativeHaulTransferAtomic.js"));

const MINER = 980000073502;
const OWNER = 1000129;
const REASON = "HAUL_SOURCE_CARGO_IDENTITY_CONFLICT:wrong_owner";

function actors(reason = REASON) {
  return {
    miner: { itemID: MINER, ownerID: OWNER, coopHaulNeedsOperatorRepair: reason,
      coopHaulCargoNeedsOperatorRepair: reason, coopMiningCargoNeedsOperatorRepair: reason },
    hauler: { itemID: 980000027001, coopHaulNeedsOperatorRepair: reason,
      coopHaulCargoNeedsOperatorRepair: reason },
    fleet: { fleetID: 960004610, coopHaulNeedsOperatorRepair: reason,
      coopHaulCargoNeedsOperatorRepair: reason },
  };
}

function store(rows, extra = []) {
  // Only the miner holds these rows: the readback path concatenates the hauler and the miner, so a
  // row returned for both would look like a duplicate and prove nothing.
  return { listNativeCargoForEntity: (id) => (Number(id) === MINER ? rows : []),
    listNativeCargo: () => [...rows, ...extra] };
}

function row(overrides = {}) {
  return { cargoID: 980200387963, entityID: MINER, ownerID: OWNER, typeID: 1228,
    quantity: 1249, categoryID: 25, transient: false, ...overrides };
}

test("the source-cargo reason is recognised", () => {
  assert.ok(SOURCE_CONFLICT_REPAIR.test(REASON));
  assert.equal(SOURCE_CONFLICT_REPAIR.test("ALIFE10_POSTCOMMIT_CUSTODY_READBACK_FAILED:x:cargo=1"), false);
  assert.ok(READBACK_REPAIR.test("ALIFE10_POSTCOMMIT_CUSTODY_READBACK_FAILED:x:cargo=1"));
});

test("rows that now prove they are the miner's clear the conflict on every actor", () => {
  const a = actors();
  const seen = [];
  const healed = healSourceCargoConflict({ ...a, nativeStore: store([row()]),
    observe: (event, _id, _space, fields) => seen.push({ event, fields }) });
  assert.equal(healed.status, "HEALED");
  assert.equal(healed.proof, "SOURCE_CARGO_IDENTITY_CONSISTENT");
  for (const actor of [a.miner, a.hauler, a.fleet]) {
    assert.equal(actor.coopHaulNeedsOperatorRepair, undefined);
    assert.equal(actor.coopHaulCargoNeedsOperatorRepair, undefined);
    assert.equal(actor.coopMiningCargoNeedsOperatorRepair, undefined);
  }
  const event = seen.find((e) => e.event === "living-haul-repair-healed");
  assert.ok(event, seen.map((e) => e.event).join(","));
  assert.equal(event.fields.proof, "SOURCE_CARGO_IDENTITY_CONSISTENT");
  assert.equal(event.fields.rows, 1);
});

test("a row that still belongs to somebody else keeps the fleet parked", () => {
  const a = actors();
  const healed = healSourceCargoConflict({ ...a, nativeStore: store([row({ ownerID: 999 })]) });
  assert.equal(healed, null);
  assert.equal(a.miner.coopHaulNeedsOperatorRepair, REASON);
});

test("a cargo id that exists twice is not proof either", () => {
  const a = actors();
  const healed = healSourceCargoConflict({ ...a,
    nativeStore: store([row()], [row({ entityID: 980000099999 })]) });
  assert.equal(healed, null);
  assert.equal(a.fleet.coopHaulNeedsOperatorRepair, REASON);
});

test("a transient row, a non-ore row and a zero quantity all keep it parked", () => {
  for (const bad of [row({ transient: true }), row({ categoryID: 6 }), row({ quantity: 0 })]) {
    const a = actors();
    assert.equal(healSourceCargoConflict({ ...a, nativeStore: store([bad]) }), null);
    assert.equal(a.miner.coopHaulNeedsOperatorRepair, REASON);
  }
});

test("an empty hold is consistent: nothing can conflict", () => {
  const a = actors();
  const healed = healSourceCargoConflict({ ...a, nativeStore: store([]) });
  assert.equal(healed.status, "HEALED");
  assert.equal(healed.rows, 0);
});

test("a reason with no proof is never healed by either path", () => {
  const a = actors("ALIFE10_UNEXPECTED_HAUL_OUTCOME");
  assert.equal(healCustodyRepair({ ...a, nativeStore: store([row()]) }), null);
  assert.equal(a.miner.coopHaulNeedsOperatorRepair, "ALIFE10_UNEXPECTED_HAUL_OUTCOME");
});

test("the dispatcher answers each doubt with its own evidence", () => {
  const readback = actors("ALIFE10_POSTCOMMIT_CUSTODY_READBACK_FAILED:destination_rows=0:cargo=980200387963");
  const healedReadback = healCustodyRepair({ ...readback,
    nativeStore: store([row()]) });
  assert.equal(healedReadback.proof, "DESTINATION_ROW_EXISTS_ONCE");
  const conflict = actors();
  const healedConflict = healCustodyRepair({ ...conflict, nativeStore: store([row()]) });
  assert.equal(healedConflict.proof, "SOURCE_CARGO_IDENTITY_CONSISTENT");
});

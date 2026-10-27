// FW-032 guard: a confirmed native wreck must leave the war - the hull's custody
// slot, the fleet roster entry, and the pilot's identity binding - using only the
// sanctioned release/record paths and never spawning, paying or crediting a kill.
import test from "node:test";
import assert from "node:assert/strict";
import { createWarLossReconcile, enabled } from "../integration/coopWarLossReconcile.cjs";

const ON = {
  EVEJS_COOP_FACTION_WAR: "1",
  EVEJS_COOP_FACTION_WAR_FLEETS: "1",
  EVEJS_COOP_WAR_LOSS_RECONCILE: "1",
};

function fixture({ ship = null, rosterShip = true, releaseStatus = "APPLIED", identityStatus = "RELEASED" } = {}) {
  const calls = { execute: [], loss: [], identity: [] };
  const registry = {
    snapshot: () => ({ ships: ship ? { [String(ship.entityID)]: ship } : {} }),
    execute: (command) => { calls.execute.push(command); return { status: releaseStatus }; },
  };
  const roster = {
    snapshot: () => ({
      fleets: {
        "coop-fleet-500001-0001": {
          fleetID: "coop-fleet-500001-0001",
          ships: rosterShip ? [{ entityID: 501, role: "tackle", state: "ALIVE" }] : [],
        },
      },
    }),
    recordLoss: (loss) => { calls.loss.push(loss); return { status: "RECORDED" }; },
  };
  const reconcile = createWarLossReconcile({
    registry,
    roster,
    releaseIdentity: (input) => { calls.identity.push(input); return { status: identityStatus }; },
    env: ON,
    clock: () => 1000,
  });
  return { reconcile, calls, registry, roster };
}

const SHIP = { entityID: 501, pilotID: "coop-pilot-001", fleetID: "fw-war:c1-500001", systemID: 30045344 };

test("releases custody, records the roster loss and frees the pilot", () => {
  const f = fixture({ ship: SHIP });
  const out = f.reconcile.reconcile({ entityID: 501, wreckID: 900, pilotID: "coop-pilot-001" });
  assert.equal(out.status, "RECONCILED");
  assert.equal(out.custody, "APPLIED");
  assert.equal(out.roster, "RECORDED");
  assert.equal(out.identity, "RELEASED");
  assert.equal(out.fleetID, "coop-fleet-500001-0001");
  assert.deepEqual(f.calls.execute[0], {
    eventID: "wreck-release:900",
    type: "RELEASE",
    entityID: 501,
    pilotID: "coop-pilot-001",
    fleetID: "fw-war:c1-500001",
    proofID: "native-wreck:900",
  });
  assert.deepEqual(f.calls.loss[0], {
    fleetID: "coop-fleet-500001-0001",
    entityID: 501,
    wreckID: 900,
    casualtyID: "wreck:900",
  });
  assert.deepEqual(f.calls.identity[0], { pilotID: "coop-pilot-001", entityID: 501, reason: "NATIVE_WRECK" });
});

test("a replay is idempotent: DUPLICATE custody and loss still free the pilot once", () => {
  const f = fixture({ ship: SHIP, releaseStatus: "DUPLICATE" });
  f.roster.recordLoss = (loss) => { f.calls.loss.push(loss); return { status: "DUPLICATE" }; };
  const out = f.reconcile.reconcile({ entityID: 501, wreckID: 900, pilotID: "coop-pilot-001" });
  assert.equal(out.status, "RECONCILED");
  assert.equal(out.custody, "DUPLICATE");
  assert.equal(out.roster, "DUPLICATE");
});

test("a refused native release blocks the whole reconciliation", () => {
  const f = fixture({ ship: SHIP, releaseStatus: "BLOCKED" });
  const out = f.reconcile.reconcile({ entityID: 501, wreckID: 900, pilotID: "coop-pilot-001" });
  assert.equal(out.status, "BLOCKED");
  assert.match(out.reason, /CUSTODY_RELEASE_BLOCKED/);
  assert.equal(f.calls.loss.length, 0);
  assert.equal(f.calls.identity.length, 0);
});

test("never releases a hull registered to a different pilot", () => {
  const f = fixture({ ship: SHIP });
  const out = f.reconcile.reconcile({ entityID: 501, wreckID: 900, pilotID: "coop-pilot-002" });
  assert.equal(out.status, "BLOCKED");
  assert.equal(out.reason, "WRECK_PILOT_MISMATCH");
  assert.equal(f.calls.execute.length, 0);
});

test("an unregistered hull still records the roster loss and frees the pilot", () => {
  const f = fixture({ ship: null });
  const out = f.reconcile.reconcile({ entityID: 501, wreckID: 900, pilotID: "coop-pilot-001" });
  assert.equal(out.status, "RECONCILED");
  assert.equal(out.custody, "NOT_REGISTERED");
  assert.equal(out.roster, "RECORDED");
  assert.equal(f.calls.execute.length, 0);
});

test("flag OFF is inert and authorities are required", () => {
  const off = createWarLossReconcile({
    registry: { snapshot: () => ({ ships: {} }), execute: () => ({ status: "APPLIED" }) },
    roster: { snapshot: () => ({ fleets: {} }), recordLoss: () => ({ status: "RECORDED" }) },
    releaseIdentity: () => ({ status: "RELEASED" }),
    env: {},
    clock: () => 1000,
  });
  assert.equal(off.reconcile({ entityID: 1, wreckID: 2, pilotID: "coop-pilot-001" }).status, "DISABLED");
  assert.equal(enabled(ON), true);
  assert.equal(enabled({}), false);
  assert.throws(() => createWarLossReconcile({}), /WAR_LOSS_RECONCILE_AUTHORITIES_REQUIRED/);
});

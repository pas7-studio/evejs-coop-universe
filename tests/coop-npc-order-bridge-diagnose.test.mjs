import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createOrderBridge } = require("../integration/coopNpcOrderBridge.cjs");

// A minimal arbiter: no leases, nothing blocked. Only the read-only diagnosis is
// exercised here, so `issue` must never be reached.
function arbiter() {
  return {
    leases: [],
    snapshot() { return { leases: this.leases }; },
    blocked() { return false; },
    blocksForSystem() { return []; },
    retainWithNativeProof() { return { status: "RETAINED" }; },
    issue() { throw Error("diagnose must never issue an order"); },
  };
}

function bridgeWith({ ship = null, controller = null, warShipClaim = null, links = [] } = {}) {
  return createOrderBridge({
    arbiter: arbiter(),
    assignments: () => links,
    sceneForSystem: () => ({ systemID: 30000145, getEntityByID: (id) => (ship && Number(ship.itemID) === Number(id) ? ship : null) }),
    getController: () => controller,
    warShipClaim,
  });
}

const LINK = { pilotID: "coop-pilot-070", entityID: 980000018058, systemID: 30000145 };
const SHIP = { kind: "ship", nativeNpc: true, itemID: 980000018058, mode: "STOP", position: { x: 0, y: 0, z: 0 } };
const CONTROLLER = { entityID: 980000018058, systemID: 30000145, currentTargetID: 0, manualOrder: null };

test("diagnose reports an unverified identity instead of a bare boolean", () => {
  const r = bridgeWith({ links: [] }).diagnose({ entityID: 980000018058, systemID: 30000145, owner: "RAID" });
  assert.equal(r.status, "BLOCKED");
  assert.equal(r.reason, "COOP_NPC_ORDER_IDENTITY_UNVERIFIED");
});

test("diagnose reports a missing native proof when the hull is not physical", () => {
  const r = bridgeWith({ ship: null, controller: CONTROLLER, links: [LINK] })
    .diagnose({ entityID: 980000018058, systemID: 30000145, owner: "RAID" });
  assert.equal(r.status, "BLOCKED");
  assert.equal(r.reason, "COOP_NPC_ORDER_NATIVE_PROOF_MISSING");
});

test("diagnose permits an idle named hull that no other owner holds", () => {
  const r = bridgeWith({ ship: SHIP, controller: CONTROLLER, links: [LINK] })
    .diagnose({ entityID: 980000018058, systemID: 30000145, owner: "RAID" });
  assert.equal(r.status, "PERMITTED");
  assert.equal(r.warClaim, "UNASSIGNED");
});

test("diagnose names the reserved-warship refusal for a non-war owner", () => {
  const r = bridgeWith({ ship: SHIP, controller: CONTROLLER, links: [LINK], warShipClaim: () => "ASSIGNED" })
    .diagnose({ entityID: 980000018058, systemID: 30000145, owner: "RAID" });
  assert.equal(r.status, "BLOCKED");
  assert.equal(r.reason, "COOP_NPC_ORDER_WAR_SHIP_RESERVED");
});

test("diagnose names an active native warp instead of a silent refusal", () => {
  const r = bridgeWith({ ship: { ...SHIP, mode: "WARP" }, controller: CONTROLLER, links: [LINK] })
    .diagnose({ entityID: 980000018058, systemID: 30000145, owner: "RAID" });
  assert.equal(r.status, "BLOCKED");
  assert.equal(r.reason, "COOP_NPC_ORDER_NATIVE_WARP_ACTIVE");
});

// COOP_INDUSTRY_DEMO
//
// `/bpauto seed|quote|build|deliver` is the in-game way to get a real blueprint,
// its materials, a real job and a real delivered product. It needs a docked
// session, which QA has no client for, so the admin bridge grew one action that
// builds the session fields the command reads and runs the SAME command through the
// ordinary chat dispatch. These tests pin that: no second implementation of
// seeding, quoting, job install or delivery may appear here.
import test from "node:test";
import assert from "node:assert/strict";
import {engineSource, skipWithoutEngine} from "./_support/engineCheckout.mjs";

test("blueprint_auto is a whitelisted bridge action and is dispatched", (t) => {
  if (skipWithoutEngine(t)) return;
  const actions = engineSource("server/src/space/coopAdminBridgeActions.js");
  const bridge = engineSource("server/src/space/coopAdminBridge.js");
  assert.match(actions, /ALLOWED_ACTIONS = new Set\(\[[\s\S]*"blueprint_auto"/);
  assert.match(bridge, /if \(action === "blueprint_auto"\) return blueprintAuto\(request\);/);
  assert.match(actions, /module\.exports = \{[^}]*blueprintAuto/);
});

test("the action refuses without a character or a docked station", (t) => {
  if (skipWithoutEngine(t)) return;
  const actions = engineSource("server/src/space/coopAdminBridgeActions.js");
  const body = actions.slice(actions.indexOf("function blueprintAuto"));
  assert.match(body, /characterID is required/);
  assert.match(body, /arguments are required/);
  assert.match(body, /is not docked; pass stationID explicitly/);
});

test("the action runs the ordinary /bpauto command, not its own industry calls", (t) => {
  if (skipWithoutEngine(t)) return;
  const actions = engineSource("server/src/space/coopAdminBridgeActions.js");
  const start = actions.indexOf("function blueprintAuto");
  const body = actions.slice(start, actions.indexOf("function executeChatCommand"));
  assert.match(body, /executeChatCommand\(session, "\/bpauto " \+ argumentsText/);
  // A bridge action that seeded or installed directly would be a second, untested
  // path to real items and real ISK.
  for (const forbidden of ["seedBlueprintForOwner", "installManufacturingJob", "seedItemsForOwner", "grantItemsToCharacterLocation"]) {
    assert.equal(body.includes(forbidden), false, `blueprintAuto must not call ${forbidden}`);
  }
  // The synthetic session carries exactly what the command reads to see "docked".
  assert.match(body, /stationid: stationID/);
  assert.match(body, /regionid: Number\(character\.regionID\)/);
});

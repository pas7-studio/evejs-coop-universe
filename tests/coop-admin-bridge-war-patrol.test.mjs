import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {readModuleText} from "./_support/coopSourceText.mjs";
// The bridge is split: the actions live in its `coopAdminBridgeActions.js`
// sibling, which readModuleText inlines for the wiring assertions below.
const source=readModuleText("integration/coopAdminBridge.cjs");

// Wiring guards for the live world-setup path. They prove the admin spawn cannot
// silently produce an unarmed "patrol" and that a war patrol can be durable
// (the native muster gate rejects transient charges). The behavioural proof of
// the loadout choice lives in coop-war-patrol-loadout.test.mjs; the real spawn
// evidence is a live container result, never a unit test.
test("an unarmed patrol spawn is refused instead of labelled patrol",()=>{
 assert.match(source,/WAR_PATROL_LOADOUT_UNAVAILABLE:/);
 assert.match(source,/warPatrol = request\.warPatrol === true \|\| String\(request\.role \|\| ""\) === "patrol"/);
 assert.match(source,/if \(warPatrol && request\.allowUnarmed !== true\)/);
});
test("the resolved authored row is passed to the native spawn",()=>{
 assert.match(source,/loadoutID = loadout\.loadoutID/);
 assert.match(source,/\.\.\.\(loadoutID \? \{ loadoutID \} : \{\}\)/);
 assert.match(source,/createWarPatrolLoadout/);
 assert.match(source,/coopWarPatrolLoadout/);
});
test("a durable war patrol is spawned as a durable native ship",()=>{
 assert.match(source,/transient: request\.durable === true \? false : true/);
 assert.match(source,/durable: request\.durable === true,/);
});
test("the spawn result reports the loadout it really used",()=>{
 assert.match(source,/loadout: loadout \? \{/);
 for(const field of ["loadoutID","moduleTypeID","chargeTypeID","moduleFamily"])
  assert.ok(source.includes(field+":"),field+" must be reported");
});

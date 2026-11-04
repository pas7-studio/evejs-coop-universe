import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// Measured live 2026-11-04/05, in this order:
//  - the batteries a client sees inside a site are category 23 scenery with hit points
//    only, materialised as static content: no controller, so they can never fire;
//  - category 11 "Destructible Sentry Gun" BATTERIES also carry zero damage attributes in
//    this build (their damage sits in a missile charge the data does not name);
//  - the faction's own "<Faction> Sentry Gun" type does carry a complete weapon profile
//    (damage, multiplier, cycle, range) and has a native NPC profile as well.
// So a battery is defended by its faction's real sentry gun, and this module only names it.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const sentries = require(path.join(forkRoot, "Code/server/src/space/coopSiteSentries.js"));

test("a battery is defended by its faction's own sentry gun", () => {
  assert.equal(sentries.pickFiringTypeName({structureName: "Heavy Missile Battery",
    spawnQuery: "guristas_deadspace_pve"}), "Guristas Sentry Gun");
  assert.equal(sentries.pickFiringTypeName({structureName: "Cruise Missile Battery",
    spawnQuery: "blood_deadspace_pve"}), "Blood Raider Sentry Gun");
  assert.equal(sentries.pickFiringTypeName({structureName: "Light Missile Battery",
    spawnQuery: "sanshas_deadspace_pve"}), "Sansha Sentry Gun");
});

test("scenery that is not a battery never gets a gun", () => {
  assert.equal(sentries.pickFiringTypeName({structureName: "Cargo Rig",
    spawnQuery: "serpentis_deadspace_pve"}), "");
  assert.equal(sentries.pickFiringTypeName({structureName: "Acceleration Gate",
    spawnQuery: "serpentis_deadspace_pve"}), "");
  assert.equal(sentries.isBatteryName("Angel Cruise Missile Battery"), true);
  assert.equal(sentries.isBatteryName("Cargo Rig"), false);
});

test("a site with no faction, or a faction with no sentry gun in this build, is skipped", () => {
  assert.equal(sentries.pickFiringTypeName({structureName: "Heavy Missile Battery",
    spawnQuery: ""}), "");
  assert.equal(sentries.pickFiringTypeName({structureName: "Heavy Missile Battery",
    spawnQuery: "npc_deadspace_hostiles"}), "");
  for (const faction of ["rogue", "caldari", "ammatar", "khanid"]) {
    assert.equal(sentries.pickFiringTypeName({structureName: "Heavy Missile Battery",
      spawnQuery: `${faction}_deadspace_pve`}), "", `${faction} has no sentry gun type`);
  }
});

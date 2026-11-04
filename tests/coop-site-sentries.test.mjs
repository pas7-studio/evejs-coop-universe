import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import path from "node:path";

// Measured live 2026-11-04: the site batteries are category 23 with zero weapon attributes
// and are materialised as static content, so they can never fire. The shooting sentries
// are category 11 "Destructible Sentry Gun" types, per faction and per size. This module
// only decides the NAME of the real type; damage comes from the type's own attributes.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const require = createRequire(import.meta.url);
const sentries = require(path.join(forkRoot, "Code/server/src/space/coopSiteSentries.js"));

test("a missile battery takes its faction from the site's own spawn query", () => {
  assert.equal(sentries.pickSentryTypeName({structureName: "Heavy Missile Battery",
    spawnQuery: "guristas_deadspace_pve"}), "Guristas Heavy Missile Battery");
  assert.equal(sentries.pickSentryTypeName({structureName: "Light Missile Battery",
    spawnQuery: "sanshas_deadspace_pve"}), "Sansha Light Missile Battery");
  assert.equal(sentries.pickSentryTypeName({structureName: "Cruise Missile Battery",
    spawnQuery: "blood_deadspace_pve"}), "Blood Cruise Missile Battery");
});

test("size comes from the structure's own name, heavy is the default", () => {
  assert.equal(sentries.sizeFromName("Light Missile Battery"), "Light");
  assert.equal(sentries.sizeFromName("Cruise Missile Battery"), "Cruise");
  assert.equal(sentries.sizeFromName("Sentry"), "Heavy");
});

test("an unknown faction or a non-battery never gets a type", () => {
  assert.equal(sentries.pickSentryTypeName({structureName: "Heavy Missile Battery", spawnQuery: ""}), "");
  assert.equal(sentries.pickSentryTypeName({structureName: "Heavy Missile Battery",
    spawnQuery: "npc_deadspace_hostiles"}), "");
  assert.equal(sentries.pickSentryTypeName({structureName: "Warp Disruption Battery (Container)",
    spawnQuery: "guristas_deadspace_pve"}), "Guristas Heavy Missile Battery",
  "a named battery still resolves; whether the caller uses it is a separate decision");
  assert.equal(sentries.pickSentryTypeName({structureName: "Cargo Rig",
    spawnQuery: "serpentis_deadspace_pve"}), "");
});

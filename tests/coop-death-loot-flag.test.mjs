import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";

// Ship-death survivors are moved into the wreck by services/killmail/deathOutcomeResolver.
// The wreck is opened by the client as its CARGO HOLD (flag 5): every other loot container in
// this server stores contents at 5 (native NPC wrecks default their cargo records to flag 5 in
// space/npc/nativeNpcStore.js, anomaly loot is granted with ITEM_FLAGS.CARGO_HOLD). With
// HANGAR (4) the items were not where the wreck was opened from and the loot read as scattered
// loose items. The resolver itself pulls gameStore, so this guards the source it is built from.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const resolverPath = path.join(
  forkRoot,
  "Code/server/src/services/killmail/deathOutcomeResolver.js",
);

test("ship-death loot is stored at the wreck cargo-hold flag", () => {
  const source = readFileSync(resolverPath, "utf8");
  const match = source.match(/const ROOT_LOOT_FLAG_ID = ITEM_FLAGS\.(\w+);/);
  assert.ok(match, "ROOT_LOOT_FLAG_ID must stay a named ITEM_FLAGS constant");
  assert.equal(
    match[1],
    "CARGO_HOLD",
    "wreck contents must land at flag 5 (CARGO_HOLD), not HANGAR",
  );
});

test("nothing moves death loot into a hangar flag", () => {
  const source = readFileSync(resolverPath, "utf8");
  assert.equal(
    /ITEM_FLAGS\.HANGAR/.test(source),
    false,
    "a hangar flag destination hides the loot from the wreck's cargo hold",
  );
});

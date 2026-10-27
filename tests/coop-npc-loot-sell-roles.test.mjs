import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require = createRequire(import.meta.url);
const {ROLES, DEFAULT_ROLES, lootSellRoles, maySellLoot} =
  require("../integration/coopNpcLootSellRoles.cjs");

const on = {EVEJS_COOP_NPC_LOOT_COMMERCE: "1", EVEJS_COOP_NPC_WRECK_TRANSFER: "1"};

test("default keeps the historical pirate-only authority", () => {
  assert.deepEqual(lootSellRoles({}), ["pirate"]);
  assert.deepEqual(lootSellRoles({EVEJS_COOP_NPC_LOOT_SELL_ROLES: "   "}), ["pirate"]);
  assert.deepEqual([...DEFAULT_ROLES], ["pirate"]);
});

test("a configured list is parsed, deduplicated and lowercased", () => {
  assert.deepEqual(lootSellRoles({EVEJS_COOP_NPC_LOOT_SELL_ROLES: "pirate,patrol"}), ["pirate", "patrol"]);
  assert.deepEqual(lootSellRoles({EVEJS_COOP_NPC_LOOT_SELL_ROLES: " PATROL , pirate ,patrol"}),
    ["patrol", "pirate"]);
});

test("an unknown or empty role name is never invented into the list", () => {
  assert.deepEqual(lootSellRoles({EVEJS_COOP_NPC_LOOT_SELL_ROLES: "admiral,,bogus"}), []);
  assert.deepEqual(ROLES.filter((r) => r === "admiral"), []);
});

test("a patrol hull may sell only when the profile names patrol", () => {
  assert.equal(maySellLoot({role: "patrol", env: on, hasCommerce: true}), false);
  assert.equal(maySellLoot({role: "patrol", env: {...on, EVEJS_COOP_NPC_LOOT_SELL_ROLES: "patrol"},
    hasCommerce: true}), true);
});

test("both opt-in switches and a real commerce authority are required", () => {
  const env = {...on, EVEJS_COOP_NPC_LOOT_SELL_ROLES: "patrol"};
  assert.equal(maySellLoot({role: "patrol", env, hasCommerce: false}), false);
  assert.equal(maySellLoot({role: "patrol", env: {EVEJS_COOP_NPC_LOOT_COMMERCE: "1",
    EVEJS_COOP_NPC_LOOT_SELL_ROLES: "patrol"}, hasCommerce: true}), false);
  assert.equal(maySellLoot({role: "patrol", env: {EVEJS_COOP_NPC_WRECK_TRANSFER: "1",
    EVEJS_COOP_NPC_LOOT_SELL_ROLES: "patrol"}, hasCommerce: true}), false);
});

test("an unnamed or empty role never sells loot", () => {
  const env = {...on, EVEJS_COOP_NPC_LOOT_SELL_ROLES: "pirate,patrol"};
  assert.equal(maySellLoot({role: "", env, hasCommerce: true}), false);
  assert.equal(maySellLoot({role: null, env, hasCommerce: true}), false);
  assert.equal(maySellLoot({role: "miner", env, hasCommerce: true}), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";

// A seeded NPC profile may omit entityType. Treating "no type" as "not an npc" rejected the
// whole concord_police pool, so every faction patrol answered POOL_EMPTY and no patrol could
// deploy (measured live: virtual-faction-patrol FAILED with reason POOL_EMPTY every tick while
// the same pool's three profiles - concord_response, concord_police_cruiser,
// concord_police_battleship - all carry entityType undefined).
//
// The module itself cannot be imported here: it pulls in the server's gameStore, which refuses
// to open outside the isolated runner. The rule is therefore pinned at the source.
const forkRoot = process.env.EVEJS_FORK_ROOT || "C:/Games/EveCoop/upstream-evejs";
const source = () => readFileSync(
  path.join(forkRoot, "Code/server/src/space/npc/npcSelection.js"), "utf8");

test("an untyped profile counts as an NPC", () => {
  const text = source();
  const fn = text.match(/function isEntityTypeAllowed\([\s\S]*?\n}/);
  assert.ok(fn, "the helper exists");
  assert.match(fn[0], /\|\| "npc"/,
    "an empty entityType must fall back to npc, or untyped pools answer POOL_EMPTY");
  assert.doesNotMatch(fn[0], /String\(value \|\| ""\)\.trim\(\)\.toLowerCase\(\) ===/,
    "the strict equality without the npc default is the bug");
});

test("the patrol pool the world uses is the one that was rejected", () => {
  const pools = readFileSync(
    path.join(forkRoot, "Code/server/src/space/coopNpcSpawnPools.js"), "utf8");
  assert.match(pools, /patrol: Object\.freeze\(\{ defaultPoolID: "concord_police"/);
});

test("the patrol failure names the faction it could not deploy", () => {
  const runtime = readFileSync(
    path.join(process.cwd(), "integration/coopFactionPatrolRuntime.cjs"), "utf8");
  assert.match(runtime, /factionID\?\?faction\.faction/,
    "the faction director keys the entry as factionID, so faction.faction alone reported 0");
});

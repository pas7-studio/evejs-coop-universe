import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const { ROLE_POOLS, LEGACY_POOL, ROLES, spawnPoolForRole, behaviorOverridesForRole, isHostileRole, isHostilePool } =
  require("../integration/coopNpcSpawnPools.cjs");

const runtime = readFileSync(join(root, "integration", "coopVirtualWorldRuntime.cjs"), "utf8");

test("only pirates spawn from the hostile pool, so brackets stay meaningful", () => {
  for (const role of ROLES) {
    const pool = spawnPoolForRole(role, { enabled: true });
    assert.ok(pool.defaultPoolID, `${role} has a pool`);
    assert.ok(pool.fallbackProfileID, `${role} has a fallback profile`);
    assert.equal(
      isHostilePool(pool.defaultPoolID),
      isHostileRole(role),
      `${role} hostile-pool mismatch: ${pool.defaultPoolID}`,
    );
  }
  const civilians = ROLES.filter((role) => role !== "pirate");
  assert.ok(civilians.length >= 4);
  for (const role of civilians) {
    assert.notEqual(spawnPoolForRole(role, { enabled: true }).defaultPoolID, LEGACY_POOL.defaultPoolID);
  }
});

test("civilians get real friendly-neutral owners: ORE for industry, CONCORD for patrols", () => {
  assert.equal(ROLE_POOLS.miner.defaultPoolID, "npc_mining_ops");
  assert.equal(ROLE_POOLS.hauler.defaultPoolID, "npc_mining_hauler_highsec");
  assert.equal(ROLE_POOLS.trader.defaultPoolID, "npc_mining_hauler_highsec");
  assert.equal(ROLE_POOLS.patrol.defaultPoolID, "concord_police");
  assert.equal(ROLE_POOLS.pirate.defaultPoolID, "npc_hostiles");
  // Traders share the industrial hauler pool: a trader is a hauler hull, not a
  // Blood Raiders destroyer.
  assert.deepEqual(ROLE_POOLS.trader, ROLE_POOLS.hauler);
});

test("the flag is OFF by default and then reproduces the previous behaviour exactly", () => {
  for (const role of ROLES) {
    assert.deepEqual(spawnPoolForRole(role), { ...LEGACY_POOL });
    assert.deepEqual(spawnPoolForRole(role, { enabled: false }), { ...LEGACY_POOL });
  }
  // Unknown or missing roles must never invent a friendly owner silently.
  assert.deepEqual(spawnPoolForRole("quartermaster", { enabled: true }), { ...LEGACY_POOL });
  assert.deepEqual(spawnPoolForRole(undefined, { enabled: true }), { ...LEGACY_POOL });
});

test("the pool result carries only spawn option names the native call accepts", () => {
  for (const role of ROLES) {
    const pool = spawnPoolForRole(role, { enabled: true });
    assert.deepEqual(Object.keys(pool).sort(), ["defaultPoolID", "fallbackProfileID"]);
  }
});

test("the runtime wires both spawn sites through the role map, env-gated", () => {
  assert.match(runtime, /spawnPoolForRole\(pilot\.role,/);
  assert.match(runtime, /spawnPoolForRole\("patrol",/);
  assert.match(runtime, /EVEJS_COOP_NPC_ROLE_POOLS==="1"/);
  // No hardcoded hostile pool may remain in either spawn call.
  const hardcoded = runtime.match(/defaultPoolID:"npc_hostiles"/g) || [];
  assert.equal(hardcoded.length, 0, "a spawn site still hardcodes the hostile pool");
  // Pirates must keep native aggression; civilians must keep calm behaviour.
  assert.match(runtime, /behaviorOverridesForRole\(pilot\.role,/);
  // No inline autoAggro:false may remain next to the nautical spawn call.
  assert.doesNotMatch(runtime, /const hostile=pilot\.role==="pirate"/);
  // A reused durable pirate keeps its original controller, so the policy has to
  // be re-applied at runtime as well.
  assert.match(runtime, /getControllerByEntityID\(link\.entityID\)/);
});

test("pirates aggro players, civilians never do", () => {
  const pirate = behaviorOverridesForRole("pirate", { enabled: true });
  assert.equal(pirate.behaviorOverrides.autoAggro, true);
  assert.deepEqual(pirate.behaviorOverrides.autoAggroTargetClasses, ["player", "npc"]);
  assert.equal(pirate.behaviorOverrides.allowPodKill, false);
  for (const role of ["miner", "hauler", "trader", "patrol"]) {
    assert.deepEqual(behaviorOverridesForRole(role, { enabled: true }), {
      behaviorOverrides: { autoAggro: false, autoActivateWeapons: false, targetPreference: "none" },
    });
  }
  // OFF keeps the previous behaviour: the pool profile alone decides.
  for (const role of ROLES) assert.deepEqual(behaviorOverridesForRole(role), {});
  // A caller cannot mutate the shared policy through the returned object.
  const first = behaviorOverridesForRole("pirate", { enabled: true });
  first.behaviorOverrides.autoAggroTargetClasses.push("drone");
  assert.deepEqual(behaviorOverridesForRole("pirate", { enabled: true }).behaviorOverrides.autoAggroTargetClasses, [
    "player",
    "npc",
  ]);
});

// FW-057 guard: a real player can earn war money, not just an NPC pilot.
//
// Review finding: coopMilitiaWarPlayer proves a player kill and names it
// coop-player-<characterID>, but every ledger behind it used the NPC-only regex
// /^coop-pilot-[0-9]{3,}$/: the kill merit module, the bounty payer, the chest credit
// and the market earned ledger. So the war could recognise a player kill and then
// refuse the very identity it was handed - merit and bounty both unreachable for the
// only human in the world.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { isNpcPilotID, isPlayerPilotID, isWarPilotID } = require("../integration/coopWarPilotID.cjs");
const killMerit = require("../integration/coopWarKillMerit.cjs");

test("the shared predicate takes both real identities and nothing else", () => {
  assert.equal(isWarPilotID("coop-pilot-027"), true);
  assert.equal(isWarPilotID("coop-player-90000001"), true);
  assert.equal(isNpcPilotID("coop-player-90000001"), false, "NPC features stay strict");
  assert.equal(isPlayerPilotID("coop-pilot-027"), false);
  for (const bad of ["", "coop-pilot-", "coop-pilot-27x", "coop-player", "Pilot-001", null, 12, {}]) {
    assert.equal(isWarPilotID(bad), false, `"${String(bad)}" is not a pilot`);
  }
});

test("a player kill is not rejected as an invalid identity", () => {
  const result = killMerit.note({
    proof: { status: "NATIVE_DESTRUCTION_ATTACKER_PROVIDED", wreckID: 980300000020,
      victimEntityID: 980000000901, attackerEntityID: 980000000900,
      systemID: 30045344, attackerPilotID: "coop-player-90000001",
      victimPilotID: "coop-pilot-026" },
    victim: { pilotID: "coop-pilot-026" },
    emit: () => {},
    ledger: { award: (row) => ({ status: "PROMOTED", pilotID: row.pilotID, kind: row.kind,
      merit: 25, meritDelta: 25, from: "recruit", to: "pilot", command: 2,
      hullClassID: "frigate", promoted: true }) },
  });
  assert.notEqual(result.status, "BLOCKED", JSON.stringify(result));
  assert.notEqual(result.reason, "INVALID_KILL_IDENTITY");
  assert.equal(result.attackerPilotID, "coop-player-90000001");
});

test("a pilot id that is neither NPC nor player is still refused", () => {
  const result = killMerit.note({
    proof: { status: "NATIVE_DESTRUCTION_ATTACKER_PROVIDED", wreckID: 980300000021,
      victimEntityID: 980000000911, attackerEntityID: 980000000910,
      systemID: 30045344, attackerPilotID: "someone", victimPilotID: "coop-pilot-026" },
    victim: { pilotID: "coop-pilot-026" },
    emit: () => {},
    ledger: { award: () => ({ status: "PROMOTED" }) },
  });
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, "INVALID_KILL_IDENTITY");
});

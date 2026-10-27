"use strict";
// FW-009B: the one bridge from a strictly proven native kill to a real career
// consequence (merit -> rank -> command size).
//
// The evidence is the upstream destruction caller's own `options.attackerEntity`
// as verified by `coopNpcDestructionAttacker` (status
// NATIVE_DESTRUCTION_ATTACKER_PROVIDED): a physical wreck, a named native victim
// and a named native attacker in the same system. Correlation, a controller
// target or a recent weapon event is never accepted as a killer.
//
// Nothing is spawned, moved or repaired here, and the payout is refused when the
// evidence is not strict or the war merit feature is off.
const pilotOf = (value) => (typeof value === "string" && /^coop-pilot-[0-9]{3,}$/.test(value) ? value : "");
const pos = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;

let ledger = null;
function ledgerInstance() {
  if (!ledger) {
    ledger = require("./coopWarMeritLedger" + (__filename.endsWith(".js") ? "" : ".cjs"))
      .createWarMeritLedger({ gameStore: require("../gameStore") });
  }
  return ledger;
}

function note({ proof, victim, emit, ledger: injected } = {}) {
  const p = proof && typeof proof === "object" ? proof : null;
  if (!p || p.status !== "NATIVE_DESTRUCTION_ATTACKER_PROVIDED") {
    return { status: "NO_STRICT_NATIVE_ATTACKER", reason: String(p && p.status || "MISSING_PROOF") };
  }
  const wreckID = Number(p.wreckID), attackerID = Number(p.attackerEntityID);
  const attackerPilotID = pilotOf(p.attackerPilotID), victimPilotID = pilotOf(p.victimPilotID);
  if (!pos(wreckID) || !pos(attackerID) || !attackerPilotID || !victimPilotID ||
    attackerPilotID === victimPilotID) {
    return { status: "BLOCKED", reason: "INVALID_KILL_IDENTITY" };
  }
  let store = null;
  try {
    store = injected && typeof injected.award === "function" ? injected : ledgerInstance();
  } catch (error) {
    return { status: "UNAVAILABLE", reason: String(error && error.message || error) };
  }
  const evidence = { wreckID, victimEntityID: Number(p.victimEntityID) || 0, attackerEntityID: attackerID };
  const awards = [];
  const kill = store.award({
    pilotID: attackerPilotID,
    kind: "warship-kill",
    evidenceKey: "wreck:" + wreckID,
    evidence,
  });
  awards.push(kill);
  const loss = store.award({
    pilotID: victimPilotID,
    kind: "force-lost",
    evidenceKey: "wreck:" + wreckID,
    evidence,
  });
  awards.push(loss);
  const record = (emit && typeof emit === "function") ? emit : null;
  if (record) {
    for (const award of awards) {
      record("living-native-war-merit", null, { spaceState: { systemID: Number(p.systemID) || 0 } }, {
        status: award.status,
        pilotID: award.pilotID,
        kind: award.kind,
        merit: Number(award.merit) || 0,
        meritDelta: Number(award.meritDelta) || 0,
        from: String(award.from || ""),
        to: String(award.to || ""),
        command: Number(award.command) || 0,
        hullClassID: String(award.hullClassID || ""),
        wreckID,
        attackerEntityID: attackerID,
        victimEntityID: evidence.victimEntityID,
        evidence: "UPSTREAM_ATTACKER_ENTITY_PLUS_PHYSICAL_NATIVE_WRECK",
      });
    }
  }
  const killer = awards[0];
  return {
    status: killer.status,
    attackerPilotID,
    victimPilotID,
    wreckID,
    awards,
    promoted: killer.promoted === true,
    rank: String(killer.rank || ""),
    merit: Number(killer.merit) || 0,
  };
}

module.exports = { note };

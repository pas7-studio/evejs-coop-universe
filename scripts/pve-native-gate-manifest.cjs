"use strict";
// Explicit, reviewable source suites; newly added native PvE tests must
// be intentionally added here instead of silently skipped by a wildcard.
const requiredModules=[
 "coopPveRetaliationGuard","coopPveNativeSiteDefense",
 "coopPveWaveReinforcements","coopPveObjectiveDoctrine",
 "coopPveNativeBossDirector","coopPveBossLootPickup",
 "coopPveBossLootClaim","coopPveBossLootProfileAudit",
 "coopPveDuoNativeRewardGuard","coopPveDuoNativeRewardEvidence",
 "coopPveDuoNativeRewardCustody","coopFleetMissionJoin",
 "coopFleetDungeonCredit","coopFleetMissionTurnin",
 "coopMissionInstanceProvenance","coopNativeLootPickupEvidence"
];
const testFiles=[
 "tests/coop-pve-retaliation-guard.test.mjs",
 "tests/coop-pve-native-site-defense.test.mjs",
 "tests/coop-pve-wave-reinforcements.test.mjs",
 "tests/coop-pve-objective-doctrine.test.mjs",
 "tests/coop-pve-native-boss-director.test.mjs",
 "tests/coop-pve-boss-loot-pickup.test.mjs",
 "tests/coop-pve-boss-loot-claim.test.mjs",
 "tests/coop-pve-boss-loot-profile-audit.test.mjs",
 "tests/coop-pve-duo-native-reward-guard.test.mjs",
 "tests/coop-pve-duo-reward-wiring.test.mjs",
 "tests/coop-pve-duo-native-reward-evidence.test.mjs",
 "tests/coop-pve-duo-native-reward-wiring.test.mjs",
 "tests/coop-pve-duo-native-reward-custody.test.mjs",
 "tests/coop-pve-duo-native-reward-custody-wiring.test.mjs",
 "tests/coop-fleet-mission-join.test.mjs",
 "tests/coop-fleet-mission-join-vertical.test.mjs",
 "tests/coop-mission-instance-provenance.test.mjs",
 "tests/coop-mission-instance-provenance-wiring.test.mjs",
 "tests/coop-duo-mission-leader-fence.test.mjs",
 "tests/coop-native-loot-pickup.test.mjs",
 "tests/coop-native-loot-evidence-integrity.test.mjs",
 "tests/coop-pve-chain.test.mjs",
 "tests/coop-pve-native-support-audit.test.mjs"
];
module.exports={requiredModules,testFiles};

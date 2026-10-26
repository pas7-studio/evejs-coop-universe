import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {analyze}=require("../scripts/audit-pve-native-e2e.cjs");
const at=n=>new Date(Date.UTC(2026,9,26,12,0,n)).toISOString();
const runtimeRunID="2c03aa9a-1eac-4781-afbe-2a99bbaaaa01";
function fixture(){
 const base={systemID:30000144,runtimeRunID},fleetID=77,agentID=50,sourceInstanceID=71001;
 const players=[{characterID:101,missionSequence:11,iskDelta:120000,lpDelta:250,
  corporationID:1000123,missionWalletTransactionID:87001},
  {characterID:102,missionSequence:29,iskDelta:120000,lpDelta:250,
   corporationID:1000123,missionWalletTransactionID:87002}];
 const cargo=players.map(x=>({characterID:x.characterID,
  missionSequence:x.missionSequence,stationID:60001234,
  itemCount:1,expectedTypes:[{typeID:9001,quantity:1}],
  newItemIDs:[180000+x.characterID],standingTransactions:[
   {ownerID:1000123,eventTypeID:73,rawModification:.01,
    eventDateTime:"134900000000000000"}]}));
 return [
  {...base,event:"living-pve-native-boss-death",at:at(0),
   status:"ORIGINAL_BOSS_WRECK_CONFIRMED",instanceID:sourceInstanceID,
   wreckID:887,itemCount:1,
   evidence:"NATIVE_ORIGINAL_WRECK_AND_ITEMS_AFTER_DEATH"},
  {...base,event:"living-pve-duo-native-reward-custody",at:at(10),
   status:"TWO_ORIGINAL_REWARD_ITEMS_AND_STANDING_TRANSACTIONS_VERIFIED",
   fleetID,agentID,sourceInstanceID,recipients:cargo},
  {...base,event:"living-pve-duo-native-reward-evidence",at:at(11),
   status:"TWO_INDEPENDENT_NATIVE_WALLET_LP_AND_HISTORY_VERIFIED",
   fleetID,agentID,sourceInstanceID,recipients:players},
  {...base,event:"living-pve-duo-native-mission-turnin",at:at(12),
   status:"TWO_NATIVE_PERSONAL_MISSION_RECORDS_CLEARED",
   fleetID,agentID,sourceInstanceID,
   characterIDs:[101,102],missionSequences:[11,29]}
 ];
}
const run=list=>analyze(list.map(x=>JSON.stringify(x)).join("\n")+"\n");
test("links only server-source original boss, two different wallets and two standing/item custody receipts",()=>{
 const r=run(fixture());
 assert.equal(r.status,"SERVER_NATIVE_DUO_CAUSALITY_CORRELATED");
 assert.equal(r.bossWreckLinked,true);
 assert.equal(r.duoPayoutSourceLinked,true);
 assert.equal(r.originalNativeItemStandingLinked,true);
 assert.equal(r.distinctNativeRecipients,2);
 assert.equal(r.genuineClientsVerified,false);
 assert.equal(r.gameplayVerified,false);
 assert.equal(r.actualRareDropVerified,false);
 assert.equal(r.serverRestartVerified,false);
 assert.equal(JSON.stringify(r).includes("characterID"),false);
});
test("fake single-player mission cannot borrow other reward proof",()=>{
 const f=fixture();f[3].characterIDs=[101,101];
 assert.notEqual(run(f).status,"SERVER_NATIVE_DUO_CAUSALITY_CORRELATED");
 f[3].characterIDs=[101,102];f[2].recipients[1].characterID=101;
 assert.notEqual(run(f).status,"SERVER_NATIVE_DUO_CAUSALITY_CORRELATED");
});
test("wallet transaction reused by two recipients is never two independent rewards",()=>{
 const f=fixture();f[2].recipients[1].missionWalletTransactionID=87001;
 assert.equal(run(f).status,"TWO_PERSONAL_REWARD_SOURCE_CHAINS_NOT_MATCHED");
});
test("different fleet, mission agent, system or original dungeon cannot borrow receipts",()=>{
 for(const change of [
  a=>{a[3].agentID=99},
  a=>{a[2].fleetID=99},
  a=>{a[1].systemID=30000222},
  a=>{a[0].instanceID=99999},
  a=>{a[3].sourceInstanceID=99999},
  a=>{a[0].systemID=30000222}
 ]){
  const f=fixture();change(f);
  assert.notEqual(run(f).status,"SERVER_NATIVE_DUO_CAUSALITY_CORRELATED");
 }
});
test("native claim without real boss death or without paired reward chain is blocked",()=>{
 const f=fixture();f.shift();
 assert.equal(run(f).status,"NATIVE_BOSS_WRECK_NOT_OBSERVED");
 const g=fixture();g.splice(1,1);
 assert.equal(run(g).status,"TWO_PERSONAL_REWARD_SOURCE_CHAINS_NOT_MATCHED");
});
test("source reward item quantity mismatch or duplicated real itemID rejects whole duo",()=>{
 for(const change of [
  f=>{f[1].recipients[0].itemCount=2},
  f=>{f[1].recipients[0].expectedTypes[0].quantity=3},
  f=>{f[1].recipients[0].newItemIDs.push(f[1].recipients[0].newItemIDs[0])},
  f=>{f[1].recipients[1].standingTransactions[0].ownerID=0},
  f=>{f[2].recipients[0].iskDelta=-1}
 ]){
  const f=fixture();change(f);
  assert.notEqual(run(f).status,"SERVER_NATIVE_DUO_CAUSALITY_CORRELATED");
 }
});
test("telemetry event ordering is enforced instead of using a later unrelated boss",()=>{
 const f=fixture();f[0].at=at(25);
 assert.notEqual(run(f).status,"SERVER_NATIVE_DUO_CAUSALITY_CORRELATED");
 const g=fixture();g[2].at=at(1);g[1].at=at(11);
 assert.notEqual(run(g).status,"SERVER_NATIVE_DUO_CAUSALITY_CORRELATED");
});
test("wrong event status is not a real source receipt",()=>{
 const f=fixture();f[0].status="SYNTHETIC_BOSS_TEST";
 assert.notEqual(run(f).status,"SERVER_NATIVE_DUO_CAUSALITY_CORRELATED");
 const g=fixture();g[2].status="NATIVE_DOACTION_SUCCESS_ONLY";
 assert.notEqual(run(g).status,"SERVER_NATIVE_DUO_CAUSALITY_CORRELATED");
});
test("malformed JSONL and payload are errors, not proof",()=>{
 assert.equal(analyze("{bad").status,"INVALID_NATIVE_EVENT_LOG");
 assert.equal(run([{at:at(0),event:"unknown"},null]).status,"INVALID_NATIVE_EVENT_LOG");
});
test("native event proof NEVER claims real client rendering or restart acceptance",()=>{
 const r=run(fixture());
 assert.equal(r.genuineClientsVerified,false);
 assert.equal(r.gameplayVerified,false);
 assert.equal(r.serverRestartVerified,false);
});


test("one new native item ID cannot be allocated to both independent recipients",()=>{
 const f=fixture();
 f[1].recipients[1].newItemIDs=[...f[1].recipients[0].newItemIDs];
 assert.equal(run(f).status,"TWO_PERSONAL_REWARD_SOURCE_CHAINS_NOT_MATCHED");
});
test("an original wreck event without source authority tag is not live wreck proof",()=>{
 const f=fixture();
 delete f[0].evidence;
 assert.equal(run(f).status,"NATIVE_BOSS_WRECK_NOT_OBSERVED");
});

test("old or concatenated process logs cannot borrow a boss from another runtime boot",()=>{
 const f=fixture();f[0].runtimeRunID="2c03aa9a-1eac-4781-afbe-2a99bbaaaa02";
 assert.notEqual(run(f).status,"SERVER_NATIVE_DUO_CAUSALITY_CORRELATED");
 const g=fixture();g[1].runtimeRunID="2c03aa9a-1eac-4781-afbe-2a99bbaaaa03";
 assert.notEqual(run(g).status,"SERVER_NATIVE_DUO_CAUSALITY_CORRELATED");
});
test("telemetry without native runtime boot ID is not a current in-game source receipt",()=>{
 const f=fixture();delete f[3].runtimeRunID;
 assert.equal(run(f).status,"INVALID_NATIVE_EVENT_LOG");
});

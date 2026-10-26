import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {capture,assess}=require("../integration/coopPveDuoNativeRewardEvidence.cjs");
function fixture({char=101,agent=50,isk=120000,bonus=40000,lp=250,
 actualIsk=isk,actualLP=lp}={}){
 const mission={agentID:agent,missionSequence:11,contentID:9000,
  missionTemplateID:"native-pirate",runtimeStatus:"accepted",
  objectiveMode:"dungeon",objectiveCompleted:true,
  rewards:{isk,bonusIsk:bonus,loyaltyPoints:lp}};
 const corporationID=1000123;
 const record={missionSequence:11,agentID:agent,contentID:9000,
  missionTemplateID:"native-pirate",runtimeStatus:"completed"};
 const oldJournal={transactionID:200,referenceID:7,entryTypeID:3,
  ownerID1:1000000,ownerID2:char,amount:1,balance:1000001};
 const newJournal={transactionID:201,referenceID:agent,entryTypeID:3,
  ownerID1:corporationID,ownerID2:char,amount:actualIsk,
  balance:1000000+actualIsk,description:"Agent mission reward: native-pirate"};
 let now={wallet:1000000,lp:1000,journal:[oldJournal],history:[],
  standings:{[agent]:0,[corporationID]:1}};
 const adapters={getWallet:()=>({balance:now.wallet}),
  getJournal:()=>now.journal,
  getLP:()=>now.lp,getAgent:()=>({agentID:agent,corporationID}),
  getMissionState:()=>({history:now.history}),
  getStanding:(characterID,owner)=>now.standings[owner]};
 const get=()=>capture({characterID:char,agentID:agent,...adapters});
 const before=get();
 const pay=()=>{
  now={wallet:1000000+actualIsk,lp:1000+actualLP,
   journal:[newJournal,oldJournal],history:[record],
   standings:{[agent]:0.01,[corporationID]:1.012}};
 };
 const assessNow=(options={})=>assess({before,after:get(),mission,
  characterID:char,agentID:agent,nativeResult:{success:true},
  personalMissionRemaining:null,...options});
 return {mission,record,newJournal,oldJournal,before,pay,get,assessNow,
  adapters,now:()=>now,setNow:v=>{now=v},agent,char,corporationID};
}
test("original ISK journal + exact balance + issuer LP + personal mission history verifies one recipient",()=>{
 const f=fixture();f.pay();
 const r=f.assessNow();
 assert.equal(r.status,"NATIVE_PERSONAL_REWARD_SOURCE_VERIFIED");
 assert.equal(r.characterID,101);assert.equal(r.missionSequence,11);
 assert.equal(r.originalMissionJournalTransactionID,201);
 assert.equal(r.iskDelta,120000);assert.equal(r.lpDelta,250);
 assert.equal(r.historyAdded,true);
 assert.equal(r.itemsVerified,false);
 assert.equal(r.standingMutationReceiptVerified,false);
 assert.equal(r.standings.length,2);
});
test("native bonus ISK is permitted only as the original exact base+bonus reward",()=>{
 const f=fixture({actualIsk:160000});f.pay();
 assert.equal(f.assessNow().iskDelta,160000);
});
test("personal native mission deletion without genuine history does not prove reward",()=>{
 const f=fixture();f.pay();
 const now=f.now();now.history=[];
 assert.equal(f.assessNow().status,"PERSONAL_NATIVE_MISSION_HISTORY_NOT_NEW");
});
test("pre-existing mission history cannot be re-used for a second payout",()=>{
 const f=fixture();f.pay();
 const after=f.get();
 const before={...f.before,history:[{...f.record}]};
 const r=f.assessNow({before,after});
 assert.equal(r.status,"PERSONAL_NATIVE_MISSION_HISTORY_NOT_NEW");
});
test("wrong character, agent, corporation or unacknowledged native completion is denied",()=>{
 const f=fixture();f.pay();
 for(const overrides of [{characterID:102},{agentID:51},
  {nativeResult:{success:false}},{personalMissionRemaining:{}},
  {after:{...f.get(),corporationID:99}}]){
  assert.notEqual(f.assessNow(overrides).status,"NATIVE_PERSONAL_REWARD_SOURCE_VERIFIED");
 }
});
test("another wallet journal entry for a different agent cannot count as this mission",()=>{
 const f=fixture();f.pay();
 f.newJournal.referenceID=51;
 assert.equal(f.assessNow().status,"NATIVE_ISK_MISSION_JOURNAL_NOT_UNIQUE");
});
test("duplicate same-agent journal entries deny proof even if wallet delta matches",()=>{
 const f=fixture();f.pay();
 f.now().journal.push({...f.newJournal,transactionID:202});
 assert.equal(f.assessNow().status,"NATIVE_ISK_MISSION_JOURNAL_NOT_UNIQUE");
});
test("wallet balance or source journal amount mismatch fails closed",()=>{
 const f=fixture();f.pay();
 f.now().wallet+=10;
 assert.equal(f.assessNow().status,"NATIVE_ISK_LEDGER_BALANCE_MISMATCH");
 const g=fixture({actualIsk:450000});g.pay();
 assert.equal(g.assessNow().status,"NATIVE_ISK_REWARD_AMOUNT_MISMATCH");
});
test("missing or wrong issuer LP ledger delta blocks full personal verification",()=>{
 for(const actualLP of [0,200,500]){
  const f=fixture({actualLP});f.pay();
  assert.equal(f.assessNow().status,"NATIVE_LP_BALANCE_MISMATCH");
 }
});
test("zero LP reward is valid only when native issuer LP stays unchanged",()=>{
 const f=fixture({lp:0,actualLP:0});f.pay();
 assert.equal(f.assessNow().lpDelta,0);
});
test("unrelated standing changes are not mission proof; unreadable original agent standings deny evidence",()=>{
 const f=fixture();f.pay();f.now().standings[9000]=2;
 assert.equal(f.assessNow().status,"NATIVE_PERSONAL_REWARD_SOURCE_VERIFIED");
 const g=fixture();const broken={...g.adapters,getStanding:()=>NaN};
 assert.equal(capture({characterID:101,agentID:50,...broken}).status,
  "REWARD_STANDING_SOURCE_UNAVAILABLE");
});
test("missing balance, incomplete LP source or duplicate journal IDs fail before native grant",()=>{
 const f=fixture();
 assert.equal(capture({characterID:101,agentID:50,...f.adapters,
  getWallet:()=>null}).status,"REWARD_NATIVE_SNAPSHOT_UNAVAILABLE");
 assert.equal(capture({characterID:101,agentID:50,...f.adapters,
  getLP:()=>undefined}).status,"REWARD_NATIVE_SNAPSHOT_UNAVAILABLE");
 assert.equal(capture({characterID:101,agentID:50,...f.adapters,
  getJournal:()=>[{transactionID:4},{transactionID:4}]}).status,
  "REWARD_NATIVE_JOURNAL_AMBIGUOUS");
});
test("mission completion response alone never proves money without actual native source deltas",()=>{
 const f=fixture();
 assert.notEqual(f.assessNow().status,"NATIVE_PERSONAL_REWARD_SOURCE_VERIFIED");
});
test("two different native characters remain independent recipients",()=>{
 const a=fixture({char:101,actualIsk:120000}),b=fixture({char:102,actualIsk:160000});
 a.pay();b.pay();
 assert.equal(a.assessNow().characterID,101);
 assert.equal(b.assessNow().characterID,102);
 assert.notEqual(a.assessNow().originalMissionJournalTransactionID,null);
});

test("native agent lookup must resolve exact requested agent, not some other corporation",()=>{
 const f=fixture();
 const wrong={...f.adapters,getAgent:()=>({agentID:51,corporationID:1000123})};
 assert.equal(capture({characterID:101,agentID:50,...wrong}).status,
  "REWARD_AGENT_CORPORATION_UNKNOWN");
});

import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {reconcileNativeIntents,nativeOutcomeMatches}=require("../scripts/alife-audit.cjs");
const t0="2026-10-25T18:00:00.000Z",t1="2026-10-25T18:00:30.000Z",t2="2026-10-25T18:01:00.000Z";
const intent=(stage="BUY_SUPPLIES",opts={})=>({
 event:"alife-economy-intent",at:t0,intentID:"30000144:1:501:"+stage,
 pilotID:"coop-pilot-003",entityID:501,systemID:30000144,stationID:60003760,
 stage,proof:"NATIVE_READ_ONLY",nativeMutation:false,...opts
});
const buy=(opts={})=>({
 event:"living-native-market-trade",at:t1,pilotID:"coop-pilot-003",
 entityID:501,systemID:30000144,stationID:60003760,
 status:"TRADE_SETTLED",side:"buy",typeID:35,quantity:5,
 cargoID:9002,marketOrderID:"12345678901234567890",
 marketRPCAcknowledged:true,nativeCargoVerified:true,npcLedgerOnly:true,
 buyReceipt:{cargoID:9002,stationID:60003760,typeID:35,quantity:5},...opts
});
const loaded=(opts={})=>({
 event:"living-npc-earned-rearm",at:t2,pilotID:"coop-pilot-003",
 entityID:501,systemID:30000144,status:"NATIVE_NPC_CHARGE_LOADED",
 cargoID:9002,moduleID:6001,typeID:35,quantity:5,
 nativeModuleVisible:true,iskGranted:false,cargoItemsCreated:0,...opts
});
test("authoritative NPC buy settles with exact existing seeded-market and cargo receipt",()=>{
 const result=reconcileNativeIntents([intent(),buy()]);
 assert.equal(result.status,"ALL_SUPPORTED_INTENTS_HAVE_NATIVE_EVIDENCE");
 assert.equal(result.matched,1);
 assert.equal(result.results[0].proof.cargoID,9002);
 assert.equal(result.results[0].proof.marketOrderID,"12345678901234567890");
});
test("native fitted-charge outcome is a separate valid resupply proof",()=>{
 const r=reconcileNativeIntents([intent("RESUPPLY"),loaded()]);
 assert.equal(r.results[0].status,"NATIVE_OUTCOME_OBSERVED");
 assert.equal(r.results[0].proof.event,"living-npc-earned-rearm");
});
test("mere purchase never proves the ammunition was loaded into weapon",()=>{
 const r=reconcileNativeIntents([intent("RESUPPLY"),buy()]);
 assert.equal(r.results[0].status,"NO_AUTHORITATIVE_ACT_PROOF");
 assert.equal(r.matched,0);
});
test("sell does not satisfy buy intent, nor does queued/ambiguous RPC",()=>{
 for(const result of [buy({side:"sell"}),buy({status:"RPC_OUTCOME_UNKNOWN"}),
  buy({marketRPCAcknowledged:false}),buy({nativeCargoVerified:false}),
  buy({npcLedgerOnly:false}),buy({buyReceipt:null}),
  buy({buyReceipt:{cargoID:9002,stationID:1,typeID:35,quantity:5}})]){
  assert.equal(reconcileNativeIntents([intent(),result]).matched,0);
 }
});
test("NPC IDs, systems and stations must match; no cross-NPC value settlement",()=>{
 for(const outcome of [buy({pilotID:"coop-pilot-005"}),buy({entityID:502}),
  buy({systemID:30000142}),buy({stationID:60003761})]){
  assert.equal(reconcileNativeIntents([intent(),outcome]).matched,0);
 }
});
test("outcome before intent or older than bounded window cannot satisfy intent",()=>{
 for(const after of ["2026-10-25T17:59:59.000Z","2026-10-25T18:12:00.000Z"]){
  assert.equal(reconcileNativeIntents([intent(),buy({at:after})]).matched,0);
 }
 assert.equal(reconcileNativeIntents([intent(),buy()],{windowMs:1000}).matched,0);
});
test("one native receipt may not settle two identical intentions",()=>{
 const result=reconcileNativeIntents([
  intent("BUY_SUPPLIES",{intentID:"one"}),intent("BUY_SUPPLIES",{intentID:"two"}),
  buy()
 ]);
 assert.equal(result.matched,1);
 assert.equal(result.counts.NO_AUTHORITATIVE_ACT_PROOF,1);
});
test("non-reconciled manufacturing, hauling and mining stages remain openly unproven",()=>{
 for(const stage of ["MINE","HAUL","DELIVER","REFINE","MANUFACTURE","COMPLETE_JOB",
  "LIST_OUTPUT"]){
  const r=reconcileNativeIntents([intent(stage),buy()]);
  assert.equal(r.results[0].status,"INTENT_NOT_CONNECTED_TO_ACT",stage);
 }
});
test("a reported intent never counts if provenance is forged, even with real native outcome",()=>{
 for(const raw of [intent("BUY_SUPPLIES",{nativeMutation:true}),
  intent("BUY_SUPPLIES",{pilotID:"player-1"}),
  intent("BUY_SUPPLIES",{entityID:-1}),
  intent("BUY_SUPPLIES",{proof:"USER_REPORTED"}),
  intent("BUY_SUPPLIES",{at:"invalid"})]){
  const r=reconcileNativeIntents([raw,buy()]);
  assert.equal(r.results[0].status,"INVALID_INTENT_IDENTITY");
 }
});
test("bounded read-only reconciliation rejects invalid limits and excessive inputs",()=>{
 assert.equal(reconcileNativeIntents(null).status,"INVALID_RECONCILIATION_INPUT");
 assert.equal(reconcileNativeIntents([],{windowMs:-1}).status,"INVALID_RECONCILIATION_INPUT");
 assert.equal(reconcileNativeIntents([],{maxIntents:0}).status,"INVALID_RECONCILIATION_INPUT");
 assert.equal(reconcileNativeIntents([intent(),intent()],{maxIntents:1}).status,"INTENT_LIMIT_EXCEEDED");
});

test("duplicated native event rows for one market receipt cannot satisfy repeated intents",()=>{
 const result=reconcileNativeIntents([
  intent("BUY_SUPPLIES",{intentID:"first"}),
  intent("BUY_SUPPLIES",{intentID:"second"}),
  buy({at:t1}),buy({at:t2})
 ]);
 assert.equal(result.matched,1,"two log rows for the same native receipt are not two actions");
 assert.equal(result.counts.NO_AUTHORITATIVE_ACT_PROOF,1);
});
test("a forged market order ID never counts as native settled evidence",()=>{
 for(const order of ["0","-9","not-an-order","10.5",""]){
  const result=reconcileNativeIntents([intent(),buy({marketOrderID:order})]);
  assert.equal(result.matched,0);
 }
});

test("empty telemetry never produces a false all-settled status",()=>{
 const r=reconcileNativeIntents([]);
 assert.equal(r.status,"NO_ALIFE_INTENTS_OBSERVED");
 assert.equal(r.matched,0);
});

test("the actual A-Life observer numeric epoch-millisecond timestamp matches native ISO outcome",()=>{
 const at=Date.parse(t0);
 const realObserver={...intent(),at};
 const result=reconcileNativeIntents([realObserver,buy()]);
 assert.equal(result.matched,1);
 assert.equal(result.results[0].status,"NATIVE_OUTCOME_OBSERVED");
});
test("bad or second-based numeric chronology cannot fabricate a native outcome",()=>{
 for(const at of [Date.parse(t0)/1000,NaN,0,-1,9999999999999]){
  const result=reconcileNativeIntents([intent("BUY_SUPPLIES",{at}),buy()]);
  assert.equal(result.results[0].status,"INVALID_INTENT_IDENTITY");
 }
});

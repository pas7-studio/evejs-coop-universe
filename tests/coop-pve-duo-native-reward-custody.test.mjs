import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {snapshot,verify}=require("../integration/coopPveDuoNativeRewardCustody.cjs");
function fixture({base=100000,bonus=30000,items=[{typeID:9001,quantity:2}],
 bonusItems=[],originalStacks=[],standingChange=true}={}){
 const char=101,agentID=50,corp=1000123,station=60001234,flag=4;
 const mission={agentID,missionSequence:11,contentID:"pirate-site",
  missionTemplateID:"native-pirate",dropoffLocation:{locationID:station},
  rewards:{isk:base,bonusIsk:bonus,itemRewards:items,bonusItemRewards:bonusItems}};
 const event={fromID:corp,toID:char,eventTypeID:73,
  eventDateTime:"134999999999999999",modification:.015,msg:"Pirate site completed",
  int_1:null,int_2:null,int_3:null};
 const older={...event,eventDateTime:"133000000000000000",modification:.004};
 let now={items:originalStacks.map(x=>({...x})),standing:standingChange?[older]:[]};
 const changes=standingChange?[{ownerID:corp,eventTypeID:73,rawChange:.01}]:[];
 const adapters={getAgent:()=>({agentID,corporationID:corp,stationID:station}),
  getItems:()=>now.items,getStandingRows:()=>now.standing,
  getChanges:()=>changes,getHangarFlag:()=>flag};
 const capture=()=>snapshot({characterID:char,agentID,mission,...adapters});
 const before=capture();
 const credit=(withBonus=false)=>{
  const all=[...items,...(withBonus?bonusItems:[])];
  for(const row of all){
   const stack=now.items.find(x=>x.typeID===row.typeID);
   if(stack)stack.stacksize+=row.quantity;
   else now.items.push({itemID:7000+row.typeID,typeID:row.typeID,
    ownerID:char,locationID:station,flagID:flag,stacksize:row.quantity,
    singleton:0});
  }
  if(standingChange)now.standing=[event,...now.standing];
 };
 const report=(opts={})=>verify({before,after:capture(),mission,
  characterID:char,agentID,personalReward:{
   status:"NATIVE_PERSONAL_REWARD_SOURCE_VERIFIED",
   characterID:char,agentID,missionSequence:11,
   iskDelta:base,...opts}});
 return {before,adapters,capture,credit,report,mission,now:()=>now,
  event,older,char,corp,agentID,station,flag};
}
test("an actual original native station hangar grant and standing event confirm personal reward",()=>{
 const f=fixture();f.credit();
 const r=f.report();
 assert.equal(r.status,"NATIVE_PERSONAL_REWARD_CUSTODY_VERIFIED");
 assert.equal(r.itemCount,2);assert.deepEqual(r.newItemIDs,[16001]);
 assert.equal(r.originalStandingTransactions.length,1);
 assert.equal(r.originalStandingTransactions[0].eventTypeID,73);
});
test("existing stack increment counts as real item custody without creating a new item ID",()=>{
 const f=fixture({originalStacks:[{itemID:8001,typeID:9001,ownerID:101,
  locationID:60001234,flagID:4,stacksize:3,singleton:0}]});f.credit();
 const r=f.report();
 assert.equal(r.status,"NATIVE_PERSONAL_REWARD_CUSTODY_VERIFIED");
 assert.deepEqual(r.newItemIDs,[]);
 assert.equal(r.expectedTypes[0].quantity,2);
});
test("native bonus inventory is required only for actual original base-plus-bonus payout",()=>{
 const f=fixture({bonusItems:[{typeID:9200,quantity:1}]});
 f.credit(true);
 assert.equal(f.report({iskDelta:130000}).status,"NATIVE_PERSONAL_REWARD_CUSTODY_VERIFIED");
 assert.equal(f.report({iskDelta:100000}).status,"NATIVE_REWARD_ITEM_CUSTODY_MISMATCH");
});
test("no item rewards or standing changes is a valid empty original custody receipt",()=>{
 const f=fixture({items:[],bonusItems:[],standingChange:false});
 assert.equal(f.report().status,"NATIVE_PERSONAL_REWARD_CUSTODY_VERIFIED");
 assert.equal(f.report().itemCount,0);
 assert.equal(f.report().originalStandingTransactions.length,0);
});
test("native mission complete but item absent cannot be promoted to custody",()=>{
 const f=fixture();const r=f.report();
 assert.equal(r.status,"NATIVE_REWARD_ITEM_CUSTODY_MISMATCH");
});
test("wrong station, owner, hangar flag or type is denied",()=>{
 const edits=[
  f=>{f.now().items[0].ownerID=102},
  f=>{f.now().items[0].locationID=60000000},
  f=>{f.now().items[0].flagID=5},
  f=>{f.now().items[0].typeID=9999}
 ];
 for(const edit of edits){
  const f=fixture();f.credit();edit(f);
  assert.notEqual(f.report().status,"NATIVE_PERSONAL_REWARD_CUSTODY_VERIFIED");
 }
});
test("original standing transaction must be new with correct event type",()=>{
 const f=fixture();f.credit();
 f.now().standing[0].eventTypeID=74;
 assert.equal(f.report().status,"NATIVE_PERSONAL_STANDING_TRANSACTION_UNVERIFIED");
});
test("opposite-sign original standing receipt cannot certify mission reputation gain",()=>{
 const f=fixture();f.credit();
 f.now().standing[0].modification=-0.015;
 assert.equal(f.report().status,"NATIVE_PERSONAL_STANDING_TRANSACTION_UNVERIFIED");
});
test("stale standing history or unchanged raw value alone cannot replace actual mission receipt",()=>{
 const f=fixture();f.credit();
 f.now().standing=[f.older];
 assert.equal(f.report().status,"NATIVE_PERSONAL_STANDING_TRANSACTION_UNVERIFIED");
});
test("duplicate native standing event is ambiguous, do not claim one reward",()=>{
 const f=fixture();f.credit();
 f.now().standing.unshift({...f.event});
 assert.equal(f.report().status,"NATIVE_PERSONAL_STANDING_TRANSACTION_UNVERIFIED");
});
test("wrong character, agent, mission or unverifiable upstream wallet LP cannot pass",()=>{
 const f=fixture();f.credit();
 for(const o of [{characterID:102},{agentID:51},
  {personalReward:{status:"UNVERIFIED"}},{mission:{...f.mission,missionSequence:12}}])
  assert.notEqual(verify({before:f.before,after:f.capture(),mission:f.mission,
   characterID:101,agentID:50,personalReward:{status:"NATIVE_PERSONAL_REWARD_SOURCE_VERIFIED",
    characterID:101,agentID:50,missionSequence:11,iskDelta:100000},
   ...o}).status,"NATIVE_PERSONAL_REWARD_CUSTODY_VERIFIED");
});
test("duplicate or reused native item IDs are fail closed",()=>{
 const f=fixture();f.credit();
 f.now().items.push({...f.now().items[0]});
 assert.equal(f.report().status,"NATIVE_PERSONAL_CUSTODY_IDENTITY_MISMATCH");
});
test("numeric and decimal-string forms of an original item ID cannot evade duplicate detection",()=>{
 const f=fixture({originalStacks:[
  {itemID:8201,typeID:9001,ownerID:101,locationID:60001234,flagID:4,stacksize:1},
  {itemID:"8201",typeID:9001,ownerID:101,locationID:60001234,flagID:4,stacksize:1}
 ]});
 assert.equal(f.before.status,"NATIVE_HANGAR_SOURCE_UNAVAILABLE");
});
test("native stack repr change cannot forge a second new reward item ID",()=>{
 const f=fixture({originalStacks:[{itemID:8001,typeID:9001,ownerID:101,
  locationID:60001234,flagID:4,stacksize:3,singleton:0}]});
 f.credit();
 f.now().items[0].itemID="8001";
 f.now().items[0].typeID="9001";
 const r=f.report();
 assert.equal(r.status,"NATIVE_PERSONAL_REWARD_CUSTODY_VERIFIED");
 assert.deepEqual(r.newItemIDs,[]);
});
test("native reward receiver is not another agent or issuer corporation",()=>{
 const f=fixture();
 const wrong={...f.adapters,getAgent:()=>({agentID:51,corporationID:1000123})};
 assert.equal(snapshot({characterID:101,agentID:50,mission:f.mission,...wrong}).status,
  "NATIVE_CUSTODY_AGENT_UNVERIFIED");
});
test("two different recipients can prove original personal hangar and standing independently",()=>{
 const a=fixture(),b=fixture();a.credit();b.credit();
 const bReport=verify({before:b.before,after:b.capture(),
  mission:b.mission,characterID:102,agentID:50,personalReward:{
   status:"NATIVE_PERSONAL_REWARD_SOURCE_VERIFIED",
   characterID:102,agentID:50,missionSequence:11,iskDelta:100000}});
 assert.equal(a.report().status,"NATIVE_PERSONAL_REWARD_CUSTODY_VERIFIED");
 assert.equal(bReport.status,"NATIVE_PERSONAL_CUSTODY_IDENTITY_MISMATCH");
});

test("untimed bonus-only native item rewards with zero bonus ISK are still actual item custody",()=>{
 const f=fixture({base:100000,bonus:0,items:[],
  bonusItems:[{typeID:9301,quantity:2}],standingChange:false});
 f.credit(true);
 const r=f.report({iskDelta:100000});
 assert.equal(r.status,"NATIVE_PERSONAL_REWARD_CUSTODY_VERIFIED");
 assert.equal(r.itemCount,2);
 assert.equal(r.expectedTypes[0].typeID,9301);
});
test("timed zero-ISK bonus item availability is ambiguous from wallet receipt and fails closed",()=>{
 const f=fixture({base:100000,bonus:0,items:[],
  bonusItems:[{typeID:9301,quantity:1}],standingChange:false});
 f.mission.rewards.bonusTimeIntervalMinutes=12;
 f.credit(true);
 assert.equal(f.report({iskDelta:100000}).status,
  "NATIVE_ITEM_REWARD_CONFIGURATION_UNSUPPORTED");
});

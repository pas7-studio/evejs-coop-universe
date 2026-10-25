import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {specs,transform}=require("../scripts/patch-evejs-coop.cjs");
const party=require("../integration/coopNativeFleetParty.cjs");
const tradeSafety=require("../integration/coopFleetTradeSafety.cjs");
const missionTurnin=require("../integration/coopFleetMissionTurnin.cjs");

function pinned(name){
 const root=process.env.EVEJS_COOP_CODE_PATH;
 if(!root)return null;
 const relative="server/src/services/"+name;
 const spec=specs.find(x=>x.file===relative);
 assert.ok(spec,"Missing anchored native integration: "+relative);
 const from=fs.readFileSync(path.join(root,relative),"utf8");
 const baseline=transform(from,spec,true),patched=transform(baseline,spec,false);
 assert.ok(from===baseline||from===patched,
  "EveJS source has unexpected native code compared with pinned overlay");
 assert.equal(transform(patched,spec,true),baseline);
 assert.equal(transform(patched,spec,false),patched);
 new vm.Script(patched);
 return patched;
}
function memberFixtures(){
 const alice={characterID:101,activeShipID:801,socket:{destroyed:false}};
 const bob={characterID:102,activeShipID:802,socket:{destroyed:false}};
 const fleet={fleetID:33,members:new Map([[101,{charID:101}],[102,{charID:102}]])};
 const fleetRuntime={
  getFleetForCharacter:id=>fleet.members.has(id)?fleet:null,
  getMemberRecord:(f,id)=>f.members.get(id)||null
 };
 const station=()=>60000111;
 return {alice,bob,fleet,fleetRuntime,station};
}
function method(source,name,next){
 const start=source.indexOf("  "+name+"(");
 const finish=source.indexOf("\n  "+next+"(",start);
 assert.ok(start>0&&finish>start,name+" native method absent");
 return source.slice(start,finish).trim();
}
test("native agent completion hook credits both distinct accepted completed objectives",t=>{
 const native=pinned("agent/agentMgrService.js");
 if(!native){t.skip("No pinned Code checkout: EVEJS_COOP_CODE_PATH");return;}
 const f=memberFixtures(),journal=new Map([
  [101,{agentID:99,contentID:7001,missionTemplateID:"encounter",
   missionSequence:500,objectiveMode:"dungeon",runtimeStatus:"accepted",
   objectiveCompleted:true,gmCompleted:false}],
  [102,{agentID:99,contentID:7001,missionTemplateID:"encounter",
   missionSequence:501,objectiveMode:"dungeon",runtimeStatus:"accepted",
   objectiveCompleted:true,gmCompleted:false}]
 ]),completion=[];
 const missionRuntime={
  getMissionRecord:(id,agent)=>agent===99&&journal.has(id)?
   {...journal.get(id)}:null,
  doAgentAction:(id,agent,action)=>{
   if(!journal.has(id)||agent!==99||![6,7].includes(Number(action)))
    return {success:true,data:{actions:[]}};
   journal.delete(id);completion.push(id);
   return {success:true,data:{actions:[]}};
  }
 };
 const warnings=[];
 const resolve=id=>{
  if(id==="../../space/coopFleetMissionTurnin")return missionTurnin;
  if(id==="../../space/coopNativeFleetParty")return party;
  if(id==="../../space/coopRuntimeProbe")return {observe:()=>{}};
  if(id==="../fleets/fleetRuntime")return f.fleetRuntime;
  if(id==="../chat/sessionRegistry")return {getSessions:()=>[f.alice,f.bob]};
  if(id==="../structure/structureLocation")return {
   getDockedLocationID:f.station};
  throw Error("Unexpected native agent dependency: "+id);
 };
 const patchedMethod=method(native,"Handle_DoAction","Handle_GetMissionBriefingInfo");
 const handle=new Function("require","agentMissionRuntime","normalizePositiveInteger",
  "buildDoActionResponsePayload","console",
  "return ({"+patchedMethod+"}).Handle_DoAction")(
   resolve,missionRuntime,x=>Number(x)||0,x=>x,
   {warn:(...args)=>warnings.push(args)});
 const svc={_resolveBoundAgentID:()=>99};
 const result=handle.call(svc,[6],f.alice);
 assert.equal(result.success,true);
 assert.deepEqual(completion,[101,102]);
 assert.equal(journal.size,0);
 assert.deepEqual(warnings,[]);
 // A second identical RPC has no accepted native mission to complete.
 handle.call(svc,[6],f.alice);
 assert.deepEqual(completion,[101,102]);
});
test("native incomplete peer objective stays open after leader turns in",t=>{
 const native=pinned("agent/agentMgrService.js");
 if(!native){t.skip("No pinned checkout");return;}
 const f=memberFixtures(),journal=new Map([
  [101,{agentID:99,contentID:7001,missionTemplateID:"encounter",
   missionSequence:500,objectiveMode:"dungeon",runtimeStatus:"accepted",
   objectiveCompleted:true,gmCompleted:false}],
  [102,{agentID:99,contentID:7001,missionTemplateID:"encounter",
   missionSequence:501,objectiveMode:"dungeon",runtimeStatus:"accepted",
   objectiveCompleted:false,gmCompleted:false}]
 ]),completion=[];
 const rt={getMissionRecord:(id,agent)=>journal.get(id)?{...journal.get(id)}:null,
  doAgentAction:(id,agent,action)=>{
   if(journal.get(id)?.objectiveCompleted===true){
    journal.delete(id);completion.push(id);
   }
   return {success:true};
  }};
 const req=id=>id==="../../space/coopFleetMissionTurnin"?missionTurnin:
  id==="../../space/coopNativeFleetParty"?party:
  id==="../fleets/fleetRuntime"?f.fleetRuntime:
  id==="../chat/sessionRegistry"?{getSessions:()=>[f.alice,f.bob]}:
  id==="../structure/structureLocation"?{getDockedLocationID:f.station}:
  id==="../../space/coopRuntimeProbe"?{observe:()=>{}}:(()=>{throw Error(id)})();
 const handle=new Function("require","agentMissionRuntime","normalizePositiveInteger",
  "buildDoActionResponsePayload",
  "return ({"+method(native,"Handle_DoAction","Handle_GetMissionBriefingInfo")+
  "}).Handle_DoAction")(req,rt,x=>Number(x)||0,x=>x);
 handle.call({_resolveBoundAgentID:()=>99},[6],f.alice);
 assert.deepEqual(completion,[101]);
 assert.equal(journal.has(102),true);
});
test("stock EveJS direct fleet gift checks native preflight before any ISK/item commit",t=>{
 const native=pinned("trade/tradeMgrService.js");
 if(!native){t.skip("No pinned checkout");return;}
 const f=memberFixtures();
 const root={itemID:70001,ownerID:101,typeID:670,
  locationID:910000000001};
 let sentMoney=0,sentItems=0;
 const trade={status:"open",traders:[101,102],
  tradeContainerID:910000000001,dockedLocationID:60000111,
  moneyOffers:[0,0],offerStates:[1,0],offerManifests:[{},null],
  stagedItemOrigins:new Map()};
 const nativeSvc={
  _resolveTradeContext:()=>({trade,participantIndex:1}),
  _ensureAllParticipantsStillValid:()=>true,
  _parseManifest:()=>({tradeContainerID:trade.tradeContainerID,
   money:trade.moneyOffers.slice(),tradeItems:new Set([70001])}),
  _listTradeItems:()=>[root],
  _getParticipantSession:()=>f.bob,
  _collectContainedItems:()=>[],
  _buildOfferManifestPayload:()=>({items:[70001]}),
  _buildTradeItemsSetPayload:()=>({items:[70001]}),
  _completeMoneyTransfer:()=>{sentMoney++;return {success:true}},
  _completeItemTransfers:()=>{sentItems++;return {success:true,data:{changes:[]}}},
  _notifyTradeCompletionItemChanges:()=>{},
  _cleanupTradeIndex:()=>{},_scheduleTradeCleanup:()=>{},
  _notifyParticipants:()=>{},
  _resetOfferState:()=>{trade.offerStates=[0,0];trade.offerManifests=[null,null]},
  _throwTradeError:msg=>{throw Error(msg)}
 };
 const req=id=>id==="../fleets/fleetRuntime"?f.fleetRuntime:
  id==="../../space/coopNativeFleetParty"?party:
  id==="../../space/coopFleetTradeSafety"?tradeSafety:(()=>{throw Error(id)})();
 const handle=new Function("require","process","findItemById",
  "isTradableInventoryItem","getDockedLocationID","normalizeNumber",
  "setsEqual","buildList","return ({"+
    method(native,"Handle_MakeOffer","Handle_Abort")+
    "}).Handle_MakeOffer")(
  req,{env:{EVEJS_COOP_FLEET_TRADE_SAFETY:"1"}},
  id=>id===70001?root:null,()=>true,f.station,Number,
  (a,b)=>a.size===b.size&&[...a].every(x=>b.has(x)),x=>x);
 // Buyer (peer) is the final accepting participant.
 const ok=handle.call(nativeSvc,[],f.bob);
 assert.equal(ok,true);
 assert.equal(sentMoney,1);assert.equal(sentItems,1);
 // A compromised/stale ship offer is blocked before any native transfer.
 trade.status="open";trade.offerStates=[1,0];trade.offerManifests=[{},null];
 trade.moneyOffers=[1,0];sentMoney=0;sentItems=0;
 assert.throws(()=>handle.call(nativeSvc,[],f.bob),/MIXED_MONEY_TRADE_NOT_ATOMIC/);
 assert.equal(sentMoney,0);assert.equal(sentItems,0);
});

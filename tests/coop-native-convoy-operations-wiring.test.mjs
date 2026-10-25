import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
function nativeModule(name,mocks,env){
 const file=readFileSync(new URL("../integration/"+name+".cjs",import.meta.url),"utf8");
 const module={exports:{}};
 const sandbox={
  require:id=>{if(!(id in mocks))throw Error("Unplanned native dependency "+id);return mocks[id]},
  module,exports:module.exports,process:{env},console:{warn(){}}
 };
 vm.runInNewContext(file,sandbox,{filename:name+".cjs"});
 return module.exports;
}
function scene(){
 const pirate={itemID:900,kind:"ship",nativeNpc:true,position:{x:0,y:0,z:0}};
 const hauler={itemID:901,kind:"ship",nativeNpc:true,position:{x:1000,y:0,z:0}};
 const a={itemID:1001,kind:"ship",position:{x:5,y:0,z:0}};
 const b={itemID:1002,kind:"ship",position:{x:10,y:0,z:0}};
 const sessions=[
  {characterID:11,socket:{destroyed:false},_space:{shipID:1001,systemID:30000144,initialStateSent:true}},
  {characterID:22,socket:{destroyed:false},_space:{shipID:1002,systemID:30000144,initialStateSent:true}}
 ];
 const map=new Map([[900,pirate],[901,hauler],[1001,a],[1002,b]]);
 return {scene:{systemID:30000144,sessions:new Map(sessions.map(s=>[s.characterID,s])),
  getEntityByID:id=>map.get(id),dynamicEntities:new Map()},sessions,a,b,pirate,hauler};
}
test("actual native raid messages create one incident event and deliver to both connected clients",()=>{
 const f=scene(),recorded=[],messages=[];
 const mod=nativeModule("coopWorldSignals",{
  "./coopDuoRaidTactics":{plan:()=>({roles:new Map()})},
  "./coopConvoyOperations":{noteRaid:(scene,action)=>{recorded.push(action);return {status:"NATIVE_CONVOY_INCIDENT_RECORDED"}}}
 },{EVEJS_COOP_CONVOY_OPERATIONS:"1"});
 const broadcaster=mod.createBroadcaster({
  send:(session,text)=>messages.push({id:session.characterID,text}),
  locate:()=>({name:"Perimeter Belt"}),
  resolveFleetRuntime:()=>({getFleetForCharacter:()=>null,getMemberRecord:()=>null})
 });
 const output=broadcaster.notifyRaid(f.scene,[{pirateID:900,targetID:901,targetRole:"hauler",action:"attack"}]);
 assert.equal(output.sent,2);
 assert.equal(recorded.length,1);
 assert.equal(recorded[0].action,"attack");
 assert.equal(messages.length,2);
 assert.ok(messages.every(m=>m.text.includes("Пірат атакує")));
});
test("default-OFF native convoy operation does not create a durable incident",()=>{
 const f=scene(),calls=[];
 const mod=nativeModule("coopWorldSignals",{
  "./coopDuoRaidTactics":{plan:()=>({roles:new Map()})},
  "./coopConvoyOperations":{noteRaid:()=>{calls.push(1)}}
 },{});
 mod.createBroadcaster({send:()=>{},locate:()=>null,
  resolveFleetRuntime:()=>null}).notifyRaid(f.scene,
  [{pirateID:900,targetID:901,targetRole:"hauler",action:"attack"}]);
 assert.equal(calls.length,0);
});
test("verified native applied damage produces ONE genuine duo message after first settled transition",()=>{
 const f=scene(),calls=[],messages=[];let newly=true;
 const fleet={fleetID:77,members:new Map([[11,{}],[22,{}]])};
 const mod=nativeModule("coopPlayerCombatWitness",{
  "../services/chat/sessionRegistry":{getSessions:()=>f.sessions},
  "./runtime":{getSceneForSession:()=>f.scene},
  "./coopRuntimeProbe":{observe:()=>true},
  "./coopConvoyOperations":{noteDamage:(scene,receipt,fleets)=>{
   calls.push({scene,receipt,fleets});
   const first=newly;newly=false;
   return {newlyConfirmedDuo:first,duoFleetID:77}
  }},
  "../services/fleets/fleetRuntime":{getFleetForCharacter:()=>fleet},
  "../services/chat/chatHub":{sendSystemMessage:(s,text)=>messages.push({id:s.characterID,text})}
 },{EVEJS_COOP_PLAYER_DAMAGE_EVIDENCE:"1",EVEJS_COOP_CONVOY_OPERATIONS:"1"});
 const first=mod.note(f.a,f.pirate,125);
 assert.equal(first.status,"APPLIED_NATIVE_PLAYER_DAMAGE");
 assert.equal(calls.length,1);
 assert.equal(calls[0].receipt.characterID,11);
 assert.deepEqual(messages.map(x=>x.id),[11,22]);
 assert.ok(messages.every(x=>x.text.includes("НЕ виплата нагороди")));
 const again=mod.note(f.a,f.pirate,125);
 assert.equal(again.status,"APPLIED_NATIVE_PLAYER_DAMAGE");
 assert.equal(messages.length,2);
});
test("no successful native witness telemetry means no incident, no player credit and no message",()=>{
 const f=scene(),writes=[],messages=[];
 const mod=nativeModule("coopPlayerCombatWitness",{
  "../services/chat/sessionRegistry":{getSessions:()=>f.sessions},
  "./runtime":{getSceneForSession:()=>f.scene},
  "./coopRuntimeProbe":{observe:()=>false},
  "./coopConvoyOperations":{noteDamage:()=>writes.push("wrong")},
  "../services/fleets/fleetRuntime":{},
  "../services/chat/chatHub":{sendSystemMessage:()=>messages.push("wrong")}
 },{EVEJS_COOP_PLAYER_DAMAGE_EVIDENCE:"1",EVEJS_COOP_CONVOY_OPERATIONS:"1"});
 assert.equal(mod.note(f.a,f.pirate,50).status,"TELEMETRY_NOT_RECORDED");
 assert.equal(writes.length,0);
 assert.equal(messages.length,0);
});

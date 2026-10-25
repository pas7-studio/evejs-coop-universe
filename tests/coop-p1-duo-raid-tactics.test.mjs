import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {plan}=require("../integration/coopDuoRaidTactics.cjs");
const {createBroadcaster}=require("../integration/coopWorldSignals.cjs");
function sceneFixture(){
 const ships=new Map([
  [500,{itemID:500,kind:"ship",position:{x:0,y:0,z:0}}],
  [600,{itemID:600,kind:"ship",position:{x:100000,y:0,z:0}}],
  [9001,{itemID:9001,kind:"ship",position:{x:2000,y:0,z:0}}],
  [9002,{itemID:9002,kind:"ship",position:{x:99000,y:0,z:0}}]
 ]);
 const sessions=new Map([
  [1,{characterID:101,_space:{shipID:9001,systemID:30000144,initialStateSent:true},socket:{destroyed:false}}],
  [2,{characterID:102,_space:{shipID:9002,systemID:30000144,initialStateSent:true},socket:{destroyed:false}}]
 ]);
 return {systemID:30000144,ships,sessions,scene:{systemID:30000144,sessions,getEntityByID:id=>ships.get(id)}};
}
function fleetOf(ids=[101,102]){
 const fleet={members:new Map(ids.map(id=>[id,{characterID:id}]))};
 return {getFleetForCharacter:id=>fleet.members.has(id)?fleet:null,getMemberRecord:(f,id)=>f.members.get(id)||null};
}
const raid={pirateID:500,targetID:600,targetRole:"hauler",action:"attack"};
test("two actual in-space fleet ships get different intercept and escort roles",()=>{
 const {scene}=sceneFixture();const p=plan({scene,raid,fleetRuntime:fleetOf()});
 assert.equal(p.status,"DUO_TACTICS_READY");
 assert.deepEqual(p.roles.get(101),{role:"intercept",targetID:500});
 assert.deepEqual(p.roles.get(102),{role:"escort",targetID:600});
});
test("invalid native ship, third participant, wrong system, disconnection and cross-fleet fail closed",()=>{
 for(const invalid of ["third","wrong-system","disconnected","not-ready","missing-ship","not-same-fleet"]){
  const {scene,sessions,ships}=sceneFixture();
  if(invalid==="third"){
   ships.set(9003,{kind:"ship",position:{x:700,y:0,z:0}});
   sessions.set(3,{characterID:103,_space:{shipID:9003,systemID:30000144,initialStateSent:true}});
  }else if(invalid==="wrong-system")sessions.get(2)._space.systemID=30000142;
  else if(invalid==="disconnected")sessions.get(2).socket.destroyed=true;
  else if(invalid==="not-ready")sessions.get(2)._space.initialStateSent=false;
  else if(invalid==="missing-ship")ships.delete(9002);
  const fleetRuntime=invalid==="not-same-fleet"?{
   getFleetForCharacter:id=>({members:new Map([[id,{}]])}),
   getMemberRecord:(f,id)=>f.members.get(id)||null
  }:fleetOf();
  const result=plan({scene,raid,fleetRuntime});
  assert.notEqual(result.status,"DUO_TACTICS_READY",invalid);
  assert.equal(result.roles.size,0,invalid);
 }
});
test("distance selection reverses roles when pilots change positions",()=>{
 const {scene,ships}=sceneFixture();
 ships.get(9001).position.x=98000;ships.get(9002).position.x=1000;
 const result=plan({scene,raid,fleetRuntime:fleetOf()});
 assert.equal(result.roles.get(102).role,"intercept");
 assert.equal(result.roles.get(101).role,"escort");
});
test("native raid alerts distinguish roles without changing ships or NPC orders",()=>{
 const {scene,ships}=sceneFixture();
 const before=JSON.stringify([...ships.entries()]);
 const delivered=[];
 const broadcaster=createBroadcaster({
  send:(session,message)=>delivered.push({id:session.characterID,message}),
  locate:()=>({name:"Perimeter belt"}),
  clock:()=>1000000,
  resolveFleetRuntime:()=>fleetOf()
 });
 const result=broadcaster.notifyRaid(scene,[raid]);
 assert.equal(result.sent,2);
 assert.equal(delivered.length,2);
 assert.match(delivered.find(x=>x.id===101).message,/ПЕРЕХОПЛЕННЯ/);
 assert.match(delivered.find(x=>x.id===102).message,/ЕСКОРТ/);
 assert.equal(JSON.stringify([...ships.entries()]),before);
 assert.equal(broadcaster.notifyRaid(scene,[raid]).sent,0,"anti-spam cooldown");
});
test("solo and unrelated players keep generic native raid notification",()=>{
 const {scene,sessions}=sceneFixture();
 const messages=[];
 const broadcaster=createBroadcaster({
  send:(session,message)=>messages.push(message),
  locate:()=>null,clock:()=>1000000,
  resolveFleetRuntime:()=>({getFleetForCharacter:()=>null,getMemberRecord:()=>null})
 });
 assert.equal(broadcaster.notifyRaid(scene,[raid]).sent,2);
 assert.equal(messages.every(m=>!m.includes("ПЕРЕХОПЛЕННЯ")&&!m.includes("ЕСКОРТ")),true);
 sessions.delete(2);
 const solo=[];
 const one=createBroadcaster({
  send:(session,message)=>solo.push(message),
  locate:()=>null,clock:()=>1000000,resolveFleetRuntime:()=>fleetOf()
 });
 assert.equal(one.notifyRaid(scene,[raid]).sent,1);
 assert.equal(solo.every(m=>!m.includes("ПЕРЕХОПЛЕННЯ")&&!m.includes("ЕСКОРТ")),true);
});

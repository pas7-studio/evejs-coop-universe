import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createBroadcaster}=require("../integration/coopWorldSignals.cjs");
function scene(){
 const members=new Map([
  [101,{characterID:101,_space:{shipID:9001,systemID:30000144,initialStateSent:true}}],
  [102,{characterID:102,_space:{shipID:9002,systemID:30000144,initialStateSent:true}}]]);
 const ships=new Map([
  [9001,{itemID:9001,kind:"ship",position:{x:0,y:0,z:0}}],
  [9002,{itemID:9002,kind:"ship",position:{x:1,y:0,z:0}}],
  [6001,{itemID:6001,kind:"ship",position:{x:600,y:0,z:0}}],
  [6101,{itemID:6101,kind:"ship",position:{x:620,y:0,z:0}}]]);
 return {systemID:30000144,sessions:members,getEntityByID:id=>ships.get(id)||null};
}
const raid=[{action:"attack",pirateID:6001,targetID:6101,targetRole:"hauler"}];
test("only a real native NPC raid can tell players about an actionable /coopops operation",()=>{
 const old=process.env.EVEJS_COOP_P1_OPERATIONS;
 try{
  process.env.EVEJS_COOP_P1_OPERATIONS="1";
  const messages=[];
  const broadcaster=createBroadcaster({clock:()=>100000,
   send:(session,message)=>messages.push({char:session.characterID,message}),
   locate:()=>({name:"Perimeter belt"})});
  const s=scene();
  const result=broadcaster.notifyRaid(s,raid);
  assert.equal(result.status,"NATIVE_RAID_NOTIFIED");
  assert.equal(messages.length,2);
  for(const row of messages){
   assert.match(row.message,/Пірат атакує/);
   assert.match(row.message,/\/coopops status/);
   assert.match(row.message,/Perimeter belt/);
  }
  assert.equal(broadcaster.notifyRaid(s,raid).sent,0,"no duplicate spam inside cooldown");
 }finally{
  if(old===undefined)delete process.env.EVEJS_COOP_P1_OPERATIONS;
  else process.env.EVEJS_COOP_P1_OPERATIONS=old;
 }
});
test("P1 flag off retains original raid notice and never advertises uninstalled command",()=>{
 const old=process.env.EVEJS_COOP_P1_OPERATIONS;
 try{
  delete process.env.EVEJS_COOP_P1_OPERATIONS;
  const messages=[];
  createBroadcaster({clock:()=>200000,send:(_session,message)=>messages.push(message),
    locate:()=>null}).notifyRaid(scene(),raid);
  assert.equal(messages.length,2);
  for(const message of messages){
   assert.match(message,/Пірат атакує/);
   assert.doesNotMatch(message,/\/coopops/);
  }
 }finally{
  if(old===undefined)delete process.env.EVEJS_COOP_P1_OPERATIONS;
  else process.env.EVEJS_COOP_P1_OPERATIONS=old;
 }
});
test("P1 incident doesn't invent an alert for players, invalid NPC ship or a mere string event",()=>{
 const old=process.env.EVEJS_COOP_P1_OPERATIONS;
 try{
  process.env.EVEJS_COOP_P1_OPERATIONS="1";
  const messages=[],s=scene();
  const b=createBroadcaster({clock:()=>300000,
   send:(_session,message)=>messages.push(message),locate:()=>null});
  assert.equal(b.notifyRaid(s,[{action:"attack",pirateID:9001,targetID:6101,targetRole:"hauler"}]).sent,0);
  assert.equal(b.notifyRaid(s,[{action:"invented",pirateID:6001,targetID:6101,targetRole:"hauler"}]).sent,0);
  assert.equal(b.notifyRaid(s,[{action:"attack",pirateID:6001,targetID:9999,targetRole:"hauler"}]).sent,0);
  assert.equal(messages.length,0);
 }finally{
  if(old===undefined)delete process.env.EVEJS_COOP_P1_OPERATIONS;
  else process.env.EVEJS_COOP_P1_OPERATIONS=old;
 }
});

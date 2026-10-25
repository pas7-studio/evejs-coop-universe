import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root=process.env.EVEJS_COOP_PINNED_CODE_PATH;
const sourceFile=root?path.join(root,"server","src","space","npc","npcSceneActivity.js"):null;
const source=sourceFile&&fs.existsSync(sourceFile)?fs.readFileSync(sourceFile,"utf8"):null;
function loadStockActivity(){
 const module={exports:{}};
 // Pure source execution of the EXACT pinned getSceneActivityState, without
 // starting EveJS, GameStore, native NPC services or background schedulers.
 const req=id=>{
  if(id==="path")return path;
  if(id.includes("nativeNpcStore"))return {};
  if(id.includes("npcRegistry"))return {listControllersBySystem:()=>[]};
  if(id.includes("npcAmbientMaterialization"))return {
   isAmbientStartupControllerRecord:()=>false,
   isAmbientVirtualizationEnabled:()=>false};
  if(id.includes("npcCombatDormancy"))return {
   isCombatDormancyEnabled:()=>false,isCombatDormantControllerRecord:()=>false};
  if(id.includes("config"))return {};
  throw Error("UNEXPECTED_PINNED_SCENE_DEPENDENCY:"+id);
 };
 new Function("module","require","process","__dirname",source)(
  module,req,{env:{}},path.dirname(sourceFile));
 return module.exports;
}
function scene(){
 return {systemID:30000144,sessions:new Map(),staticEntities:[],
  dynamicEntities:new Map([[901,{itemID:901,nativeNpc:true,
   sessionlessWarpIngress:{startTimeMs:1000000,
    travelCompleteAtMs:1010000,completeAtMs:1010250}}]]),
  peekSimTimeForWallclock:time=>time};
}
test("pinned EveJS scene sets cold-scene deadline from real restored ingress",{
 skip:!source},()=>{
 const s=loadStockActivity().getSceneActivityState(scene(),1003000);
 assert.equal(s.sessionCount,0);assert.equal(s.nextDeadlineMs,1010250);
 assert.equal(s.shouldTick,false);assert.equal(s.sleepReason,"sleep-until-deadline");
});
test("pinned EveJS wakes cold scene at original ingress completion, no fake intermediate beats",{
 skip:!source},()=>{
 const s=loadStockActivity().getSceneActivityState(scene(),1010500);
 assert.equal(s.nextDeadlineMs,1010250);
 assert.equal(s.shouldTick,true);assert.equal(s.sleepReason,"deadline-due");
});
test("two original connected EVE client sessions keep native escort scene ticking during ingress",{
 skip:!source},()=>{
 const sc=scene();sc.sessions.set(1,{characterID:701});sc.sessions.set(2,{characterID:702});
 const s=loadStockActivity().getSceneActivityState(sc,1003000);
 assert.equal(s.sessionCount,2);assert.equal(s.shouldTick,true);
 assert.equal(s.sleepReason,"sessions-present");
});

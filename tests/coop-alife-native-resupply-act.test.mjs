import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {nativeResupplyActEnabled,selectAmmoResupply}=require("../integration/coopAlifeNativeResupplyBridge.cjs");
const {createAmmoSupply}=require("../integration/coopNpcAmmoSupply.cjs");
const SID=30000144,PILOT="coop-pilot-005",ID=501,STATION=60003760;
const now=1800000000030,observedAt=1800000000000;
function caseData(){
 const ship={kind:"ship",nativeNpc:true,itemID:ID,hpRatio:1,position:{x:0,y:0,z:0}};
 const controller={entityID:ID,systemID:SID,currentTargetID:0,manualOrder:{type:"idle"}};
 const scene={systemID:SID,getEntityByID:id=>id===ID?ship:null};
 const assignments=[{pilotID:PILOT,entityID:ID,systemID:SID}];
 const decision={status:"OBSERVED",systemID:SID,observedAt,
  proof:"NATIVE_OBSERVATIONS_ONLY",intents:[{
   pilotID:PILOT,entityID:ID,systemID:SID,role:"pirate",stage:"RESUPPLY",
   stationID:STATION,reason:"NATIVE_WEAPON_AMMO_EXHAUSTED",
   provenance:"NATIVE_READ_ONLY",nativeMutation:false,
   intentID:SID+":"+observedAt+":"+ID+":RESUPPLY"}]};
 const inspectAmmo=()=>({status:"AMMO_EXHAUSTED"});
 return {ship,controller,scene,assignments,decision,inspectAmmo,
  getController:()=>controller,mode:"PLANNED",systemID:SID,now};
}
const choose=options=>selectAmmoResupply({...caseData(),...options});
test("all switches required; A-Life execution opt-in never activated by master flag alone",()=>{
 for(const missing of ["EVEJS_COOP_ALIFE","EVEJS_COOP_ALIFE_ECONOMY",
  "EVEJS_COOP_ALIFE_NATIVE_RESUPPLY_ACT","EVEJS_COOP_NPC_AMMO_SUPPLY",
  "EVEJS_COOP_NPC_STRICT_AMMO"]){
  const flags=Object.fromEntries(["EVEJS_COOP_ALIFE","EVEJS_COOP_ALIFE_ECONOMY",
   "EVEJS_COOP_ALIFE_NATIVE_RESUPPLY_ACT","EVEJS_COOP_NPC_AMMO_SUPPLY",
   "EVEJS_COOP_NPC_STRICT_AMMO"].map(k=>[k,"1"]));
  delete flags[missing];
  assert.equal(nativeResupplyActEnabled(flags),false,missing);
  flags[missing]="true";
  assert.equal(nativeResupplyActEnabled(flags),false,missing);
 }
 assert.equal(nativeResupplyActEnabled(Object.fromEntries(["EVEJS_COOP_ALIFE",
 "EVEJS_COOP_ALIFE_ECONOMY","EVEJS_COOP_ALIFE_NATIVE_RESUPPLY_ACT",
 "EVEJS_COOP_NPC_AMMO_SUPPLY","EVEJS_COOP_NPC_STRICT_AMMO"].map(k=>[k,"1"]))),true);
});
test("verified physical pirate with native ammo shortage may request existing resupply director",()=>{
 const f=caseData(),r=selectAmmoResupply(f);
 assert.equal(r.status,"SELECTED");
 assert.equal(r.selected.length,1);
 assert.equal(r.intents.get(PILOT).stationID,STATION);
});
test("read-only A-Life snapshot cannot dispatch unapproved or forged resupply",()=>{
 const f=caseData();
 for(const decision of [
  {...f.decision,status:"BLOCKED"},
  {...f.decision,proof:"VIRTUAL"},
  {...f.decision,observedAt:now+1000},
  {...f.decision,observedAt:now-121000},
  {...f.decision,intents:[{...f.decision.intents[0],intentID:"fabricated"}]},
  {...f.decision,intents:[{...f.decision.intents[0],nativeMutation:true}]},
  {...f.decision,intents:[{...f.decision.intents[0],provenance:"PLAYER_ESTIMATE"}]},
  {...f.decision,intents:[{...f.decision.intents[0],role:"trader"}]},
  {...f.decision,intents:[{...f.decision.intents[0],stationID:0}]}
 ]){
  const r=selectAmmoResupply({...f,decision});
  assert.equal(r.selected.length,0);
 }
});
test("native fitting says ammo present or unverified: no redundant native orders",()=>{
 const f=caseData();
 for(const status of ["AMMO_AVAILABLE","NOT_APPLICABLE","INVALID","UNKNOWN"]){
  assert.equal(selectAmmoResupply({...f,inspectAmmo:()=>({status})}).selected.length,0);
 }
});
test("forged pilot, hull mismatch, player owner, wrong scene all block",()=>{
 const f=caseData();
 for(const override of [
  {assignments:[{pilotID:"player-99",entityID:ID,systemID:SID}]},
  {assignments:[{pilotID:PILOT,entityID:ID+1,systemID:SID}]},
  {scene:{...f.scene,systemID:SID+1}},
  {scene:{...f.scene,getEntityByID:()=>({...f.ship,nativeNpc:false})}},
  {scene:{...f.scene,getEntityByID:()=>({...f.ship,session:{characterID:999}})}},
  {getController:()=>({...f.controller,systemID:SID+1})}
 ]){
  assert.equal(selectAmmoResupply({...f,...override}).selected.length,0);
 }
});
test("authoritative native current combat is handled by SURVIVAL, not ordinary economic resupply",()=>{
 const f=caseData();f.controller.currentTargetID=920;
 assert.equal(selectAmmoResupply(f).selected.length,0);
 assert.equal(selectAmmoResupply({...f,mode:"SURVIVAL"}).selected.length,1);
});
test("low-health NPC can retreat without a planner intent when native ammo truly empty",()=>{
 const f=caseData();f.ship.hpRatio=0.38;
 assert.equal(selectAmmoResupply({...f,mode:"SURVIVAL",decision:null}).selected.length,1);
 assert.equal(selectAmmoResupply(f).selected.length,0);
});
test("recent genuine aggressor allows survival fallback, stale aggressor does not",()=>{
 const f=caseData();f.controller.lastAggressorID=901;
 f.controller.lastAggressedAtMs=now-10000;
 assert.equal(selectAmmoResupply({...f,mode:"SURVIVAL",decision:null}).selected.length,1);
 f.controller.lastAggressedAtMs=now-130000;
 assert.equal(selectAmmoResupply({...f,mode:"SURVIVAL",decision:null}).selected.length,0);
});
test("no emergency claim from missing health, missing target and no recent aggression",()=>{
 const f=caseData();f.ship.hpRatio=null;
 assert.equal(selectAmmoResupply({...f,mode:"SURVIVAL",decision:null}).selected.length,0);
 f.ship.hpRatio=1;f.controller.manualOrder={type:"attack"};
 assert.equal(selectAmmoResupply({...f,mode:"SURVIVAL",decision:null}).selected.length,1);
});
test("multiple duplicate/resold NPC identities cannot authorize extra native orders",()=>{
 const f=caseData();
 const d={...f.decision,intents:[...f.decision.intents,...f.decision.intents]};
 assert.equal(selectAmmoResupply({...f,decision:d}).selected.length,0);
 const duplicateAssignments=[...f.assignments,...f.assignments];
 assert.equal(selectAmmoResupply({...f,assignments:duplicateAssignments}).selected.length,1);
});
test("unavailable controller or failed ammo inspection fails closed",()=>{
 const f=caseData();
 assert.equal(selectAmmoResupply({...f,getController:()=>{throw Error("disconnect")}}).selected.length,0);
 assert.equal(selectAmmoResupply({...f,inspectAmmo:()=>{throw Error("sqlite")}}).selected.length,0);
});
test("one actor's unverified cargo cannot block an independent legitimate NPC",()=>{
 const f=caseData();
 const other={pilotID:"coop-pilot-006",entityID:502,systemID:SID};
 const decision={...f.decision,intents:[...f.decision.intents,
  {...f.decision.intents[0],pilotID:other.pilotID,entityID:502,
   intentID:SID+":"+observedAt+":502:RESUPPLY"}]};
 const scene={...f.scene,getEntityByID:id=>id===501?f.ship:
  id===502?{...f.ship,itemID:502}:null};
 const selected=selectAmmoResupply({...f,scene,assignments:[...f.assignments,other],decision,
  getController:id=>id===501?f.controller:{...f.controller,entityID:502},
  inspectAmmo:args=>({status:args.entityID===501?"UNVERIFIED":"AMMO_EXHAUSTED"})});
 assert.deepEqual(selected.selected.map(x=>x.entityID),[502]);
});
test("reject invalid modes and missing physical proof rather than mutating state",()=>{
 const f=caseData();
 for(const opts of [{mode:"LEGACY"},{mode:"REFINE"},{scene:null},{assignments:null},
  {now:NaN},{systemID:0},{getController:null},{inspectAmmo:null}]){
  const r=selectAmmoResupply({...f,...opts});
  assert.equal(r.status,"BLOCKED");
 }
});

function realDirectorHarness(){
 const pilots=[{pilotID:PILOT,entityID:ID,systemID:SID},
  {pilotID:"coop-pilot-006",entityID:502,systemID:SID}];
 const hulls=new Map(pilots.map(p=>[p.entityID,{
  kind:"ship",itemID:p.entityID,nativeNpc:true,hpRatio:1,
  position:{x:0,y:0,z:0}}]));
 const controllers=new Map(pilots.map(p=>[p.entityID,{
  entityID:p.entityID,systemID:SID,currentTargetID:0}]));
 const station={kind:"station",itemID:STATION,
  position:{x:800000,y:0,z:0}};
 const scene={systemID:SID,staticEntities:[station],sessions:new Map(),
  getEntityByID:id=>hulls.get(id)||(id===STATION?station:null)};
 const nativeOrders=[];
 const store={getNativeEntity:id=>hulls.has(id)?{
   entityID:id,ownerID:900,systemID:SID}:null,
  listNativeModulesForEntity:id=>[{moduleID:id+100,entityID:id,
   ownerID:900,categoryID:7,typeID:123,flagID:27}],
  listNativeCargoForEntity:id=>[]};
 const director=createAmmoSupply({store,getWeaponModules:ship=>[{
   itemID:ship.itemID+100,typeID:123,flagID:27}],
  resolveFamily:()=>"projectileTurret",isOptional:()=>false,
  compatible:(_weapon,typeID)=>typeID===35,
  getController:id=>controllers.get(id),
  getStation:id=>id===STATION?{stationID:STATION,solarSystemID:SID}:null,
  warp:(id,target)=>{nativeOrders.push({id,target});
   return {success:true}},
  orbit:()=>({success:false}),
  isScrambled:()=>false,clock:()=>now});
 const decision={...caseData().decision};
 return {pilots,hulls,controllers,station,scene,nativeOrders,director,decision,
  select(mode){return selectAmmoResupply({mode,systemID:SID,assignments:pilots,
   decision:this.decision,scene,getController:id=>controllers.get(id),
   inspectAmmo:args=>director.inspect(args),now});}};
}
test("end-to-end mocked native driver: A-Life intent dispatches only one real pirate warp",()=>{
 const f=realDirectorHarness();
 const monitor=f.director.tick({scene:f.scene,assignments:f.pilots,
  observeOnly:true});
 assert.equal(monitor.orders.length,0);
 assert.equal(f.director.activeIDs(SID).size,2,
  "both depleted NPCs remain excluded from new raids");
 const selection=f.select("PLANNED");
 assert.deepEqual(selection.selected.map(x=>x.entityID),[501]);
 const actual=f.director.tick({scene:f.scene,assignments:selection.selected});
 assert.equal(actual.orders.length,1);
 assert.equal(actual.orders[0].action,"NATIVE_AMMO_RESUPPLY_WARP");
 assert.deepEqual(f.nativeOrders,[{id:501,target:STATION}]);
 assert.equal(f.director.activeIDs(SID).size,2);
 const repeated=f.director.tick({scene:f.scene,assignments:selection.selected});
 assert.equal(repeated.orders.length,0,"native ammo director cooldown prevents repeat");
 assert.equal(f.nativeOrders.length,1);
});
test("end-to-end mocked native driver: invalid plan cannot issue action but shortages remain fenced",()=>{
 const f=realDirectorHarness();
 f.director.tick({scene:f.scene,assignments:f.pilots,observeOnly:true});
 f.decision={...f.decision,proof:"VIRTUAL"};
 const selected=f.select("PLANNED");
 assert.equal(selected.selected.length,0);
 assert.equal(f.nativeOrders.length,0);
 assert.equal(f.director.activeIDs(SID).size,2);
});
test("end-to-end mocked native survival continues without planner approval",()=>{
 const f=realDirectorHarness();
 f.controllers.get(ID).currentTargetID=700;
 f.director.tick({scene:f.scene,assignments:f.pilots,observeOnly:true});
 const selected=f.select("SURVIVAL");
 assert.deepEqual(selected.selected.map(x=>x.entityID),[ID]);
 const report=f.director.tick({scene:f.scene,assignments:selected.selected});
 assert.equal(report.orders.length,1);
 assert.deepEqual(f.nativeOrders,[{id:ID,target:STATION}]);
});

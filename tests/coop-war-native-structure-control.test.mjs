import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeStructureControlWitness,listPinnedSceneShips}=
 require("../integration/coopWarNativeStructureControl.cjs");
function fixture(){
 const entity={itemID:501,kind:"ship",nativeNpc:true,
  position:{x:1000,y:2000,z:0},corporationID:31};
 const ships=[entity];
 let complete=true;
 const scene={systemID:202,getEntityByID:id=>ships.find(x=>x.itemID===id)||null};
 const rows={"501":{entityID:501,systemID:202,corporationID:31,
  factionID:11,warID:"w1",campaignID:"c1"}};
 const adapter=createNativeStructureControlWitness({
  sceneForSystem:system=>system===202?scene:null,
  listAllPhysicalShips:()=>({complete,ships}),
  getNativeEntity:id=>id===501?{entityID:501,systemID:202,corporationID:31}:
   {entityID:id,systemID:202,corporationID:32},
  getController:id=>({entityID:id,systemID:202}),
  getFactionForCorporation:corp=>corp===31?11:22
 });
 const witness=()=>adapter.observe({
  systemID:202,position:{x:0,y:0,z:0},
  warID:"w1",campaignID:"c1",
  attackerFactionID:11,defenderFactionID:22,
  fleetState:{ships:rows}
 });
 return {witness,ships,rows,entity,
  completeness:x=>complete=x};
}
test("real live war NPC uncontested within 20 km is present physical evidence",()=>{
 const f=fixture();const w=f.witness();
 assert.equal(w.status,"UNCONTESTED_NATIVE_ATTACKER");
 assert.equal(w.attackerCount,1);assert.equal(w.defenderCount,0);
 assert.equal(w.physicalProof,true);
});
test("same physical region with defender NPC is contested",()=>{
 const f=fixture();
 const defender={itemID:502,kind:"ship",nativeNpc:true,
  corporationID:32,position:{x:0,y:0,z:1500}};
 f.ships.push(defender);
 f.rows["502"]={entityID:502,systemID:202,corporationID:32,
  factionID:22,warID:"w1",campaignID:"c1"};
 const w=f.witness();
 assert.equal(w.status,"CONTESTED_NATIVE_OBJECTIVE");
 assert.equal(w.attackerCount,1);assert.equal(w.defenderCount,1);
});
test("player ship or an unknown corporation cannot falsely count as absence",()=>{
 const f=fixture();f.ships.push({itemID:800,kind:"ship",
  position:{x:30,y:0,z:0},nativeNpc:false,corporationID:90});
 assert.equal(f.witness().status,"CONTESTED_NATIVE_OBJECTIVE");
});
test("incomplete or unloaded scene is UNKNOWN, never zero defenders",()=>{
 const f=fixture();f.completeness(false);
 const w=f.witness();
 assert.equal(w.status,"NATIVE_CONTROL_UNKNOWN");
 assert.equal(w.reason,"INCOMPLETE_SCENE_ENUMERATION");
});
test("duplicate entity enumeration is not a valid capture proof",()=>{
 const f=fixture();f.ships.push(f.entity);
 assert.equal(f.witness().reason,"UNVERIFIED_PHYSICAL_ENTITY");
});
test("false corporate faction, moved entity or missing native position denies proof",()=>{
 const f=fixture();f.rows["501"].factionID=22;
 assert.equal(f.witness().reason,"NATIVE_SHIP_OR_ORDER_DRIFT");
 f.rows["501"].factionID=11;f.entity.position=null;
 assert.equal(f.witness().reason,"UNVERIFIED_PHYSICAL_ENTITY");
});
test("ships outside objective radius do not count for sustained occupancy",()=>{
 const f=fixture();f.entity.position={x:25000,y:0,z:0};
 const w=f.witness();assert.equal(w.attackerCount,0);
 assert.equal(w.status,"CONTESTED_NATIVE_OBJECTIVE");
});

test("pinned EveJS dynamic Map and static Array are both enumerated exactly",()=>{
 const attacker={itemID:501,kind:"ship",nativeNpc:true,
  corporationID:31,position:{x:0,y:0,z:0}};
 const shipID=501;
 const scene={systemID:202,dynamicEntities:new Map([[shipID,attacker]]),
  staticEntities:[],sessions:new Map([["pilot",{
   _space:{shipID}}]]),getEntityByID:id=>id===501?attacker:null};
 const answer=listPinnedSceneShips(scene);
 assert.equal(answer.complete,true);
 assert.equal(answer.ships.length,1);
});
test("missing connected player ship or incomplete pinned collection blocks native capture",()=>{
 const attacker={itemID:501,kind:"ship",nativeNpc:true,
  corporationID:31,position:{x:0,y:0,z:0}};
 const scene={systemID:202,dynamicEntities:new Map([[501,attacker]]),
  staticEntities:[],sessions:new Map([["pilot",{_space:{shipID:999}}]]),
  getEntityByID:id=>id===501?attacker:null};
 assert.equal(listPinnedSceneShips(scene).complete,false);
 scene.sessions.clear();
 scene.staticEntities=null;
 assert.equal(listPinnedSceneShips(scene).complete,false);
});

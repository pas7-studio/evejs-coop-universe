import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeStructureControlWitness,listPinnedSceneShips}=
 require("../integration/coopWarNativeStructureControl.cjs");
function fixture({factionID=11,enlisted=true,includeNpc=false}={}){
 const hero={itemID:7001,kind:"ship",nativeNpc:false,
  corporationID:555,position:{x:100,y:0,z:0}};
 const sessions=[];
 const account={characterID:9001,shipID:7001,shipid:7001,
  socket:{destroyed:false},_space:{shipID:7001,systemID:202,
   initialStateSent:true}};
 sessions.push(account);
 const scene={systemID:202,dynamicEntities:new Map([[7001,hero]]),
  staticEntities:[],sessions:new Map([["1",account]]),
  getEntityByID:id=>scene.dynamicEntities.get(id)||null,
  getShipEntityForSession:session=>
   session===account?scene.dynamicEntities.get(session._space?.shipID)||null:null};
 const war={version:1,enlistments:enlisted?
  {"9001":{status:"ACTIVE",characterID:9001,
   factionID,enlistedAt:50}}:{}};
 const record={characterID:9001,shipID:7001};
 const fleet={version:1,ships:{},processed:{},history:[]};
 if(includeNpc){
  const npc={itemID:7010,kind:"ship",nativeNpc:true,
   corporationID:31,position:{x:200,y:0,z:0}};
  scene.dynamicEntities.set(7010,npc);
  fleet.ships["7010"]={entityID:7010,
   systemID:202,corporationID:31,factionID:11,
   warID:"w1",campaignID:"c1"};
 }
 const make=(allowMilitiaPlayers=true)=>
  createNativeStructureControlWitness({
   sceneForSystem:()=>scene,listAllPhysicalShips:listPinnedSceneShips,
   getNativeEntity:id=>id===7010?{entityID:7010,systemID:202,
    corporationID:31}:null,
   getController:id=>id===7010?{entityID:7010,systemID:202}:null,
   getFactionForCorporation:corp=>corp===31?11:0,
   getLivePlayerSessions:()=>sessions,
   getCharacterRecord:id=>id===9001?record:null,
   allowMilitiaPlayers
  });
 const observe=(allow=true)=>make(allow).observe({
  systemID:202,position:{x:0,y:0,z:0},
  warID:"w1",campaignID:"c1",attackerFactionID:11,
  defenderFactionID:22,fleetState:fleet,warState:war
 });
 return {hero,scene,account,sessions,war,record,fleet,
  observe,make};
}
test("authentic enlisted attacker capsuleer alone can hold native zone",()=>{
 const f=fixture();const s=f.observe();
 assert.equal(s.status,"UNCONTESTED_NATIVE_ATTACKER");
 assert.equal(s.playerAttackers,1);assert.equal(s.attackerCount,1);
 assert.equal(s.defenderCount,0);
});
test("real defender militia capsuleer contests the native objective",()=>{
 const f=fixture({factionID:22}),s=f.observe();
 assert.equal(s.status,"CONTESTED_NATIVE_OBJECTIVE");
 assert.equal(s.playerDefenders,1);
 assert.equal(s.defenderCount,1);
 assert.equal(s.attackerCount,0);
});
test("unenlisted player or wrong-faction militia cannot grant attacker vote",()=>{
 const a=fixture({enlisted:false});
 assert.equal(a.observe().status,"CONTESTED_NATIVE_OBJECTIVE");
 assert.equal(a.observe().unaffiliatedPlayers,1);
 const b=fixture({factionID:33});
 assert.equal(b.observe().status,"CONTESTED_NATIVE_OBJECTIVE");
 assert.equal(b.observe().attackerCount,0);
});
test("player flag default off maintains conservative NPC-only capture",()=>{
 const f=fixture();
 assert.equal(f.observe(false).status,"CONTESTED_NATIVE_OBJECTIVE");
 assert.equal(f.observe(false).playerAttackers,0);
});
test("global session missing from native scene is UNKNOWN not an attacker",()=>{
 const f=fixture();
 f.scene.sessions.clear();
 assert.equal(f.observe().reason,"LIVE_PLAYER_SHIP_NOT_NATIVE_READY");
});
test("duplicate live session for same character refuses capture",()=>{
 const f=fixture();
 f.sessions.push({...f.account,socket:{destroyed:false}});
 assert.equal(f.observe().reason,"DUPLICATE_OR_INVALID_LIVE_CHARACTER");
});
test("client ship mismatch, warp, and unhydrated session cannot vote",()=>{
 const f=fixture();
 f.account._space.initialStateSent=false;
 assert.equal(f.observe().reason,"LIVE_PLAYER_SHIP_NOT_NATIVE_READY");
 f.account._space.initialStateSent=true;
 f.account.shipID=777;
 assert.equal(f.observe().reason,"LIVE_PLAYER_SHIP_NOT_NATIVE_READY");
 f.account.shipID=7001;f.hero.pendingWarp=true;
 const x=f.observe();
 assert.equal(x.status,"CONTESTED_NATIVE_OBJECTIVE");
 assert.equal(x.playerAttackers,0);
});
test("quitting militia immediately changes physical control on next sample",()=>{
 const f=fixture();
 assert.equal(f.observe().status,"UNCONTESTED_NATIVE_ATTACKER");
 f.war.enlistments["9001"].status="LEFT";
 assert.equal(f.observe().status,"CONTESTED_NATIVE_OBJECTIVE");
});
test("attacker player and same-faction native NPC count separately",()=>{
 const f=fixture({includeNpc:true});const s=f.observe();
 assert.equal(s.status,"UNCONTESTED_NATIVE_ATTACKER");
 assert.equal(s.playerAttackers,1);
 assert.equal(s.attackerCount,2);
});
test("stale character ship cache cannot override verified live EveJS ship",()=>{
 const f=fixture();f.record.shipID=999;
 assert.equal(f.observe().status,"UNCONTESTED_NATIVE_ATTACKER");
 // Actual live socket state still gates eligibility at observation time.
 f.account.socket.destroyed=true;
 assert.equal(f.observe().reason,"DUPLICATE_OR_INVALID_LIVE_CHARACTER");
});
test("incomplete physical census denies all player participation",()=>{
 const f=fixture();f.scene.staticEntities=null;
 assert.equal(f.observe().reason,"INCOMPLETE_SCENE_ENUMERATION");
});

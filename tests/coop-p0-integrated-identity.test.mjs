import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {admission}=require("../integration/coopSessionPresence.cjs");
const {membership}=require("../integration/coopNativeFleetParty.cjs");
const {createNotices}=require("../integration/coopPartyNotices.cjs");
const {verify:verifyLoot}=require("../integration/coopNativeLootPickupEvidence.cjs");
const {prepare:prepareTurnin}=require("../integration/coopFleetMissionTurnin.cjs");

const systemID=30000144;
function setup(){
 const leaderShip={itemID:901,kind:"ship",pilotCharacterID:101,
  spaceState:{systemID},position:{x:0,y:0,z:0}};
 const peerShip={itemID:902,kind:"ship",pilotCharacterID:102,
  spaceState:{systemID},position:{x:15000,y:0,z:0}};
 const npc={itemID:930,kind:"ship",nativeNpc:true,
  position:{x:40000,y:0,z:0}};
 const wreck={itemID:940,nativeNpcWreck:true,launcherID:929};
 const ships=new Map([[901,leaderShip],[902,peerShip],[930,npc],[940,wreck]]);
 const alice={characterID:101,clientID:1001,socket:{destroyed:false},
  _space:{initialStateSent:true,systemID,shipID:901}};
 const bob={characterID:102,clientID:1002,socket:{destroyed:false},
  _space:{initialStateSent:true,systemID,shipID:902}};
 const scene={systemID,sessions:new Map([[101,alice],[102,bob]]),
  dynamicEntities:new Map([[901,leaderShip],[902,peerShip],[930,npc],[940,wreck]]),
  getEntityByID:id=>ships.get(Number(id))||null};
 const nativeFleet={fleetID:55,members:new Map([[101,{charID:101}],[102,{charID:102}]])};
 const fleetRuntime={getFleetForCharacter:id=>nativeFleet.members.has(id)?nativeFleet:null,
  getMemberRecord:(fleet,id)=>fleet.members.get(id)||null};
 const sent=[];
 const notices=createNotices({clock:()=>1000000,cooldownMs:300000,
  send:(session,message)=>sent.push({id:session.characterID,message})});
 const party=()=>({pilots:[
  {characterID:101,shipID:901,session:alice,ship:leaderShip},
  {characterID:102,shipID:902,session:bob,ship:peerShip}
 ],separation:15000});
 const nativeLoot=()=>({scene,wreck:{wreckID:940,sourceEntityID:929,systemID},
  characterID:102,wreckItemID:8201,destinationLocationID:902,
  sourceBefore:{wreckID:940,wreckItemID:8201,typeID:34,quantity:5},
  sourceAfter:null,availableQuantity:5,requestedQuantity:5,
  grantResult:{success:true,data:{quantity:5,changes:[
   {item:{itemID:8500,ownerID:102,locationID:902,typeID:34,quantity:5}}
  ]}}});
 const records=new Map([[101,{agentID:50,contentID:700,
  missionTemplateID:"nativeDungeon",objectiveMode:"dungeon",
  runtimeStatus:"accepted",objectiveCompleted:true,gmCompleted:false,missionSequence:10}],
 [102,{agentID:50,contentID:700,missionTemplateID:"nativeDungeon",
  objectiveMode:"dungeon",runtimeStatus:"accepted",
  objectiveCompleted:true,gmCompleted:false,missionSequence:11}]]);
 const missionRuntime={getMissionRecord:(id,agent)=>agent===50?records.get(id)||null:null};
 const turnin=()=>prepareTurnin({session:alice,agentID:50,actionID:6,
  fleetRuntime,missionRuntime,sessions:[...scene.sessions.values()],
  getDockedLocationID:()=>60000111});
 return {alice,bob,leaderShip,peerShip,npc,scene,ships,nativeFleet,fleetRuntime,
  notices,sent,party,nativeLoot,turnin};
}
test("P0 modules agree on one native two-player identity from presence to fleet, NPC brief and loot",()=>{
 const f=setup();
 assert.equal(admission(f.alice,f.leaderShip,()=>f.scene).status,"ADMITTED_NATIVE_SESSION");
 assert.equal(admission(f.bob,f.peerShip,()=>f.scene).status,"ADMITTED_NATIVE_SESSION");
 assert.equal(membership({leaderSession:f.alice,peerSession:f.bob,
  fleetRuntime:f.fleetRuntime}).ok,true);
 const info=f.notices.brief({scene:f.scene,party:f.party(),
  systemID,fleetID:f.nativeFleet.fleetID});
 assert.equal(info.status,"FLEET_BRIEF_DELIVERED");
 assert.equal(info.targetEntityID,930);
 assert.deepEqual(f.sent.map(x=>x.id),[101,102]);
 const loot=verifyLoot(f.nativeLoot());
 assert.equal(loot.status,"VERIFIED_NATIVE_LOOT_PICKUP");
 assert.equal(loot.characterID,102);
 assert.equal(loot.wreckID,940);
 assert.equal(f.turnin().ok,true);
});
test("P0 after disconnected pilot, no stale brief, loot or mission turn-in qualifies",()=>{
 const f=setup();f.bob.socket.destroyed=true;
 assert.equal(admission(f.bob,f.peerShip,()=>f.scene).status,"STALE_SESSION");
 assert.equal(f.notices.brief({scene:f.scene,party:f.party(),
  systemID,fleetID:55}).status,"STALE_NATIVE_FLEET_MEMBERS");
 assert.equal(verifyLoot(f.nativeLoot()).status,"NO_UNIQUE_AUTHENTICATED_SPACE_LOOTER");
 assert.equal(f.turnin().ok,false);
 assert.equal(f.sent.length,0);
});
test("P0 native reconnect admits replacement only after actual scene registry changes",()=>{
 const f=setup(),old=f.bob;
 old.socket.destroyed=true;
 const replacement={characterID:102,clientID:1003,socket:{destroyed:false},
  _space:{...old._space}};
 assert.equal(admission(replacement,f.peerShip,()=>f.scene).status,
  "SESSION_NOT_IN_NATIVE_SCENE");
 f.scene.sessions.set(102,replacement);
 // A stale old reference must not be trusted after registry reassignment.
 assert.equal(admission(old,f.peerShip,()=>f.scene).status,"STALE_SESSION");
 assert.equal(admission(replacement,f.peerShip,()=>f.scene).status,
  "ADMITTED_NATIVE_SESSION");
 assert.equal(verifyLoot(f.nativeLoot()).status,"VERIFIED_NATIVE_LOOT_PICKUP");
 const newParty=f.party();newParty.pilots[1].session=replacement;
 assert.equal(f.notices.brief({scene:f.scene,party:newParty,
  systemID,fleetID:55}).status,"FLEET_BRIEF_DELIVERED");
 assert.equal(f.sent.length,2);
});
test("P0 duplicate live reconnect cannot impersonate a second recipient or looter",()=>{
 const f=setup(),replacement={...f.bob,socket:{destroyed:false},
  _space:{...f.bob._space}};
 f.scene.sessions.set(103,replacement);
 assert.equal(admission(f.bob,f.peerShip,()=>f.scene).status,
  "AMBIGUOUS_NATIVE_CHARACTER_SESSION");
 assert.equal(verifyLoot(f.nativeLoot()).status,"NO_UNIQUE_AUTHENTICATED_SPACE_LOOTER");
 assert.equal(f.turnin().ok,false);
});

import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createMilitiaWarPlayer,verdictFor,activeEnlistment}=require("../integration/coopMilitiaWarPlayer.cjs");

const WAR="war:500011-500020",CAMPAIGN=WAR+":campaign:30001363",SYSTEM=30001363;
function state({enlistment=null,campaignState="ASSAULT",warState="ACTIVE",systemID=SYSTEM}={}){
 const warStateRow={version:1,
  wars:{[WAR]:{warID:WAR,attackerFactionID:500011,defenderFactionID:500020,state:warState}},
  campaigns:{[CAMPAIGN]:{campaignID:CAMPAIGN,warID:WAR,targetSystemID:SYSTEM,state:campaignState}},
  territories:{},enlistments:{},processed:{},history:[]};
 if(enlistment)warStateRow.enlistments[String(enlistment.characterID)]=enlistment;
 const fleetState={version:1,ships:{
  "101":{entityID:101,systemID,corporationID:1000138,factionID:500011,
   pilotID:"coop-pilot-001",fleetID:"fleet-1",warID:WAR,campaignID:CAMPAIGN},
  "102":{entityID:102,systemID,corporationID:1000135,factionID:500020,
   pilotID:"coop-pilot-002",fleetID:"fleet-2",warID:WAR,campaignID:CAMPAIGN}
 },processed:{},history:[]};
 return {warState:warStateRow,fleetState};
}
const angel={characterID:7,factionID:500011,status:"ACTIVE",enlistedAt:1};
const serpentis={characterID:7,factionID:500020,status:"ACTIVE",enlistedAt:1};
function api(snapshot){
 return createMilitiaWarPlayer({snapshots:()=>snapshot,
  getController:id=>({entityID:id,systemID:SYSTEM}),
  getNativeEntity:id=>({entityID:id,corporationID:id===101?1000138:1000135}),
  getFactionForCorporation:id=>id===1000138?500011:500020,
  env:{EVEJS_COOP_FACTION_WAR:"1",EVEJS_COOP_FACTION_WAR_FLEETS:"1",
   EVEJS_COOP_FACTION_WAR_COMBAT:"1",EVEJS_COOP_ALIFE:"1"},clock:()=>1000});
}
const player=characterID=>({kind:"ship",itemID:900,corporationID:1000001,
 session:{characterID}});

test("enemy militia is the ONLY reason an NPC war ship may engage a player",()=>{
 const a=api(state({enlistment:serpentis}));
 const v=a.npcPlayerVerdict({kind:"ship",itemID:101},player(7));
 assert.equal(v.status,"ENEMY_MILITIA");
 assert.equal(v.factionID,500020);
 assert.equal(v.npcFactionID,500011);
 assert.equal(v.campaignID,CAMPAIGN);
});

test("an enlisted ally is never a target of his own faction",()=>{
 const a=api(state({enlistment:angel}));
 assert.equal(a.npcPlayerVerdict({kind:"ship",itemID:101},player(7)).status,"ALLY");
 // and the Serpentis hull may engage him
 assert.equal(a.npcPlayerVerdict({kind:"ship",itemID:102},player(7)).status,"ENEMY_MILITIA");
});

test("a player with no enlistment is not a war target",()=>{
 const a=api(state());
 assert.equal(a.npcPlayerVerdict({kind:"ship",itemID:101},player(7)).status,"NOT_ENLISTED");
});

test("unregistered NPCs keep stock behaviour (hook must not change pirates)",()=>{
 const a=api(state({enlistment:serpentis}));
 assert.equal(a.npcPlayerVerdict({kind:"ship",itemID:555},player(7)).status,"NOT_WAR_SHIP");
});

test("no active assault or no active war means no player target",()=>{
 assert.equal(api(state({enlistment:serpentis,campaignState:"PREPARING"}))
  .npcPlayerVerdict({kind:"ship",itemID:101},player(7)).status,"NO_ACTIVE_ASSAULT");
 assert.equal(api(state({enlistment:serpentis,warState:"ENDED"}))
  .npcPlayerVerdict({kind:"ship",itemID:101},player(7)).status,"NO_ACTIVE_WAR");
});

test("a campaign in another system does not authorize this fight",()=>{
 const s=state({enlistment:serpentis});
 s.fleetState.ships["101"].systemID=30000142;
 const a=api(s);
 assert.equal(a.npcPlayerVerdict({kind:"ship",itemID:101},player(7)).status,"NOT_WAR_SHIP");
});

test("enlistment must be ACTIVE and must name its own character",()=>{
 const s=state({enlistment:{...serpentis,status:"LEFT"}});
 assert.equal(api(s).npcPlayerVerdict({kind:"ship",itemID:101},player(7)).status,"NOT_ENLISTED");
 const t=state({enlistment:{...serpentis,characterID:8}});
 assert.equal(api(t).npcPlayerVerdict({kind:"ship",itemID:101},player(7)).status,"NOT_ENLISTED");
});

test("enemyPlayersForShip lists exactly the enlisted enemy sessions",()=>{
 const a=api(state({enlistment:serpentis}));
 const ship=state({enlistment:serpentis}).fleetState.ships["101"];
 const scene={sessions:new Map([["s1",{characterID:7,_space:{shipID:900}}],
  ["s2",{characterID:8,_space:{shipID:901}}]]),
  getEntityByID:id=>({kind:"ship",itemID:id})};
 const list=a.enemyPlayersForShip({scene,shipRow:ship});
 assert.deepEqual(list.map(x=>x.characterID),[7]);
});

test("a player kill only counts as a war kill with a real wreck and the opposing enlistment",()=>{
 const snapshot=state({enlistment:angel});
 const victim={kind:"ship",itemID:102,nativeNpc:true,corporationID:1000135};
 const wreck={wreckID:5001,systemID:SYSTEM,sourceEntityID:102,launcherID:102};
 const attacker=player(7);attacker.itemID=900;
 const physicalWreck={nativeNpcWreck:true,itemID:5001,launcherID:102};
 const scene={systemID:SYSTEM,getEntityByID:id=>
  id===5001?physicalWreck:id===900?attacker:null};
 const a=api(snapshot);
 const proof=a.playerKillProof({scene,victim,options:{attackerEntity:attacker},wreck});
 assert.equal(proof.status,"PLAYER_NATIVE_WAR_KILL_PROVIDED");
 assert.equal(proof.characterID,7);
 assert.equal(proof.factionID,500011);
 assert.equal(proof.enemyFactionID,500020);
 assert.equal(proof.wreckID,5001);
 assert.equal(proof.warID,WAR);

 // killing your OWN faction's hull is never a war kill
 const ally=api(state({enlistment:serpentis}))
  .playerKillProof({scene,victim,options:{attackerEntity:attacker},wreck});
 assert.equal(ally.status,"NOT_A_WAR_KILL");
 assert.equal(ally.reason,"ALLY");

 const noWreck=api(snapshot).playerKillProof({scene:{systemID:SYSTEM,getEntityByID:()=>null},
  victim,options:{attackerEntity:attacker},wreck});
 assert.equal(noWreck.status,"PHYSICAL_WRECK_MISSING");

 const notInScene=api(snapshot).playerKillProof({scene:{systemID:SYSTEM,
  getEntityByID:id=>id===5001?physicalWreck:null},
  victim,options:{attackerEntity:attacker},wreck});
 assert.equal(notInScene.status,"UPSTREAM_ATTACKER_NOT_PROVIDED");
});

test("activeEnlistment reads only the ACTIVE row",()=>{
 const s=state({enlistment:serpentis}).warState;
 assert.equal(activeEnlistment(s,7).factionID,500020);
 assert.equal(activeEnlistment(s,8),null);
 s.enlistments["7"].status="LEFT";
 assert.equal(activeEnlistment(s,7),null);
});

test("verdictFor refuses a corporation that is not the registered hull's",()=>{
 const s=state({enlistment:serpentis});
 const v=verdictFor({warState:s.warState,fleetState:s.fleetState,npcEntityID:101,
  npcCorporationID:999,factionID:500011,systemID:SYSTEM,characterID:7});
 assert.equal(v.status,"BLOCKED");
});

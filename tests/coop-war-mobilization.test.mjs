import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWarMobilizer,enabled}=require("../integration/coopWarMobilizer.cjs");
const flags=()=>({
 EVEJS_COOP_FACTION_WAR:"1",EVEJS_COOP_FACTION_WAR_FLEETS:"1",
 EVEJS_COOP_FACTION_WAR_MOBILIZE:"1",EVEJS_COOP_NATIVE_ATOMIC_ROWS:"1",
 EVEJS_COOP_ALIFE:"1",EVEJS_COOP_NPC_STRICT_AMMO:"1",
 EVEJS_COOP_NPC_AMMO_DURABLE_CYCLE:"1",EVEJS_COOP_NPC_BANK_ATOMIC:"1"
});
function fixture(){
 const env=flags();
 const war={version:1,wars:{war1:{state:"ACTIVE",attackerFactionID:11,defenderFactionID:22}},
  campaigns:{battle1:{campaignID:"battle1",warID:"war1",state:"PREPARING",
   sourceSystemID:101,targetSystemID:202,startedAt:50}}};
 const links=[
  {pilotID:"coop-pilot-001",entityID:501,systemID:101,role:"patrol"},
  {pilotID:"coop-pilot-002",entityID:502,systemID:101,role:"patrol"},
  {pilotID:"coop-pilot-003",entityID:503,systemID:202,role:"patrol"},
  {pilotID:"coop-pilot-004",entityID:504,systemID:101,role:"trader"},
  {pilotID:"coop-pilot-005",entityID:505,systemID:202,role:"miner"}
 ];
 const entities=new Map(),native=new Map(),controllers=new Map();
 for(const l of links){
  const corporationID=l.systemID===202?32:31;
  entities.set(l.entityID,{itemID:l.entityID,kind:"ship",nativeNpc:true,
   corporationID,ownerID:corporationID,position:{x:0,y:0,z:0}});
  native.set(l.entityID,{entityID:l.entityID,systemID:l.systemID,
   corporationID,ownerID:corporationID});
  controllers.set(l.entityID,{entityID:l.entityID,systemID:l.systemID,
   manualOrder:null,currentTargetID:0});
 }
 const scenes=new Map([101,202].map(systemID=>[systemID,{
  systemID,sessions:new Map(),getEntityByID:id=>entities.get(id)}]));
 const registered={version:1,ships:{},processed:{},history:[]};
 const calls=[];let rejects=false,ammo=false,lease=[],now=100000;
 const registry={snapshot:()=>structuredClone(registered),execute:command=>{
  calls.push(command);
  if(rejects)return {status:"BLOCKED",reason:"NATIVE_SHIP_OR_CAMPAIGN_UNVERIFIED"};
  registered.ships[String(command.entityID)]={...command};
  return {status:"APPLIED",receipt:{entityID:command.entityID}};
 }};
 const mobilizer=createWarMobilizer({
  registry,readWarState:()=>war,readLinks:()=>links,
  sceneForSystem:id=>scenes.get(id),getNativeEntity:id=>native.get(id),
  getController:id=>controllers.get(id),
  getFactionForCorporation:corp=>corp===31?11:corp===32?22:null,
  inspectReadiness:()=>({ready:!ammo}),
  getOrderLeases:()=>lease,isTactical:()=>false,
  clock:()=>now,env,maxPerTick:2,maxPerSide:1});
 return {env,war,links,entities,native,controllers,scenes,registered,calls,
  mobilizer,deny:x=>rejects=x,noAmmo:x=>ammo=x,lease:x=>lease=x,
  tick:()=>mobilizer.tick({systemIDs:[101,202]})};
}
test("physical defender and attacker patrols mobilize once, no hull spawn",()=>{
 const f=fixture(),one=f.tick();
 assert.equal(one.status,"OBSERVED");assert.equal(one.mobilized.length,2);
 assert.deepEqual(one.mobilized.map(x=>x.entityID),[503,501]);
 assert.equal(f.calls.length,2);
 assert.equal(f.calls[0].fleetID,"fw-battle1-22");
 assert.equal(f.calls[1].fleetID,"fw-battle1-11");
 assert.equal(f.tick().mobilized.length,0);
 assert.equal(f.registered.ships["504"],undefined);
 assert.equal(f.registered.ships["505"],undefined);
});
test("no original war, no native assault and no local scene never spawn an enemy",()=>{
 const f=fixture();f.war.wars.war1.state="ENDED";
 assert.equal(f.tick().mobilized.length,0);assert.equal(f.calls.length,0);
 f.war.wars.war1.state="ACTIVE";
 f.war.campaigns.battle1.state="ASSAULT";
 // Assault attacker must actually have transferred to target, no teleport.
 const r=f.tick();
 assert.deepEqual(r.mobilized.map(x=>x.entityID),[503]);
 assert.equal(f.registered.ships["501"],undefined);
});
test("live player control, native manual order, prior lease and ammo denial",()=>{
 const f=fixture();
 f.scenes.get(202).sessions.set("p",{_space:{shipID:503}});
 f.controllers.get(501).manualOrder={type:"orbit",targetID:900};
 f.controllers.get(502).currentTargetID=900;
 assert.equal(f.tick().mobilized.length,0);
 f.scenes.get(202).sessions.clear();
 f.controllers.get(501).manualOrder=null;
 f.controllers.get(502).currentTargetID=0;
 f.lease([{entityID:501,systemID:101,phase:"OUTCOME_UNKNOWN"}]);
 f.noAmmo(true);
 assert.equal(f.tick().mobilized.length,0);
 f.noAmmo(false);
 const result=f.tick();
 assert.deepEqual(result.mobilized.map(x=>x.entityID),[503,502]);
});
test("physical native corporate affiliation and duplicated pilot IDs fail closed",()=>{
 const f=fixture();
 f.entities.get(503).corporationID=31;
 f.links.push({...f.links[0],entityID:510});
 assert.deepEqual(f.tick().mobilized.map(x=>x.entityID),[502]);
});
test("native writer refusal causes no fabricated fleet registration",()=>{
 const f=fixture();f.deny(true);
 const x=f.tick();
 assert.equal(x.mobilized.length,0);
 assert.deepEqual(f.registered.ships,{});
});
test("disabled or incomplete safety flags do not consult game world",()=>{
 const f=fixture();
 f.env.EVEJS_COOP_FACTION_WAR_MOBILIZE="0";
 assert.equal(f.tick().status,"DISABLED");assert.equal(f.calls.length,0);
 f.env.EVEJS_COOP_FACTION_WAR_MOBILIZE="1";
 delete f.env.EVEJS_COOP_NPC_BANK_ATOMIC;
 assert.equal(enabled(f.env),false);
 assert.equal(f.tick().status,"DISABLED");
});

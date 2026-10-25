import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createSquadDirector}=require("../integration/coopNpcSquadDirector.cjs");
const {createHuntPolicy}=require("../integration/coopNpcHuntPolicy.cjs");
const SID=30000144;
const pilot=n=>"coop-pilot-"+String(n).padStart(3,"0");
function fixture(size=3){
 let now=100000;
 const ships=new Map(),pos=x=>({x,y:0,z:0});
 const hull=(id,x,npc=true)=>{const ship={itemID:id,kind:"ship",
  nativeNpc:npc,position:pos(x)};ships.set(id,ship);return ship;};
 hull(101,0);hull(102,650000);hull(103,720000);
 hull(201,50000);hull(202,100000);hull(401,60000,false);
 const sessions=new Map(),scene={systemID:SID,getEntityByID:id=>ships.get(id),sessions};
 const pirates=[101,102,103].slice(0,size).map((entityID,i)=>({
  pilotID:pilot(i+1),entityID,systemID:SID,role:"pirate"}));
 const pilots=pirates.map(p=>({id:p.pilotID,faction:"independent"}));
 const fleetShips=[{id:201,role:"hauler"},{id:202,role:"miner"}];
 const squads=createSquadDirector({clock:()=>now});
 const observe=()=>squads.observe({systemID:SID,scene,pirates,pilots,fleetShips,
  canAttack:()=>true});
 const permit=(pirateID,targetID=201)=>squads.permit({
  systemID:SID,scene,pirateID,targetID});
 return {ships,pos,scene,pirates,pilots,fleetShips,squads,sessions,observe,permit,
  clock:()=>now,advance:ms=>{now+=ms;},hull};
}
test("physical same-faction pilot becomes scout, two actual ships are strike pair",()=>{
 const f=fixture(),a=f.observe();
 assert.equal(a.status,"OK");assert.equal(a.teams.length,1);
 assert.equal(a.teams[0].scoutID,101);
 assert.deepEqual(a.teams[0].attackerIDs,[102,103]);
 assert.equal(a.teams[0].targetID,201);
 assert.equal(f.permit(101).reason,"SCOUT_WITNESS_ONLY");
 assert.equal(f.permit(102).reason,"RELAY_IN_FLIGHT");
});
test("repeated world ticks do not reset relay latency",()=>{
 const f=fixture();f.observe();f.advance(10000);f.observe();
 f.advance(6000);f.observe();
 assert.equal(f.permit(102).reason,"SCOUT_RELAY_CONFIRMED");
 assert.equal(f.permit(102).report.firstSeenAt,100000);
});
test("squad reserves one real stock-fleet target and never target-hops",()=>{
 const f=fixture();f.observe();f.advance(16000);f.observe();
 assert.equal(f.permit(102,202).reason,"SQUAD_TARGET_RESERVED");
 assert.equal(f.permit(103).allowed,true);
});
test("solo pirate keeps existing native authorization path",()=>{
 const f=fixture(1);f.observe();
 assert.equal(f.permit(101).reason,"SOLO_NATIVE_POLICY");
});
test("two rival factions cannot form a synthetic squad",()=>{
 const f=fixture();f.ships.get(102).position.x=60000;
 f.pilots[1].faction="frontier";
 f.pilots[2].faction="frontier";f.observe();
 assert.equal(f.squads.snapshot().length,1);
 const pair=f.squads.snapshot()[0];
 assert.deepEqual(pair.attackerIDs,[103]);
 assert.equal(pair.scoutID,102);
 assert.equal(f.permit(101).reason,"SOLO_NATIVE_POLICY");
});
test("duplicate pilot or ship identity is rejected, not silently used as squad scout",()=>{
 const f=fixture();f.pirates.push({...f.pirates[0]});f.observe();
 assert.equal(f.squads.snapshot().length,0);
});
test("native players, missing hulls, wrong systems and moved prey are not valid relays",()=>{
 const f=fixture();f.observe();f.advance(16000);f.observe();
 f.ships.get(201).position.x=230000;
 assert.equal(f.permit(102).allowed,false);
 f.ships.get(201).position.x=50000;
 f.ships.get(101).nativeNpc=false;
 assert.equal(f.permit(102).allowed,false);
 f.ships.get(101).nativeNpc=true;
 assert.equal(f.squads.permit({systemID:30000142,scene:f.scene,
  pirateID:102,targetID:201}).allowed,false);
});
test("no scout: old squad blocks unsafe solo fallback until bounded expiration",()=>{
 const f=fixture();f.observe();f.advance(16000);f.observe();
 f.ships.get(101).position.x=400000;
 f.observe();assert.equal(f.permit(102).allowed,false);
 f.advance(65000);f.observe();
 assert.equal(f.permit(102).reason,"SOLO_NATIVE_POLICY");
});
test("no synthetic squad is created from a human target disguised as a fleet member",()=>{
 const f=fixture();f.fleetShips.splice(0,2,{id:401,role:"hauler"});
 f.observe();assert.deepEqual(f.squads.snapshot(),[]);
});
test("remote attacker needs an authenticated physical scout report, not a global target ID",()=>{
 const f=fixture(2),dir=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-squad-"));
 try{
  const hunt=createHuntPolicy({file:path.join(dir,"intel.json"),clock:f.clock});
  const input={systemID:SID,scene:f.scene,pirateID:102,
   piratePilotID:pilot(2),targetID:201,targetRole:"hauler",
   contacts:f.pirates,getHealth:()=>1,isScrambled:()=>false};
  assert.equal(hunt.assess(input).reason,"NO_FRESH_WITNESS");
  f.observe();f.advance(16000);f.observe();
  const report=f.permit(102).report;
  assert.ok(report);
  assert.equal(hunt.assess({...input,sharedIntel:report}).decision,"RAID");
  assert.equal(hunt.assess({...input,sharedIntel:{
   ...report,sourcePilotID:"coop-pilot-999"}}).reason,"NO_FRESH_WITNESS");
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test("physical player escort seen by scout discourages remote pirate raid",()=>{
 const f=fixture(2),dir=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-squad-"));
 try{
  const hunt=createHuntPolicy({file:path.join(dir,"intel.json"),clock:f.clock});
  f.observe();f.advance(16000);f.observe();
  const input={systemID:SID,scene:f.scene,pirateID:102,piratePilotID:pilot(2),
   targetID:201,targetRole:"hauler",contacts:f.pirates,
   getHealth:()=>1,isScrambled:()=>false,
   sharedIntel:f.permit(102).report};
  assert.equal(hunt.assess(input).decision,"RAID");
  f.sessions.set("visible",{characterID:4,_space:{initialStateSent:true,
   systemID:SID,shipID:401}});
  assert.equal(hunt.assess(input).reason,"RISK_TOO_HIGH");
  f.sessions.clear();f.advance(65000);
  assert.equal(hunt.assess(input).reason,"NO_FRESH_WITNESS");
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

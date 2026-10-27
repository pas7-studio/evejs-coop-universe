import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createWarBattleLineRelief,DRY_REASON}=require("../integration/coopWarBattleLineRelief.cjs");

// The dry verdict is the mobiliser's own muster readiness. This module never has
// a second opinion about ammo, so the fixture is that rule's own answer.
const SHIP=980000016639,SYSTEM=30001363,CORP=1000135;
function fixture({ready=false,reason=DRY_REASON,releaseStatus="APPLIED"}={}){
 const calls=[];
 const registry={
  snapshot:()=>({status:"OBSERVED",ships:{[String(SHIP)]:{entityID:SHIP,systemID:SYSTEM,
   pilotID:"coop-pilot-051",corporationID:CORP,factionID:500020,fleetID:"fleet-1",
   warID:"war:500011-500020",campaignID:"war:500011-500020:campaign:30001363"}}}),
  execute:command=>{calls.push(command);
   return releaseStatus==="APPLIED"?{status:"APPLIED",receipt:{type:"RELEASE"}}:
    {status:"BLOCKED",reason:releaseStatus};},
 };
 const api=createWarBattleLineRelief({
  registry,
  sceneForSystem:id=>({systemID:id,getEntityByID:entityID=>entityID===SHIP?
   {kind:"ship",nativeNpc:true,itemID:SHIP,session:null}:null}),
  getNativeEntity:id=>id===SHIP?{entityID:SHIP,systemID:SYSTEM,corporationID:CORP}:null,
  inspectReadiness:()=>ready?{ready:true,armedModuleCount:3}:{ready:false,reason},
  clearOrder:({entityID})=>calls.push({cleared:entityID}),
 });
 return {api,calls};
}

test("a hull the muster rule calls dry releases its slot",()=>{
 const {api,calls}=fixture();
 const result=api.tick({systemIDs:[SYSTEM]});
 assert.equal(result.status,"RELEASED");
 assert.equal(result.released.length,1);
 assert.equal(result.released[0].entityID,SHIP);
 assert.equal(result.released[0].reason,DRY_REASON);
 const release=calls.find(x=>x&&x.type==="RELEASE");
 assert.ok(release,"the registry's own RELEASE command must be used");
 assert.equal(release.proofID,"native-relief:war:500011-500020:campaign:30001363:"+SHIP);
 assert.equal(release.pilotID,"coop-pilot-051");
 assert.equal(release.fleetID,"fleet-1");
 assert.ok(calls.some(x=>x&&x.cleared===SHIP),"the live order is cleared first");
});

test("a muster-ready hull keeps its slot and is never touched",()=>{
 const {api,calls}=fixture({ready:true});
 const result=api.tick({systemIDs:[SYSTEM]});
 assert.equal(result.status,"NO_DRY_HULL");
 assert.equal(calls.length,0);
});

test("any other readiness refusal never releases the hull",()=>{
 for(const reason of ["PHYSICAL_WAR_HULL_NOT_VERIFIED","NATIVE_WAR_OWNER_MISMATCH",
  "WAR_FITTING_UNAVAILABLE","WAR_FITTING_IDENTITY_CONFLICT","WAR_NATIVE_READ_UNAVAILABLE"]){
  const {api,calls}=fixture({reason});
  const result=api.tick({systemIDs:[SYSTEM]});
  assert.equal(result.status,"NO_DRY_HULL",reason);
  assert.equal(result.blocked[0].reason,reason);
  assert.equal(calls.length,0,reason+" must not release or clear anything");
 }
});

test("a refused native release proof keeps the hull in the battle line",()=>{
 const {api}=fixture({releaseStatus:"NATIVE_RELEASE_UNVERIFIED"});
 const result=api.tick({systemIDs:[SYSTEM]});
 assert.equal(result.status,"BLOCKED");
 assert.equal(result.released.length,0);
 assert.equal(result.blocked[0].reason,"NATIVE_RELEASE_UNVERIFIED");
});

test("a native record that drifted is refused, never released",()=>{
 const calls=[];
 const api=createWarBattleLineRelief({
  registry:{snapshot:()=>({ships:{[String(SHIP)]:{entityID:SHIP,systemID:SYSTEM,
   pilotID:"coop-pilot-051",fleetID:"fleet-1",warID:"w",campaignID:"c",factionID:500020}}}),
   execute:command=>{calls.push(command);return {status:"APPLIED"};}},
  sceneForSystem:id=>({systemID:id,getEntityByID:()=>({kind:"ship",nativeNpc:true,itemID:SHIP})}),
  getNativeEntity:()=>({entityID:SHIP,systemID:SYSTEM+1,corporationID:CORP}),
  inspectReadiness:()=>({ready:false,reason:DRY_REASON}),
  clearOrder:()=>{},
 });
 const result=api.tick({systemIDs:[SYSTEM]});
 assert.equal(result.status,"NO_DRY_HULL");
 assert.equal(result.blocked[0].reason,"NATIVE_RECORD_DRIFT");
 assert.equal(calls.length,0);
});

test("hulls outside the ticked systems are never inspected",()=>{
 const {api,calls}=fixture();
 assert.equal(api.tick({systemIDs:[30000142]}).status,"NO_DRY_HULL");
 assert.equal(calls.length,0);
});

test("every authority is required and the system list is bounded",()=>{
 assert.throws(()=>createWarBattleLineRelief({}),/WAR_BATTLE_LINE_RELIEF_AUTHORITIES_REQUIRED/);
 const {api}=fixture();
 assert.equal(api.tick({systemIDs:Array.from({length:21},()=>SYSTEM)}).status,"INVALID_SYSTEMS");
 assert.equal(api.tick({systemIDs:[]}).status,"NO_SYSTEMS");
});

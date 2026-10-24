import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {verify}=require("../integration/coopNpcDestructionAttacker.cjs");
const systemID=30000142;
function fixture(){
 const attacker={itemID:41,kind:"ship",nativeNpc:true};
 const victim={itemID:42,kind:"ship",nativeNpc:true};
 const wreck={wreckID:801,systemID,sourceEntityID:42,launcherID:42};
 const physical={itemID:801,kind:"wreck",nativeNpcWreck:true,launcherID:42};
 const scene={systemID,sessions:new Map(),getEntityByID:id=>id===41?attacker:id===801?physical:null};
 const links=[{pilotID:"coop-pilot-001",entityID:41,systemID},
  {pilotID:"coop-pilot-002",entityID:42,systemID}];
 const base={scene,victim,wreck,options:{attackerEntity:attacker},links};
 return {base,attacker,victim,wreck,scene,links,physical};
}
test("explicit upstream destruction attacker identifies exact native named pilot",()=>{
 const {base}=fixture();
 const r=verify(base);assert.equal(r.status,"NATIVE_DESTRUCTION_ATTACKER_PROVIDED");
 assert.equal(r.attackerPilotID,"coop-pilot-001");
 assert.equal(r.victimPilotID,"coop-pilot-002");assert.equal(r.wreckID,801);
 assert.match(r.attribution,/UPSTREAM_DESTRUCTION_OPTIONS/);
});
test("no native attacker from upstream never promotes a target lock to killer",()=>{
 const {base}=fixture();const r=verify({...base,options:{currentTargetID:41}});
 assert.equal(r.status,"UPSTREAM_ATTACKER_NOT_PROVIDED");assert.equal(r.attackerPilotID,undefined);
});
test("wrong physical wreck, source or victim are not proof of destruction",()=>{
 const {base,wreck,physical}=fixture();
 wreck.sourceEntityID=99;
 assert.equal(verify(base).status,"INVALID_NATIVE_DESTRUCTION");
 wreck.sourceEntityID=42;physical.nativeNpcWreck=false;
 assert.equal(verify(base).status,"PHYSICAL_WRECK_MISSING");
});
test("player or fake attacker cannot get NPC kill credit",()=>{
 const {base,scene,attacker}=fixture();
 scene.sessions.set("session",{characterID:99,_space:{shipID:41}});
 assert.equal(verify(base).status,"PLAYER_SHIP_EXCLUDED");
 scene.sessions.clear();attacker.nativeNpc=false;
 assert.equal(verify(base).status,"UPSTREAM_ATTACKER_NOT_NATIVE");
});
test("stale/foreign named pilot link never proves native final attacker",()=>{
 const {base,links}=fixture();
 links[0].systemID=30000144;
 assert.equal(verify(base).status,"ATTACKER_NOT_NAMED");
});

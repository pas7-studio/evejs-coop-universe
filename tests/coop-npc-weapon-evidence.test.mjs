import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {verify}=require("../integration/coopNpcWeaponEvidence.cjs");
const source={kind:"ship",nativeNpc:true,itemID:10};
const target={kind:"ship",nativeNpc:true,itemID:20};
const scene={systemID:30000142,sessions:new Map(),
 getEntityByID:id=>id===10?source:id===20?target:null};
const links=[
 {pilotID:"coop-pilot-001",systemID:30000142,entityID:10},
 {pilotID:"coop-pilot-002",systemID:30000142,entityID:20}
];
const opts=()=>({scene,attacker:source,target,links,kind:"missile-launch",chargeTypeID:34});
test("successful native missile launch witness links exact named NPC pair",()=>{
 const v=verify(opts());assert.equal(v.status,"VERIFIED_NATIVE_WEAPON_EVENT");
 assert.equal(v.attackerPilotID,"coop-pilot-001");assert.equal(v.victimPilotID,"coop-pilot-002");
 assert.equal(v.kind,"missile-launch");
});
test("module activation is observed, not misclassified as applied weapon damage",()=>{
 const v=verify({...opts(),kind:"module-activation",moduleID:777,chargeTypeID:0});
 assert.equal(v.status,"VERIFIED_NATIVE_WEAPON_EVENT");assert.equal(v.moduleID,777);
 assert.equal(v.healthLossHP,undefined);
});
test("fake launcher, unlinked target, duplicate identity and player-owned entity fail closed",()=>{
 assert.equal(verify({...opts(),attacker:{...source,itemID:19}}).status,"NOT_NATIVE_NPC_WEAPON");
 assert.equal(verify({...opts(),links:[links[0]]}).status,"UNLINKED_NPC");
 assert.equal(verify({...opts(),links:[links[0],{...links[1],pilotID:links[0].pilotID}]}).status,"UNLINKED_NPC");
 const sceneWithPlayer={...scene,sessions:new Map([[1,{characterID:90,_space:{shipID:10}}]])};
 assert.equal(verify({...opts(),scene:sceneWithPlayer}).status,"PLAYER_SHIP");
});
test("cannot certify missing module or missile type",()=>{
 assert.equal(verify({...opts(),chargeTypeID:0}).status,"MISSILE_TYPE_MISSING");
 assert.equal(verify({...opts(),kind:"module-activation",moduleID:0}).status,"MODULE_MISSING");
});

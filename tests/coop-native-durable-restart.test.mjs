import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {restoreNamedShips}=require("../integration/coopNativeRestore.cjs");
function fixture(){
 const systemID=30000144,entityID=980000000123;
 const ship={itemID:entityID,kind:"ship",nativeNpc:true,position:{x:10,y:20,z:30}};
 const ships=new Map();
 const scene={systemID,getEntityByID:id=>ships.get(id)||null};
 const link={pilotID:"coop-pilot-006",systemID,entityID};
 const links={ [link.pilotID]:link };
 const entity={entityID,systemID,nativeNpc:true,transient:false};
 const controller={entityID,systemID,transient:false,profileID:"generic_hostile"};
 const entities=new Map([[entityID,entity]]),controllers=new Map([[entityID,controller]]);
 let calls=0;
 const registry={snapshot:()=>({links})};
 const store={getNativeEntity:id=>entities.get(id)||null,
  getNativeController:id=>controllers.get(id)||null};
 const service={materializeStoredNativeController:(sc,id,opt)=>{
  calls++;assert.equal(opt.broadcast,false);assert.equal(sc,scene);
  assert.equal(id,entityID);ships.set(id,ship);return {success:true,data:{entity:ship}};
 }};
 const deps={registry,store,service,sceneForSystem:system=>system===systemID?scene:null};
 return {deps,links,link,ships,ship,entity,controller,entities,controllers,
  getCalls:()=>calls};
}
test("durable native NPC gets the SAME real entity ID on headless restart before link pruning",()=>{
 const x=fixture();
 const r=restoreNamedShips(x.deps);
 assert.equal(r.status,"OK");assert.equal(r.recovered,1);assert.equal(r.alreadyPhysical,0);
 assert.equal(x.getCalls(),1);assert.equal(x.ships.get(x.link.entityID),x.ship);
 assert.equal(x.links[x.link.pilotID].entityID,x.link.entityID);
});
test("restored NPC is idempotent, no second ship spawn or repeated call",()=>{
 const x=fixture();
 assert.equal(restoreNamedShips(x.deps).recovered,1);
 assert.equal(restoreNamedShips(x.deps).alreadyPhysical,1);
 assert.equal(x.getCalls(),1);assert.equal(x.ships.size,1);
});
test("already live named ship is not materialized twice",()=>{
 const x=fixture();x.ships.set(x.link.entityID,x.ship);
 assert.equal(restoreNamedShips(x.deps).alreadyPhysical,1);
 assert.equal(x.getCalls(),0);
});
test("missing native record for durable named pilot blocks unsafe recreation",()=>{
 const x=fixture();x.entities.clear();x.controllers.clear();
 x.link.durable=true;
 const r=restoreNamedShips(x.deps);
 assert.equal(r.status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(r.errors[0].reason,"DURABLE_NATIVE_RECORD_MISSING");
 assert.equal(x.getCalls(),0);
});
test("legacy transient-only saved identity is NOT falsely reported as restored",()=>{
 const x=fixture();x.entities.clear();x.controllers.clear();
 const r=restoreNamedShips(x.deps);
 assert.equal(r.status,"OK");assert.equal(r.legacyTransient,1);
 assert.equal(r.recovered,0);assert.equal(x.getCalls(),0);
});
test("old in-memory transient entity records do not count as durable restart guarantee",()=>{
 const x=fixture();x.entity.transient=true;
 const r=restoreNamedShips(x.deps);
 assert.equal(r.legacyTransient,1);assert.equal(x.getCalls(),0);
});
test("partial persisted native ship/controller blocks unsafe registry prune",()=>{
 const x=fixture();x.controllers.clear();
 const r=restoreNamedShips(x.deps);
 assert.equal(r.status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(r.errors[0].reason,"PARTIAL_NATIVE_RECORD");assert.equal(x.getCalls(),0);
});
test("stored ship in another solar system cannot steal a pilot link",()=>{
 const x=fixture();x.entity.systemID=30000142;
 const r=restoreNamedShips(x.deps);
 assert.equal(r.status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(r.errors[0].reason,"NATIVE_RECORD_IDENTITY_CONFLICT");
 assert.equal(x.getCalls(),0);
});
test("foreign entity occupying native ID aborts restoration, never overwrites player ship",()=>{
 const x=fixture();x.ships.set(x.link.entityID,{itemID:x.link.entityID,kind:"ship",nativeNpc:false});
 const r=restoreNamedShips(x.deps);
 assert.equal(r.status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(r.errors[0].reason,"ENTITY_ID_OCCUPIED_BY_FOREIGN_SHIP");
 assert.equal(x.getCalls(),0);
});
test("failed native EveJS restore cannot claim physical NPC without live scene entity",()=>{
 const x=fixture();x.deps.service.materializeStoredNativeController=()=>({success:true,data:{}});
 const r=restoreNamedShips(x.deps);
 assert.equal(r.status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(r.errors[0].reason,"NATIVE_RESTORE_NOT_PHYSICAL");
});
test("duplicate durable entity IDs between different pilots fail closed",()=>{
 const x=fixture();x.links["coop-pilot-099"]={pilotID:"coop-pilot-099",
  entityID:x.link.entityID,systemID:x.link.systemID};
 const r=restoreNamedShips(x.deps);
 assert.equal(r.status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(r.errors.length,1);assert.equal(r.errors[0].reason,"INVALID_OR_DUPLICATE_LINK");
});
test("invalid dependencies or excessive persisted links are rejected without spawning",()=>{
 const x=fixture();
 assert.throws(()=>restoreNamedShips({}),/NATIVE_RESTORE_DEPENDENCY_MISSING/);
 assert.equal(restoreNamedShips({...x.deps,maxLinks:0}).status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(x.getCalls(),0);
});

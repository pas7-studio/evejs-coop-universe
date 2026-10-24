import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {createNativeGateTransfer}=require("../integration/coopNativeGateTransfer.cjs");
const A=30000142,B=30000144;
function fixture(){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-gate-transfer-"));
 const ship={itemID:100,kind:"ship",nativeNpc:true,position:{x:500000,y:0,z:0},mode:"STOP"};
 const source={systemID:A,staticEntities:[{itemID:900,kind:"stargate",
  position:{x:500000,y:0,z:0}}],ships:new Map([[100,ship]])};
 const destination={systemID:B,staticEntities:[{itemID:901,kind:"stargate",
  position:{x:100000,y:0,z:0}}],ships:new Map()};
 for(const scene of [source,destination])scene.getEntityByID=id=>scene.ships.get(id)||null;
 const scenes=new Map([[A,source],[B,destination]]);
 let entity={entityID:100,systemID:A,transient:true,position:ship.position,
  conditionState:{shieldCharge:0.6,armorDamage:0.3,damage:0.1}};
 let control={entityID:100,systemID:A,runtimeKind:"nativeCombat",
  currentTargetID:0,manualOrder:null,profileID:"p",definitionSnapshot:{profile:{profileID:"p"}}};
 let runtimeControl={...control};
 const modules=[{entityID:100,moduleID:300,typeID:12,flagID:27}],
  cargo=[{entityID:100,cargoID:400,typeID:34,quantity:23,moduleID:0}];
 const store={
  getNativeEntity:()=>structuredClone(entity),
  getNativeController:()=>structuredClone(control),
  listNativeModulesForEntity:()=>structuredClone(modules),
  listNativeCargoForEntity:()=>structuredClone(cargo),
  upsertNativeEntity:row=>{entity=structuredClone(row);return {success:true}},
  upsertNativeController:row=>{control=structuredClone(row);return {success:true}}
 };
 let failDestination=false;
 const service={
  dematerializeNativeController:c=>{
   const sourceScene=scenes.get(c.systemID);
   if(!sourceScene?.ships.has(100))return {success:false};
   sourceScene.ships.delete(100);
   runtimeControl=null;
   return {success:true};
  },
  materializeStoredNativeController:scene=>{
   if(scene.systemID===B&&failDestination)return {success:false};
   const restored={itemID:100,kind:"ship",nativeNpc:true,
    position:structuredClone(entity.position),mode:entity.mode||"STOP"};
   scene.ships.set(100,restored);
   runtimeControl={...control};
   return {success:true,data:{entity:restored,controller:runtimeControl}};
  }
 };
 let link={pilotID:"coop-pilot-005",entityID:100,systemID:A,role:"trader"};
 const registry={
  snapshot:()=>({links:{"coop-pilot-005":structuredClone(link)}}),
  relocate:(pilotID,from,id,to)=>{
   if(pilotID!==link.pilotID||link.systemID!==from||link.entityID!==id||
    scenes.get(from).ships.has(id)||!scenes.get(to).ships.has(id))
    return {status:"DENIED"};
   link={...link,systemID:to};return {status:"RELOCATED"};
  }
 };
 const deps={sceneForSystem:id=>scenes.get(id),store,service,
  registry,getController:id=>runtimeControl?.entityID===id?runtimeControl:null,
  journalDir:path.join(temp,"transactions")};
 const gate={sourceSystemID:A,destinationSystemID:B,sourceGateID:900,destinationGateID:901};
 const call=transfer=>transfer({pilotID:"coop-pilot-005",entityID:100,gate,
  sourceScene:source,ship,controller:runtimeControl});
 return {temp,source,destination,gate,store,service,registry,deps,call,
  getEntity:()=>entity,getController:()=>control,getLink:()=>link,
  setDestinationFailure:x=>{failDestination=x},cleanup:()=>fs.rmSync(temp,{recursive:true,force:true})};
}
test("same native EveJS entity ID crosses systems with unmodified HP, modules and cargo",()=>{
 const x=fixture();
 try{
  const native=createNativeGateTransfer(x.deps);
  const oldCargo=x.store.listNativeCargoForEntity(100);
  const oldModules=x.store.listNativeModulesForEntity(100);
  const result=x.call(native.transfer);
  assert.equal(result.success,true);
  assert.equal(result.entityID,100);assert.equal(result.systemID,B);
  assert.equal(result.verifiedSourceAbsent,true);
  assert.equal(result.verifiedDestinationPresent,true);
  assert.equal(x.source.getEntityByID(100),null);
  assert.equal(x.destination.getEntityByID(100).itemID,100);
  assert.equal(x.getEntity().systemID,B);
  assert.equal(x.getEntity().conditionState.shieldCharge,0.6);
  assert.deepEqual(x.store.listNativeModulesForEntity(100),oldModules);
  assert.deepEqual(x.store.listNativeCargoForEntity(100),oldCargo);
  assert.equal(x.getLink().systemID,B);
  assert.equal(native.recoverPending().status,"CLEAN");
 }finally{x.cleanup()}
});
test("failed native destination materialization rolls back original ship and store",()=>{
 const x=fixture();
 try{
  x.setDestinationFailure(true);
  const native=createNativeGateTransfer(x.deps);
  const result=x.call(native.transfer);
  assert.equal(result.success,false);
  assert.equal(result.rolledBack,true);
  assert.equal(x.getEntity().systemID,A);
  assert.equal(x.source.getEntityByID(100).itemID,100);
  assert.equal(x.destination.getEntityByID(100),null);
  assert.equal(x.getLink().systemID,A);
  assert.equal(native.recoverPending().status,"CLEAN");
 }finally{x.cleanup()}
});
test("a non-native player ship, combat active module or warp scramble prevents source removal",()=>{
 const x=fixture();
 try{
  const native=createNativeGateTransfer(x.deps);
  const args={pilotID:"coop-pilot-005",entityID:100,gate:x.gate,
   sourceScene:x.source,ship:x.source.getEntityByID(100),controller:x.deps.getController(100)};
  assert.equal(native.transfer({...args,ship:{...args.ship,session:{characterID:9}}}).success,false);
  args.ship.activeModuleEffects=new Map([[1,{moduleID:1}]]);
  assert.equal(native.transfer(args).success,false);
  args.ship.activeModuleEffects.clear();
  const scrambled=createNativeGateTransfer({...x.deps,isScrambled:()=>true});
  assert.equal(scrambled.transfer(args).success,false);
  assert.equal(x.source.getEntityByID(100).itemID,100);
 }finally{x.cleanup()}
});
test("crash journal reverts half-applied native store relocation to original source",()=>{
 const x=fixture();
 try{
  fs.mkdirSync(x.deps.journalDir,{recursive:true});
  fs.writeFileSync(path.join(x.deps.journalDir,"coop-pilot-005.json"),JSON.stringify({
   version:1,pilotID:"coop-pilot-005",entityID:100,
   sourceSystemID:A,destinationSystemID:B,phase:"DESTINATION_RECORDS_WRITTEN",
   restoreEntity:x.store.getNativeEntity(100),restoreController:x.store.getNativeController(100)
  }));
  x.source.ships.delete(100);
  x.store.upsertNativeEntity({...x.getEntity(),systemID:B});
  x.store.upsertNativeController({...x.getController(),systemID:B});
  const out=createNativeGateTransfer(x.deps).recoverPending();
  assert.equal(out.status,"RECOVERED");
  assert.equal(out.recovered,1);
  assert.equal(x.source.getEntityByID(100).itemID,100);
  assert.equal(x.getEntity().systemID,A);
  assert.equal(x.getLink().systemID,A);
 }finally{x.cleanup()}
});
test("malformed journal fails closed instead of deleting an unknown ship",()=>{
 const x=fixture();
 try{
  fs.mkdirSync(x.deps.journalDir,{recursive:true});
  fs.writeFileSync(path.join(x.deps.journalDir,"coop-pilot-005.json"),"{not json");
  const out=createNativeGateTransfer(x.deps).recoverPending();
  assert.equal(out.status,"NEEDS_OPERATOR_REPAIR");
  assert.equal(out.pending[0].error,"CORRUPT_JOURNAL");
  assert.equal(x.source.getEntityByID(100).itemID,100);
 }finally{x.cleanup()}
});

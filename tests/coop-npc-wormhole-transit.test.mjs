import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNpcWormholeTransit}=require("../integration/coopNpcWormholeTransit.cjs");
const sid=30000142,did=31000001,id=980000000321,
 sourceEndpoint=9920000000321,destEndpoint=9920000000322,pairID=22;
function fixture(root){
 let now=1000000,commitCalls=0,failMassFlush=false;
 const ship={itemID:id,kind:"ship",nativeNpc:true,ownerID:901,
  corporationID:700,systemID:sid,position:{x:0,y:0,z:0},
  mass:100000,mode:"STOP",radius:50};
 const from={itemID:sourceEndpoint,kind:"wormhole",wormholePairID:pairID,
  position:{x:1000,y:0,z:0},radius:500};
 const to={itemID:destEndpoint,kind:"wormhole",wormholePairID:pairID,
  position:{x:1000000,y:0,z:0},radius:500};
 const sourceItems=new Map([[id,ship],[sourceEndpoint,from]]);
 const destItems=new Map([[destEndpoint,to]]);
 const source={systemID:sid,getEntityByID:k=>sourceItems.get(k)};
 const destination={systemID:did,getEntityByID:k=>destItems.get(k)};
 const scenes=new Map([[sid,source],[did,destination]]);
 const entity={entityID:id,systemID:sid,ownerID:901,corporationID:700};
 const controller={entityID:id,systemID:sid,manualOrder:null};
 const rows={entity:{...entity},controller:{...controller},
  modules:[{moduleID:980100000321,entityID:id,ownerID:901}],
  cargo:[{cargoID:980200000321,entityID:id,ownerID:901,quantity:1}]};
 const pair={pairID,state:"active",remainingMass:1000000,maxJumpMass:500000,
  totalMass:1000000,source:{endpointID:sourceEndpoint,systemID:sid,
   position:{...from.position}},destination:{endpointID:destEndpoint,systemID:did,
   position:{...to.position}}};
 const state={pairsByID:{"22":pair},polarizationByCharacter:{}};
 const store={
  getNativeEntity:()=>({...rows.entity}),
  getNativeController:()=>({...rows.controller}),
  listNativeModulesForEntity:()=>rows.modules.map(x=>({...x})),
  listNativeCargoForEntity:()=>rows.cargo.map(x=>({...x})),
  upsertNativeEntity:r=>{rows.entity={...r};return {success:true}},
  upsertNativeController:r=>{rows.controller={...r};return {success:true}}
 };
 const service={
  dematerializeNativeController:()=>{sourceItems.delete(id);return {success:true}},
  materializeStoredNativeController:(scene,shipID)=>{
   if(scene!==destination||shipID!==id)return {success:false};
   destItems.set(id,{...ship,systemID:did,position:{...rows.entity.position}});
   return {success:true};
  }
 };
 const links={"coop-pilot-321":{pilotID:"coop-pilot-321",entityID:id,systemID:sid}};
 const registry={snapshot:()=>({links}),
  relocate:(pilot,oldSystem,shipID,newSystem)=>{
   if(oldSystem!==sid||shipID!==id||newSystem!==did)return {status:"BLOCKED"};
   links[pilot]={pilotID:pilot,entityID:id,systemID:newSystem};
   return {status:"RELOCATED"};
  }
 };
 const wormholes={
  prepareJump:(eid,who,mass)=>eid===sourceEndpoint&&who===id&&mass===100000?
   {success:true,data:{pairID,role:"source",pair:JSON.parse(JSON.stringify(pair)),
    destinationEndpointID:destEndpoint,destinationSystemID:did}}:
   {success:false},
  commitJump:(_eid,who,mass)=>{
   commitCalls++;
   pair.remainingMass-=mass;
   state.polarizationByCharacter[String(who)]={[sourceEndpoint]:{endAtMs:now+300000}};
   return {success:true};
  },
  buildJumpSpawnState:()=>({anchorType:"wormhole",anchorID:destEndpoint,
   position:{x:1008000,y:0,z:0}})
 };
 const wormholeState={getStateSnapshot:()=>state};
 const gameStore={flushTableSync:table=>{
  if(table==="wormholeRuntimeState"&&failMassFlush)return {success:false};
  return {success:true};
 }};
 const make=()=>createNpcWormholeTransit({store,service,registry,
  wormholes,wormholeState,gameStore,sceneForSystem:k=>scenes.get(k),root,
  clock:()=>now});
 const args={pilotID:"coop-pilot-321",entityID:id,scene:source,
  endpointID:sourceEndpoint,assignments:[{pilotID:"coop-pilot-321",entityID:id,systemID:sid}]};
 return{make,args,state,pair,sourceItems,destItems,rows,links,
  get commits(){return commitCalls},
  failFlush:v=>{failMassFlush=v}};
}
function temp(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"evejs-ex03-native-wh-"));
 t.after(()=>fs.rmSync(root,{force:true,recursive:true}));
 return root;
}
test("EX-03B16 original NPC ship, modules and cargo cross wormhole with paid mass and polarization",t=>{
 const f=fixture(temp(t)),drive=f.make();
 const result=drive.cross(f.args);
 assert.equal(result.status,"NATIVE_NPC_WORMHOLE_ARRIVED",JSON.stringify(result));
 assert.equal(result.nativeMassRefunded,false);
 assert.equal(result.preservedModules,true);
 assert.equal(result.preservedCargo,true);
 assert.equal(f.sourceItems.has(id),false);
 assert.equal(f.destItems.has(id),true);
 assert.equal(f.destItems.get(id).itemID,id);
 assert.equal(f.rows.modules[0].moduleID,980100000321);
 assert.equal(f.rows.cargo[0].cargoID,980200000321);
 assert.equal(f.state.pairsByID["22"].remainingMass,900000);
 assert.equal(f.state.polarizationByCharacter[String(id)][String(sourceEndpoint)].endAtMs,1300000);
 assert.equal(f.commits,1);
 assert.equal(f.make().inspectPilot("coop-pilot-321").blocked,false);
});
test("EX-03B16 mass committed but original SQLite flush failed: quarantine survives restart",t=>{
 const f=fixture(temp(t)),drive=f.make();
 f.failFlush(true);
 const result=drive.cross(f.args);
 assert.equal(result.status,"NEEDS_OPERATOR_REPAIR");
 assert.equal(result.nativeMassRefunded,false);
 assert.equal(f.state.pairsByID["22"].remainingMass,900000);
 assert.equal(f.commits,1);
 assert.equal(f.make().inspectPilot("coop-pilot-321").blocked,true);
 assert.equal(drive.cross(f.args).status,"BLOCKED");
 assert.equal(f.commits,1,"no double wormhole mass debit");
});
test("EX-03B16 no physical wormhole, wrong owner or vessel warp refuses BEFORE mass mutation",t=>{
 for(const mutate of [
  f=>{f.sourceItems.get(id).position.x=200000},
  f=>{f.sourceItems.get(id).session={characterID:42}},
  f=>{f.sourceItems.get(id).mode="WARP"},
  f=>{f.sourceItems.get(id).corporationID=45},
  f=>{f.args.assignments=[{pilotID:"coop-pilot-321",entityID:777,systemID:sid}]},
  f=>{f.destItems.delete(destEndpoint)}
 ]){
  const f=fixture(temp(t));mutate(f);
  const r=f.make().cross(f.args);
  assert.equal(r.status,"BLOCKED",JSON.stringify(r));
  assert.equal(f.commits,0);
 }
});

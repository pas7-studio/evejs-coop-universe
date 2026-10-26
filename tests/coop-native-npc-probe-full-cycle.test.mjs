import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeNpcProbeFlight}=require("../integration/coopNativeNpcProbeFlight.cjs");
const {createNativeNpcProbeSweep}=require("../integration/coopNativeNpcProbeSweep.cjs");
const {createNativeNpcProbeLifecycle}=require("../integration/coopNativeNpcProbeLifecycle.cjs");
function world(){
 const entityID=980000000111,ownerID=901,corporationID=700,systemID=30000142,
  moduleID=980100000111;
 let now=1000000,writes=0,flushes=0;
 const ship={itemID:entityID,kind:"ship",nativeNpc:true,ownerID,
  corporationID,systemID,position:{x:0,y:0,z:0}};
 const physical=new Map([[entityID,ship]]);
 let cargo=[1,2,3,4].map(i=>({
  cargoID:980200000000+i,entityID,ownerID,moduleID,
  typeID:30013,groupID:479,categoryID:8,quantity:1,singleton:false}));
 const modules=[{entityID,ownerID,moduleID,typeID:17938,
  groupID:481,categoryID:7,moduleState:{online:true}}];
 const scene={systemID,getEntityByID:id=>physical.get(id),
  spawnDynamicEntity:obj=>{if(physical.has(obj.itemID))return{success:false};
   physical.set(obj.itemID,obj);return{success:true}}};
 const assignments=[{pilotID:"coop-pilot-777",entityID,systemID}];
 const source={
  getNativeEntity:()=>({entityID,systemID,ownerID,corporationID}),
  getController:()=>({entityID,systemID}),
  listNativeCargoForEntity:()=>cargo.map(c=>({...c,
   deployedProbe:c.deployedProbe?{...c.deployedProbe}:undefined})),
  upsertNativeCargo:row=>{writes++;cargo=cargo.map(c=>c.cargoID===row.cargoID?row:c);
   return{success:true}},
  flushNpcCargo:()=>{flushes++;return{success:true}},
  clock:()=>now
 };
 const refreshNativeCargoProjection=s=>{
  s.nativeCargoItems=cargo.filter(c=>c.quantity>0)
   .map(c=>({itemID:c.cargoID,quantity:c.quantity}));
  return true;
 };
 const relocateNativeProbe=({scene,row})=>{
  const present=scene.getEntityByID(row.cargoID);
  if(!present||present.nativeNpcProbe!==true||
     present.nativeNpcCargoID!==row.cargoID)return {success:false};
  present.position={...row.deployedProbe.position};
  present.targetPoint={...row.deployedProbe.position};
  return {success:true};
 };
 const flightOptions={...source,relocateNativeProbe,
  listNativeModulesForEntity:()=>modules,compatibleCharges:()=>[30013],
  resolveProbeRange:(_type,step)=>({rangeStep:step,scanRange:1e10}),
  refreshNativeCargoProjection,
  buildProbeSceneEntity:(p,{ownerID:owner,systemID:system})=>({
   itemID:p.probeID,kind:"probe",ownerID:owner,systemID:system,
   typeID:p.typeID,position:{x:p.pos[0],y:p.pos[1],z:p.pos[2]}
  })
 };
 const lifecycleOptions={...source,
  removeNativeProbe:(_system,id)=>{physical.delete(id);return {success:true}},
  refreshNativeCargoProjection
 };
 const sweepOptions={...source,relocateNativeProbe,maxSteps:32,cellSpacingMeters:2e10};
 let flight=createNativeNpcProbeFlight(flightOptions);
 let sweep=createNativeNpcProbeSweep(sweepOptions);
 let lifecycle=createNativeNpcProbeLifecycle(lifecycleOptions);
 const args={scene,entityID,assignments};
 return {
  ship,physical,scene,rows:()=>cargo,
  launch:()=>flight.tick(args),move:()=>sweep.tick(args),
  end:(other={})=>lifecycle.tick({...args,...other}),
  restart:()=>{flight=createNativeNpcProbeFlight(flightOptions);
   sweep=createNativeNpcProbeSweep(sweepOptions);
   lifecycle=createNativeNpcProbeLifecycle(lifecycleOptions)},
  advance:ms=>{now+=ms},writes:()=>writes,flushes:()=>flushes
 };
}
test("EX-03B5 integrated four original launches, sweep and expiry never mint or duplicate cargo",()=>{
 const w=world();
 for(let i=0;i<4;i++)assert.equal(w.launch().status,"NATIVE_PROBE_LAUNCHED");
 assert.equal(new Set(w.rows().map(r=>r.deployedProbe.probeID)).size,4);
 assert.equal(w.physical.size,5);
 for(let i=0;i<4;i++)assert.equal(w.move().status,"SWEEP_ORIGINAL_PROBE_MOVED");
 assert.equal(w.rows().every(r=>r.deployedProbe.sweepStep===1),true);
 w.advance(3600000);
 for(let i=0;i<4;i++){
  assert.equal(w.end().status,"NPC_PROBE_EXPIRY_COMMITTED");
  // Simulate termination between source debit and physical cleanup:
  w.restart();
  assert.equal(w.end().status,"NPC_PROBE_EXPIRED");
 }
 assert.equal(w.rows().every(r=>r.quantity===0),true);
 assert.equal(w.rows().every(r=>r.deployedProbe.status==="EXPIRED"),true);
 assert.equal(w.physical.size,1);
 assert.equal(w.rows().filter(r=>r.quantity>0).length,0);
 assert.equal(w.end().status,"NO_LIFECYCLE_ACTION");
});
test("EX-03B5 crash between recall intent and refund preserves exactly one original ID",()=>{
 const w=world(),result=w.launch();
 assert.equal(result.status,"NATIVE_PROBE_LAUNCHED");
 const id=result.cargoID,p=w.physical.get(id);
 // Legitimate near-hull movement is reflected both in original durable
 // flight receipt and in the same physical probe: no teleport refund.
 const source=w.rows().find(r=>r.cargoID===id);
 p.position={x:1000,y:0,z:0};
 source.deployedProbe.position={...p.position};
 assert.equal(w.end({requestRecall:true}).status,"NPC_PROBE_RECALL_COMMITTED");
 assert.equal(source.quantity,0);
 assert.equal(w.physical.has(id),true);
 w.restart();
 assert.equal(w.end().status,"NPC_PROBE_RETURNED");
 assert.equal(w.physical.has(id),false);
 assert.equal(w.rows().find(r=>r.cargoID===id).quantity,1);
 assert.equal(w.ship.nativeCargoItems.filter(r=>r.itemID===id).length,1);
 assert.equal(w.end().status,"NO_LIFECYCLE_ACTION");
});

test("EX-03B8 after two-phase recall original probe cargoID can be launched again",()=>{
 const w=world(),first=w.launch();
 assert.equal(first.status,"NATIVE_PROBE_LAUNCHED");
 const id=first.cargoID,probe=w.physical.get(id);
 probe.position={x:1000,y:0,z:0};
 const row=w.rows().find(x=>x.cargoID===id);
 row.deployedProbe.position={...probe.position};
 assert.equal(w.end({requestRecall:true}).status,"NPC_PROBE_RECALL_COMMITTED");
 assert.equal(w.end().status,"NPC_PROBE_RETURNED");
 assert.equal(w.physical.has(id),false);
 w.restart();
 const again=w.launch();
 assert.equal(again.status,"NATIVE_PROBE_LAUNCHED");
 assert.equal(again.cargoID,id);
 assert.equal(w.rows().find(x=>x.cargoID===id).quantity,0);
 assert.equal(w.physical.get(id).nativeNpcCargoID,id);
});

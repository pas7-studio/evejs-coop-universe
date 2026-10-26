import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {createNativeNpcProbeSweep}=require("../integration/coopNativeNpcProbeSweep.cjs");
function fixture(){
 const systemID=30000142,entityID=980000000100,ownerID=901,corporationID=700,
  originPosition={x:1000,y:0,z:4000};
 let writes=0,flushes=0,failFlush=false,clock=1e6;
 let rows=Array.from({length:4},(_,i)=>({
  cargoID:980200000000+i,entityID,ownerID,quantity:0,groupID:479,
  categoryID:8,typeID:3001,singleton:false,
  deployedProbe:{status:"IN_SPACE",probeID:980200000000+i,
   entityID,ownerID,systemID,typeID:3001,
   launchedAtMs:clock-1000,position:{x:originPosition.x+i*1000,y:0,z:originPosition.z},
   originPosition:{...originPosition},sweepStep:0,rangeStep:4,scanRange:1e10}
 }));
 const physical=new Map(rows.map(row=>[row.cargoID,{
  itemID:row.cargoID,kind:"probe",nativeNpcProbe:true,nativeNpcCargoID:row.cargoID,
  typeID:row.typeID,ownerID,systemID,
  position:{...row.deployedProbe.position},
  targetPoint:{...row.deployedProbe.position}
 }]));
 const ship={itemID:entityID,kind:"ship",nativeNpc:true,ownerID,
  corporationID,position:{...originPosition}};
 physical.set(entityID,ship);
 const scene={systemID,getEntityByID:id=>physical.get(id)};
 const assignments=[{pilotID:"coop-pilot-777",entityID,systemID}];
 const opts={
  getNativeEntity:()=>({entityID,systemID,ownerID,corporationID}),
  getController:()=>({entityID,systemID}),
  listNativeCargoForEntity:()=>rows.map(x=>({...x,deployedProbe:{...x.deployedProbe}})),
  upsertNativeCargo:row=>{writes++;rows=rows.map(x=>x.cargoID===row.cargoID?row:x);
   return {success:true}},
  flushNpcCargo:()=>{flushes++;return {success:!failFlush}},
  clock:()=>clock,maxSteps:32,cellSpacingMeters:2e10
 };
 const guard=createNativeNpcProbeSweep(opts);
 return {rows:()=>rows,physical,ship,scene,assignments,
  tick:(extra={})=>guard.tick({scene,entityID,assignments,...extra}),
  advance:ms=>{clock+=ms},fail:()=>{failFlush=true},
  writes:()=>writes,flushes:()=>flushes};
}
test("blind sweep moves exactly one original sealed probe, flush before move",()=>{
 const f=fixture(),before={...f.physical.get(980200000000).position};
 const r=f.tick();
 assert.equal(r.status,"SWEEP_ORIGINAL_PROBE_MOVED");
 assert.equal(r.moved,1);assert.equal(f.writes(),1);assert.equal(f.flushes(),1);
 assert.equal(r.originalCargoID,980200000000);
 assert.equal(f.rows()[0].deployedProbe.sweepStep,1);
 assert.notDeepEqual(f.physical.get(r.originalCargoID).position,before);
 assert.deepEqual(f.physical.get(r.originalCargoID).position,
  f.rows()[0].deployedProbe.position);
});
test("four ticks advance four distinct original probes to same blind cell",()=>{
 const f=fixture();const ids=[];
 for(let i=0;i<4;i++){const r=f.tick();assert.equal(r.moved,1);ids.push(r.originalCargoID)}
 assert.equal(new Set(ids).size,4);
 assert.ok(f.rows().every(x=>x.deployedProbe.sweepStep===1));
 assert.deepEqual(f.rows()[0].deployedProbe.position,f.rows()[3].deployedProbe.position);
 assert.equal(f.writes(),4);assert.equal(f.flushes(),4);
});
test("perfect native scan stops movement without any cargo write",()=>{
 const f=fixture();assert.equal(f.tick({scanHasPerfectProof:true}).status,"SCAN_FOUND");
 assert.equal(f.writes(),0);assert.equal(f.flushes(),0);
});
test("no physical cargo proof, wrong hull or non-matching corp fails closed",()=>{
 for(const mutate of [
  f=>{f.physical.delete(980200000000)},
  f=>{f.ship.corporationID=701},
  f=>{f.physical.get(980200000000).nativeNpcCargoID=2},
  f=>{f.rows()[0].deployedProbe.originPosition.x+=123},
  f=>{f.rows()[0].singleton=true}
 ]){
  const f=fixture();mutate(f);
  assert.equal(f.tick().status,"BLOCKED");assert.equal(f.writes(),0);
 }
});
test("durability failure never moves physical probe and quarantines subsequent write",()=>{
 const f=fixture(),original={...f.physical.get(980200000000).position};
 f.fail();const r=f.tick();
 assert.equal(r.reason,"SWEEP_CARGO_DURABILITY_UNCONFIRMED");
 assert.deepEqual(f.physical.get(980200000000).position,original);
 const a=f.writes(),b=f.flushes();
 assert.equal(f.tick().status,"SWEEP_GEOMETRY_RECONCILED");
 assert.equal(f.tick().reason,"SWEEP_OPERATOR_REPAIR_REQUIRED");
 assert.equal(f.writes(),a);assert.equal(f.flushes(),b);
});
test("crash after durable move reconciles sealed original geometry without writing",()=>{
 const f=fixture(),result=f.tick();assert.equal(result.moved,1);
 const p=f.physical.get(result.originalCargoID);
 p.position={x:1000,y:0,z:4000}; // simulate pre-move scene after durable write
 const w=f.writes(),fl=f.flushes();
 assert.equal(f.tick().status,"SWEEP_GEOMETRY_RECONCILED");
 assert.deepEqual(p.position,f.rows()[0].deployedProbe.position);
 assert.equal(f.writes(),w);assert.equal(f.flushes(),fl);
});
test("source-first reconciliation refuses to reposition foreign original-ID collision",()=>{
 const f=fixture(),p=f.physical.get(980200000000);
 p.nativeNpcProbe=false;p.position.x+=1e6;
 assert.equal(f.tick().status,"BLOCKED");assert.equal(f.writes(),0);
});
test("expired flights and player session impersonation cannot move NPC probes",()=>{
 const f=fixture();f.advance(3600001);
 assert.equal(f.tick().status,"BLOCKED");
 const g=fixture();g.ship.session={characterID:202};
 assert.equal(g.tick().status,"BLOCKED");
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const root=new URL("../integration/",import.meta.url);
const read=name=>fs.readFileSync(new URL(name,root),"utf8");
const {createOrderArbiter}=require("../integration/coopNpcOrderArbiter.cjs");
const {createOrderBridge}=require("../integration/coopNpcOrderBridge.cjs");
const {createExpeditionDirector}=require("../integration/coopNpcExpeditionDirector.cjs");
const sid=30000142;
function orderFixture(){
 let now=1000000;
 const assignments=[{pilotID:"coop-pilot-023",entityID:23,systemID:sid}];
 const entity={itemID:23,kind:"ship",nativeNpc:true,systemID:sid,
   position:{x:0,y:0,z:0},mode:"STOP"};
 const scene={systemID:sid,getEntityByID:id=>id===23?entity:null};
 const ctrl={entityID:23,systemID:sid,manualOrder:null,currentTargetID:0};
 const arbiter=createOrderArbiter({clock:()=>now});
 const bridge=createOrderBridge({arbiter,assignments:()=>assignments,
  sceneForSystem:()=>scene,getController:()=>ctrl});
 const issue=(owner,action)=>bridge.issue({systemID:sid,entityID:23,owner,
  action,execute:()=>({success:true})});
 return {arbiter,bridge,issue,assignments,entity,ctrl,advance:ms=>{now+=ms}};
}
test("EX-02 is registered as existing 30s A-Life phase; no new scheduler",()=>{
 const source=read("coopVirtualWorldRuntime.cjs");
 const start=source.indexOf("timer=setInterval(()=>worldPhaseCoordinator.tick(runPhase=>{");
 const end=source.indexOf(" }),30000);",start);
 assert.ok(start>0&&end>start);
 const block=source.slice(start,end);
 assert.match(block,/runPhase\("native-expeditions",advanceNativeNpcExpeditions\)/);
 assert.match(block,/EVEJS_COOP_NPC_EXPEDITIONS==="1"/);
 assert.match(source,/native\.scenes instanceof Map\?native\.scenes\.get\(systemID\):null/);
 assert.match(source,/signatures\.listSystemSignatureSites\(systemID\)/);
 assert.match(source,/identityRegistry\.snapshot\(\)\?\.links/);
 assert.doesNotMatch(read("coopNpcExpeditionDirector.cjs"),/\bsetInterval\s*\(/);
});
test("EX-02 overlay installer registers BOTH modules and requires native guards",()=>{
 const overlay=fs.readFileSync(new URL("../scripts/overlay-spec.cjs",import.meta.url),"utf8");
 assert.match(overlay,/"coopNpcExpeditionCompetition","coopNpcExpeditionDirector"/);
 assert.match(read("coopNpcOrderArbiter.cjs"),/"WAR","EXPEDITION"/);
 assert.match(read("coopNpcOrderBridge.cjs"),/"GATE","EXPEDITION"/);
});
test("expedition native order uses existing arbiter, not a parallel owner",()=>{
 const f=orderFixture();
 assert.equal(f.issue("EXPEDITION","expedition-rendezvous").success,true);
 assert.equal(f.arbiter.snapshot().leases[0].owner,"EXPEDITION");
 assert.equal(f.issue("PATROL","warp").success,false);
});
test("existing patrol lease refuses lower-priority expedition reassignment",()=>{
 const f=orderFixture();
 assert.equal(f.issue("PATROL","warp").success,true);
 const r=f.issue("EXPEDITION","expedition-rendezvous");
 assert.equal(r.success,false);assert.equal(r.errorMsg,"COOP_NPC_ORDER_LEASED");
 assert.equal(f.arbiter.snapshot().leases[0].owner,"PATROL");
});
test("verified emergency tactics may preempt expedition when native ship is idle",()=>{
 const f=orderFixture();
 assert.equal(f.issue("EXPEDITION","expedition-rendezvous").success,true);
 assert.equal(f.issue("TACTICS","retreat").success,true);
 assert.equal(f.arbiter.snapshot().leases[0].owner,"TACTICS");
});
test("active native warp blocks new expedition even without arbiter lease",()=>{
 const f=orderFixture();f.entity.mode="WARP";
 assert.equal(f.issue("EXPEDITION","expedition-rendezvous").success,false);
 assert.equal(f.arbiter.snapshot().leases.length,0);
});
test("duplicate durable named pilot assignment cannot gain expedition order",()=>{
 const f=orderFixture();
 f.assignments.push({pilotID:"coop-pilot-023",entityID:24,systemID:sid});
 assert.equal(f.issue("EXPEDITION","expedition-rendezvous").success,false);
});

function nativeScoutHandoffFixture(){
 let now=1000000;
 const systemID=sid,ownerID=901,corpID=700;
 const site={siteID:440,solarSystemID:systemID,targetID:"NATIVE-440",
  siteKind:"signature",family:"relic",instanceID:900,
  actualPosition:{x:1e9,y:2e9,z:3e9}};
 const ships=new Map([
  [21,{itemID:21,kind:"ship",nativeNpc:true,ownerID,corporationID:corpID,
   systemID,mode:"STOP",position:{x:0,y:0,z:0}}],
  [23,{itemID:23,kind:"ship",nativeNpc:true,ownerID,corporationID:corpID,
   systemID,mode:"STOP",position:{x:1000000,y:0,z:0}}]
 ]);
 const native=new Map([...ships.keys()].map(entityID=>[entityID,{
  entityID,ownerID,corporationID:corpID,systemID
 }]));
 const controllers=new Map([...ships.keys()].map(entityID=>[entityID,{
  entityID,systemID,manualOrder:null,currentTargetID:0
 }]));
 const assignments=[{pilotID:"coop-pilot-021",entityID:21,systemID},
  {pilotID:"coop-pilot-023",entityID:23,systemID}];
 const roles={"coop-pilot-021":"patrol","coop-pilot-023":"patrol"};
 const siteObjects=new Map();
 const scene={systemID,sessions:new Map(),getEntityByID:id=>
  ships.get(id)||siteObjects.get(id)};
 const arbiter=createOrderArbiter({clock:()=>now,leaseMs:120000});
 const bridge=createOrderBridge({arbiter,assignments:()=>assignments,
  sceneForSystem:()=>scene,getController:id=>controllers.get(id)});
 const fingerprint=JSON.stringify([site.siteID,site.targetID,site.siteKind,
  site.family,null,site.instanceID,null,
  site.actualPosition.x,site.actualPosition.y,site.actualPosition.z]);
 const proof={source:"ORIGINAL_PHYSICAL_NPC_PROBE_SCAN",nativeScanCertainty:1,
  originalProbeCount:4,systemID,scoutEntityID:21,
  pilotID:"coop-pilot-021",corporationID:corpID,siteID:site.siteID,
  targetID:site.targetID,siteFingerprint:fingerprint,
  actualPosition:{...site.actualPosition}};
 const warps=[];
 const director=createExpeditionDirector({
  clock:()=>now,listNativeSites:()=>[site],
  getNativeEntity:id=>native.get(id),getController:id=>controllers.get(id),
  orderBridge:bridge,isNativeProbeScout:id=>id===21,
  nativeProbeScan:({entityID})=>entityID===21&&ships.get(21).mode!=="WARP"?
   {status:"NATIVE_PROBE_SCANNED",proofs:[proof]}:
   {status:"BLOCKED",proofs:[]},
  warpToPoint:(entityID,position)=>{
   warps.push({entityID,position});
   ships.get(entityID).mode="WARP";
   return {success:true};
  }
 });
 const tick=()=>director.tick({scene,assignments,roles});
 return{tick,site,ships,siteObjects,bridge,arbiter,warps,controllers,
  advance:ms=>{now+=ms}};
}

test("EX-03B13 actual native order bridge/arbiter accepts scout-first warp, then witnessed patrol",()=>{
 const f=nativeScoutHandoffFixture();
 const first=f.tick();
 assert.equal(first.remoteScans,1);
 assert.equal(first.scoutWarpOrders,1);
 assert.equal(first.patrolWarpOrders,0);
 assert.deepEqual(f.warps,[{entityID:21,position:f.site.actualPosition}]);
 assert.equal(f.arbiter.snapshot().leases.find(x=>x.entityID===21).owner,"EXPEDITION");
 assert.equal(f.tick().orders,0,"active scout warp cannot dispatch followers");
 assert.equal(f.warps.length,1);
 f.ships.get(21).mode="STOP";
 f.ships.get(21).position={...f.site.actualPosition};
 assert.equal(f.tick().orders,0,"catalog-only arrival is not physical discovery");
 f.siteObjects.set(f.site.siteID,{itemID:f.site.siteID,kind:"signature",
  position:{...f.site.actualPosition}});
 const arrived=f.tick();
 assert.equal(arrived.scoutOnGridVerified,1);
 assert.equal(arrived.patrolWarpOrders,1);
 assert.equal(arrived.scoutWarpOrders,0);
 assert.equal(f.warps[1].entityID,23);
 assert.deepEqual(f.warps[1].position,f.site.actualPosition);
 assert.equal(f.arbiter.snapshot().leases.find(x=>x.entityID===23).owner,"EXPEDITION");
 assert.equal(f.tick().orders,0,"no replay of in-flight follower or scout");
});

test("EX-03B13 existing native patrol lease cannot be stolen by scanned scout",()=>{
 const f=nativeScoutHandoffFixture();
 const claimed=f.bridge.issue({
  entityID:21,systemID:sid,owner:"PATROL",action:"orbit",
  execute:()=>({success:true})
 });
 assert.equal(claimed.success,true);
 const result=f.tick();
 assert.equal(result.remoteScans,1);
 assert.equal(result.scoutWarpOrders,0);
 assert.equal(result.patrolWarpOrders,0);
 assert.equal(f.warps.length,0);
 assert.equal(f.arbiter.snapshot().leases.find(x=>x.entityID===21).owner,"PATROL");
});

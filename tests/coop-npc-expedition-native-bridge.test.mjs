import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const root=new URL("../integration/",import.meta.url);
const read=name=>fs.readFileSync(new URL(name,root),"utf8");
const {createOrderArbiter}=require("../integration/coopNpcOrderArbiter.cjs");
const {createOrderBridge}=require("../integration/coopNpcOrderBridge.cjs");
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

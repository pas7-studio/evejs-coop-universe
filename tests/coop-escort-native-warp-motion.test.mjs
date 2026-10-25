import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch,ANCHOR,HOOK}=require("../scripts/coop-escort-native-motion-patch.cjs");
const CODE_ROOT=process.env.EVEJS_COOP_PINNED_CODE_PATH||"";
const ACTUAL=CODE_ROOT?path.join(CODE_ROOT,"server","src","space",
 "movement","warp","movementWarpState.js"):null;
const PINNED=ACTUAL?fs.readFileSync(ACTUAL,"utf8"):null;
// Independently tests the same actual native movement call chain even when
// the pinned checkout is unavailable in a GitHub-only review session.
const FIXTURE=`"use strict";
function createMovementWarpStateHelpers(deps={}){
 function advanceSessionlessWarpIngress(entity,now){
  const ingressState=entity.sessionlessWarpIngress;
  const previous=entity.position;
  const progress=Math.max(0,Math.min(1,(now-ingressState.startTimeMs)/
   (ingressState.travelCompleteAtMs-ingressState.startTimeMs)));
  const eased=progress*progress*(3-2*progress);
  entity.position={x:ingressState.targetPoint.x*eased,
   y:ingressState.targetPoint.y*eased,z:ingressState.targetPoint.z*eased};
    ingressState.lastUpdateAtMs = now;
  return {changed:entity.position.x!==previous.x};
 }
 return {advanceSessionlessWarpIngress};
}
module.exports={createMovementWarpStateHelpers};
`;
const SOURCE=PINNED||FIXTURE;
const vect=x=>({x:x?.x||0,y:x?.y||0,z:x?.z||0});
const subtract=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const magnitude=a=>Math.hypot(a.x,a.y,a.z);
const dist=(a,b)=>magnitude(subtract(a,b));
const deps={
 addVectors:(a,b)=>({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z}),
 clamp:(x,a,b)=>Math.max(a,Math.min(b,x)),
 cloneVector:vect,distance:dist,magnitude,
 normalizeVector:a=>{const d=magnitude(a)||1;return{x:a.x/d,y:a.y/d,z:a.z/d}},
 scaleVector:(a,k)=>({x:a.x*k,y:a.y*k,z:a.z*k}),
 subtractVectors:subtract,
 toFiniteNumber:(x,f=0)=>Number.isFinite(Number(x))?Number(x):f,
 serializeWarpState:()=>({}),
};
function create(nativeNpc=true){
 return {itemID:901,nativeNpc,position:{x:0,y:0,z:0},
  velocity:{x:0,y:0,z:0},direction:{x:1,y:0,z:0},mode:"WARP",
  sessionlessWarpIngress:{startTimeMs:1000,travelCompleteAtMs:7000,
   completeAtMs:7000,lastUpdateAtMs:1000,origin:{x:0,y:0,z:0},
   targetPoint:{x:100000,y:0,z:0}}};
}
function make(env,observe=()=>{}){
 const module={exports:{}};
 const req=x=>{
  if(x!=="../../coopNativeStationArrival")throw Error("unexpected native import "+x);
  return {noteNativeMotion:observe};
 };
 new Function("module","require","process",patch(SOURCE))(module,req,{env});
 return module.exports.createMovementWarpStateHelpers(deps);
}
test("pinned native movement anchor accepts one reversible byte-exact patch",()=>{
 assert.equal(SOURCE.split(ANCHOR).length-1,1);
 const once=patch(SOURCE);
 assert.equal(once.split(HOOK).length-1,1);
 assert.equal(patch(once),once);
 assert.equal(patch(once,{remove:true}),SOURCE);
});
test("actual native interpolated NPC coordinates reach observer AFTER movement",()=>{
 const seen=[],entity=create();
 const helpers=make({EVEJS_COOP_ESCORT_NATIVE_WARP_OBSERVER:"1"},
  (ship,now)=>seen.push({ship,x:ship.position.x,now}));
 const advanced=helpers.advanceSessionlessWarpIngress(entity,3000);
 const expected=100000*(1/3)*(1/3)*(3-(2/3));
 assert.equal(advanced.changed,true);
 assert.ok(Math.abs(entity.position.x-expected)<0.1);
 assert.equal(seen.length,1);
 assert.strictEqual(seen[0].ship,entity);
 assert.ok(Math.abs(seen[0].x-expected)<0.1);
 assert.equal(seen[0].now,3000);
});
test("player, not-native and absent observer flag cannot emit fake NPC proof",()=>{
 for(const flag of ["0",undefined]){
  const seen=[];
  const helper=make(flag?{EVEJS_COOP_ESCORT_NATIVE_WARP_OBSERVER:flag}:{},
   (...args)=>seen.push(args));
  const entity=create(true);
  helper.advanceSessionlessWarpIngress(entity,3000);
  assert.ok(entity.position.x>0);
  assert.equal(seen.length,0);
 }
 const seen=[];
 const helper=make({EVEJS_COOP_ESCORT_NATIVE_WARP_OBSERVER:"1"},
  (...args)=>seen.push(args));
 helper.advanceSessionlessWarpIngress(create(false),3000);
 assert.equal(seen.length,0);
});
test("observer exception cannot break genuine native ship movement",()=>{
 const entity=create(true);
 const helper=make({EVEJS_COOP_ESCORT_NATIVE_WARP_OBSERVER:"1"},
  ()=>{throw Error("SAMPLE_IO_UNAVAILABLE")});
 assert.doesNotThrow(()=>helper.advanceSessionlessWarpIngress(entity,3000));
 assert.ok(entity.position.x>25000&&entity.position.x<27000);
});
test("hook never grants ISK, teleports, rewinds or changes original mode",()=>{
 const source=patch(SOURCE);
 assert.ok(source.includes(HOOK));
 assert.ok(!HOOK.includes("wallet"));
 assert.ok(!HOOK.includes("settle"));
 const e=create(true);
 make({EVEJS_COOP_ESCORT_NATIVE_WARP_OBSERVER:"1"}).
  advanceSessionlessWarpIngress(e,3000);
 assert.equal(e.mode,"WARP");
 assert.equal(e.sessionlessWarpIngress.lastUpdateAtMs,3000);
 assert.equal(e.position.y,0);
});
test("real upstream source patch must pass with CheckPinned even without running Docker",{
 skip:!PINNED},()=>{
 assert.ok(PINNED.length>20000);
 assert.ok(PINNED.includes("function advanceSessionlessWarpIngress(entity, now)"));
 assert.equal(patch(patch(PINNED),{remove:true}),PINNED);
});

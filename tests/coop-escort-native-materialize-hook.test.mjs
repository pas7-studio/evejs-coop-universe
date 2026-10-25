import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {patch,HOOK,ANCHOR}=require("../scripts/coop-escort-ingress-materialize-patch.cjs");
const root=process.env.EVEJS_COOP_PINNED_CODE_PATH;
const native=root?path.join(root,"server","src","space","npc","nativeNpcService.js"):null;
const source=native&&fs.existsSync(native)?fs.readFileSync(native,"utf8"):null;
const fixture=`"use strict";
function materializeNativeRuntimeEntity(scene, entityRecord, controllerRecord, definition) {
  const spawnResult={data:{entity:{nativeNpc:true,kind:"ship"}}};
  const runtimeKind="nativeAmbient";
  const applyNativeRuntimeNpcPresentation=(entity)=>entity;
  const registerNativeRuntimeController=()=>({ready:true});
  const syncNativeAmbientIdleState=(scene,entity,controller)=>{entity.mode="STOP"};
  const entity = applyNativeRuntimeNpcPresentation(
    spawnResult.data.entity,
    entityRecord,
    definition,
  );
  const controller = registerNativeRuntimeController(entityRecord, controllerRecord, definition);
  if (runtimeKind === "nativeAmbient") {
    syncNativeAmbientIdleState(scene, entity, controller, definition);
  }
  return {entity,controller};
}
module.exports={materializeNativeRuntimeEntity};`;
const content=source||fixture;
test("pinned native materializer accepts one exact reversible observer",()=>{
 const applied=patch(content);
 assert.equal(applied.split(HOOK).length-1,1);
 assert.equal(patch(applied),applied);
 assert.equal(patch(applied,{remove:true}),content);
 assert.equal(content.split(ANCHOR).length-1,1);
});
test("native restore runs AFTER stock controller ambient init, not before",()=>{
 const applied=patch(content);
 const i=applied.indexOf(HOOK),lastIdle=applied.lastIndexOf('syncNativeAmbientIdleState(scene, entity, controller, definition);',i);
 assert.ok(lastIdle>=0&&i>lastIdle);
 assert.ok(applied.indexOf("return {",i)>i);
});
test("runtime source without original pinned materialization anchor fails closed",()=>{
 assert.throws(()=>patch('function fakeNativeSpawn(){}'),/PINNED_ANCHOR_MISMATCH/);
});
test("duplicate pinned observer cannot silently install twice",()=>{
 assert.throws(()=>patch(patch(content)+HOOK),/DUPLICATE_HOOK/);
});
test("native source hook never calls warpToPoint, wallet or synthetic trajectory",()=>{
 assert.ok(!HOOK.includes("warpToPoint"));
 assert.ok(!HOOK.includes("amountISK"));
 assert.ok(!HOOK.includes("position="));
});
test("patched native materializer calls recovery AFTER original ambient controller setup",()=>{
 const loaded={exports:{}},events=[];
 const env={env:{EVEJS_COOP_ESCORT_NATIVE_INGRESS_SNAPSHOT:"1"}};
 new Function("module","require","process",patch(fixture))(loaded,k=>{
  if(k!=="../coopNativeStationArrival")throw Error("unexpected import");
  return {restoreNativeIngress:entity=>{
   events.push({kind:entity.kind,previousMode:entity.mode});
   entity.mode="WARP";
  }};
 },env);
 const actual=loaded.exports.materializeNativeRuntimeEntity({},
  {entityID:901},{},{});
 assert.equal(actual.entity.mode,"WARP");
 assert.deepEqual(events,[{kind:"ship",previousMode:"STOP"}]);
});
test("disabled flag leaves original native materializer idle state unchanged",()=>{
 const loaded={exports:{}},events=[];
 new Function("module","require","process",patch(fixture))(loaded,()=>{
  events.push("unexpected native recovery call");
  return {restoreNativeIngress:()=>{}};
 },{env:{EVEJS_COOP_ESCORT_NATIVE_INGRESS_SNAPSHOT:"0"}});
 const actual=loaded.exports.materializeNativeRuntimeEntity({},
  {entityID:901},{},{});
 assert.equal(actual.entity.mode,"STOP");
 assert.deepEqual(events,[]);
});
test("actual pinned 56k+ nativeNpcService source validates byte-exact patch",{
 skip:!source},()=>{
 assert.ok(source.length>20000);
 assert.equal(patch(patch(source),{remove:true}),source);
});

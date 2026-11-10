'use strict';
/** PF82: execute the actual source-pinned EveJS physical FOLLOW API in a
 * side-effect-free harness. Never loads the entire game server or runs PLAY.
 * The existing manual NPC follow path couples movement to combat targeting;
 * Personal Fleet FOLLOW must use npcRuntime.follow instead.
 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const ROOT=process.env.PF82_NATIVE_WORKTREE;
const PINS={
 'Code/server/src/space/npc/npcRuntime.js':'8ee3d4f82db1600094df8de1060a9aa8e575af1a',
 'Code/server/src/space/npc/npcBehaviorLoop.js':'43225cd72240e98e480e94088d3a457377eb5af6',
};
function nativeSource(relative){
 if(typeof ROOT!=='string'||!path.isAbsolute(ROOT)||
    ROOT.split(/[\\/]+/).some(part=>/^(play|prod|production)$/i.test(part)))
  throw Error('PF82_NATIVE_WORK_PATH_UNSAFE_OR_MISSING');
 const bytes=fs.readFileSync(path.join(ROOT,relative));
 const blob=crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`))
  .update(bytes).digest('hex');
 assert.equal(blob,PINS[relative],`PF82_ORIGINAL_EVEJS_SOURCE_PIN_CHANGED: ${relative}`);
 return bytes.toString('utf8');
}
function extract(source,name,nextName){
 const start=`function ${name}(`,next=`\nfunction ${nextName}(`;
 assert.equal(source.split(start).length,2,`PF82_${name}_START_DRIFT`);
 const i=source.indexOf(start),j=source.indexOf(next,i+start.length);
 assert.ok(j>i,`PF82_${name}_END_DRIFT`);
 return source.slice(i,j);
}
function actualManualMovement(script){
 const body=extract(script,'isValidManualMovementTarget','findNearestCombatTarget');
 return new Function(`${body}\nreturn isValidManualMovementTarget;`)();
}
function actualManualTarget(script,allowedCombatTarget){
 const body=extract(script,'resolveDesiredTarget','deactivateNpcWeapons');
 const manualMovement=actualManualMovement(script);
 return new Function('isValidCombatTarget','isValidManualMovementTarget',
  'resolveBehaviorTarget',`${body}\nreturn resolveDesiredTarget;`)(
    allowedCombatTarget,manualMovement,()=>null);
}
function actualPhysicalFollow(script,{physicalMove,ctx,controllerWake}={}){
 const body=extract(script,'follow','orbit');
 const toPositiveInt=(v,def=0)=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):def;
 const toFiniteNumber=(v,def=0)=>Number.isFinite(Number(v))?Number(v):def;
 const npcService={wakeNpcController:controllerWake??(()=>{throw Error('PF82_UNEXPECTED_WAKE')})};
 const spaceRuntime={followDynamicEntity:physicalMove};
 const resolveNpcContext=()=>ctx??{success:true,data:{systemID:300,entityID:1001}};
 return new Function('resolveNpcContext','spaceRuntime','toPositiveInt',
  'toFiniteNumber','npcService',`${body}\nreturn follow;`)(
   resolveNpcContext,spaceRuntime,toPositiveInt,toFiniteNumber,npcService);
}
const runtimeScript=nativeSource('Code/server/src/space/npc/npcRuntime.js');
const behaviorScript=nativeSource('Code/server/src/space/npc/npcBehaviorLoop.js');

test('PF82 source-pins both unmodified original EveJS behavior and physics APIs',()=>{
 assert.ok(runtimeScript.includes('function follow(entityID, targetEntityID, range = 0, options = {})'));
 assert.ok(behaviorScript.includes('function resolveDesiredTarget('));
});
test('legacy stock manual FOLLOW ignores a movement target rejected by combat rules',()=>{
 const e={kind:'ship',itemID:1001},friend={kind:'ship',itemID:2002,
  position:{x:1000,y:0,z:0},ownerID:202};
 const scene={getEntityByID:id=>id===2002?friend:null};
 const original=actualManualTarget(behaviorScript,()=>false);
 const manual={type:'follow',targetID:2002,allowPodKill:false};
 assert.equal(original(scene,{},e,{},manual),null);
});
test('original EveJS physical follow moves toward a friendly player ship without combat classification',()=>{
 let args=null;
 const follow=actualPhysicalFollow(runtimeScript,{physicalMove:(...a)=>{
  args=a;return true;
 }});
 const ret=follow(1001,2002,1500,{wakeController:false,allowWeapons:false});
 assert.equal(ret.success,true);
 assert.deepEqual(args,[300,1001,2002,1500,{wakeController:false,allowWeapons:false}]);
});
test('native physical follow failure is never converted to success',()=>{
 const follow=actualPhysicalFollow(runtimeScript,{physicalMove:()=>false});
 assert.equal(follow(1001,2002,1500,{wakeController:false}).success,false);
});
test('physical follow requires a real native NPC context, not a fabricated actor',()=>{
 const follow=actualPhysicalFollow(runtimeScript,{physicalMove:()=>{
  throw Error('PF82_UNEXPECTED_MOVEMENT');
 },ctx:{success:false,errorMsg:'NPC_NOT_FOUND'}});
 assert.equal(follow(1001,2002,1500,{wakeController:false}).success,false);
});
test('original native follow wakes the NPC only when explicit wake is allowed',()=>{
 let wakes=0;
 const follow=actualPhysicalFollow(runtimeScript,{physicalMove:()=>true,
  controllerWake:()=>wakes++});
 const ret=follow(1001,2002,1500,{wakeController:false});
 assert.equal(ret.success,true);
 assert.equal(wakes,0);
});

test('original behaviorLoop ATTACK promotes live controller to nativeCombat; STOP clears target',()=>{
 const toPositiveInt=(v,def=0)=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):def;
 const toFiniteNumber=(v,def=0)=>Number.isFinite(Number(v))?Number(v):def;
 const normalize= new Function('normalizeOrderType','toPositiveInt','toFiniteNumber',
  `${extract(behaviorScript,'normalizeManualOrder','resolveBehaviorTarget')}\nreturn normalizeManualOrder;`)(
   v=>String(v||'').toLowerCase(),toPositiveInt,toFiniteNumber);
 const controller={entityID:1001,runtimeKind:'nativeAmbient',nextThinkAtMs:9999,
  manualOrder:null,currentTargetID:0,preferredTargetID:0};
 const originalIssue=new Function('getControllerByEntityID','normalizeManualOrder',
  'toPositiveInt',`${extract(behaviorScript,'issueManualOrder','setBehaviorOverrides')}\nreturn issueManualOrder;`)(
   id=>id===1001?controller:null,normalize,toPositiveInt);
 assert.equal(originalIssue(1001,{type:'attack',targetID:2002}).success,true);
 assert.equal(controller.runtimeKind,'nativeCombat');
 assert.equal(controller.manualOrder.type,'attack');
 assert.equal(controller.currentTargetID,2002);
 assert.equal(originalIssue(1001,{type:'stop'}).success,true);
 assert.equal(controller.manualOrder.type,'stop');
 assert.equal(controller.currentTargetID,0);
 assert.equal(controller.runtimeKind,'nativeCombat',
  'stock STOP leaves combat runtime kind; PF78 live proof must accept this');
});
test('original npcRuntime.stop reports success only after native physical stop and manual STOP',()=>{
 const calls=[];
 const originalStop=new Function('resolveNpcContext','spaceRuntime','npcService',
  `${extract(runtimeScript,'stop','follow')}\nreturn stop;`)(
   ()=>({success:true,data:{systemID:300,entityID:1001}}),
   {stopDynamicEntity:(...v)=>{calls.push(['physicalStop',...v]);return true;}},
   {issueManualOrder:(...v)=>{calls.push(['manualStop',...v]);return {success:true};},
    wakeNpcController:()=>{throw Error('PF82_UNEXPECTED_WAKE')}});
 const result=originalStop(1001,{reason:'pf83-return-base',
  allowSessionlessWarpAbort:false,issueStopOrder:true});
 assert.equal(result.success,true);
 assert.equal(calls[0][0],'physicalStop');
 assert.equal(calls[1][0],'manualStop');
 assert.equal(calls[1][1],1001);
 assert.deepEqual(calls[1][2],{type:'stop'});
});
